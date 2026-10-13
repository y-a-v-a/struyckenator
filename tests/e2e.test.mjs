// Browser tests: drive public/trix.html in a headless Chrome (the one
// installed on this machine, via puppeteer-core). Chrome's fake media
// device stands in for the webcam. Skipped when no Chrome is found.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { ROOT, listTestImages } from './helpers/images.mjs';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = CHROME_CANDIDATES.find(p => existsSync(p));
const PAGE_URL = pathToFileURL(join(ROOT, 'public', 'trix.html')).href;
const photo = listTestImages().find(f => /\.png$/i.test(f)) || listTestImages()[0];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

describe('trix.html in a browser', { skip: !chromePath && 'Chrome not found (set CHROME_PATH)' }, () => {
  let browser;
  let page;
  const problems = [];

  /** Wait until the machine has delivered more results than `count`. */
  async function waitForResult(count, timeout = 15000) {
    await page.waitForFunction(n => window.trix && window.trix.state.resultCount > n, { timeout }, count);
    await sleep(80);
  }
  const resultCount = () => page.evaluate(() => window.trix.state.resultCount || 0);

  async function freshPage(viewport = { width: 1440, height: 1000 }) {
    if (page) await page.close();
    page = await browser.newPage();
    await page.setViewport(Object.assign({ deviceScaleFactor: 1 }, viewport));
    page.on('pageerror', err => problems.push(`pageerror: ${err.message}`));
    page.on('console', msg => {
      if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
    });
    // fonts come from the network; their absence must not break anything
    await page.setRequestInterception(true);
    page.on('request', req => (req.url().startsWith('file:') || req.url().startsWith('blob:') || req.url().startsWith('data:') ? req.continue() : req.abort()));
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await waitForResult(0);
  }

  before(async () => {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: 'new',
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-first-run']
    });
    await freshPage();
  });

  after(async () => {
    if (browser) await browser.close();
  });

  test('loads and dots the placeholder portrait without errors', async () => {
    const info = await page.evaluate(() => ({
      dots: window.trix.state.result.layers[0].count,
      placeholder: window.trix.state.source.placeholder,
      title: document.title
    }));
    assert.ok(info.placeholder);
    assert.ok(info.dots > 500, `only ${info.dots} dots`);
    assert.match(info.title, /Trix/);
    const network = problems.filter(p => !/net::ERR_FAILED|Failed to load resource/.test(p));
    assert.deepEqual(network, []);
  });

  test('the first-run card invites a photo while the stand-in sits', async () => {
    assert.equal(await page.evaluate(() => document.getElementById('onboard').hidden), false);
  });

  test('the stage actually shows ink', async () => {
    // let the opening animation (plot, then shake) finish
    await page.waitForFunction(() => window.trix.state.t >= window.trix.state.result.iterations, { timeout: 10000 });
    await sleep(100);
    const inked = await page.evaluate(() => {
      const canvas = document.getElementById('stageCanvas');
      const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let dark = 0;
      for (let i = 0; i < data.length; i += 16) if (data[i] + data[i + 1] + data[i + 2] < 450) dark++;
      return dark;
    });
    assert.ok(inked > 200, `${inked} inked samples`);
  });

  test('uploading a photo from test-images runs the machine on it', { skip: !photo && 'no test image' }, async () => {
    const before = await resultCount();
    const input = await page.$('#fileInput');
    await input.uploadFile(photo);
    await waitForResult(before);
    const info = await page.evaluate(() => ({
      name: window.trix.state.source.name,
      dots: window.trix.state.result.layers[0].count,
      width: window.trix.state.result.width
    }));
    assert.ok(info.name.length > 0 && info.name !== 'placeholder');
    assert.equal(await page.evaluate(() => document.getElementById('onboard').hidden), true);
    assert.equal(info.width, 160);
    assert.ok(info.dots > 1500 && info.dots < 15000, `${info.dots} dots`);
  });

  test('every recipe runs and renders', async () => {
    const ids = await page.evaluate(() => window.trix.recipes.map(r => r.id));
    for (const id of ids) {
      const before = await resultCount();
      await page.evaluate(recipeId => window.trix.applyRecipe(window.trix.recipes.find(r => r.id === recipeId)), id);
      await waitForResult(before);
      const info = await page.evaluate(() => {
        const r = window.trix.state.result;
        return { layers: r.layers.length, dots: r.layers.reduce((a, l) => a + l.count, 0), mode: window.trix.state.machine.colorMode, tour: !!r.layers[0].tour };
      });
      assert.ok(info.dots > 200, `${id}: ${info.dots} dots`);
      if (info.mode === 'cmyk') assert.equal(info.layers, 4, id);
      if (info.mode === 'rgb') assert.equal(info.layers, 3, id);
      if (id === 'oneline') assert.ok(info.tour, 'one line needs a tour');
    }
    await page.evaluate(() => window.trix.applyRecipe(window.trix.recipes[0]));
    await sleep(600);
  });

  test('the timeline plots dots along the walk before shaking', async () => {
    const half = await page.evaluate(() => {
      window.trix.setTime(-0.5);
      const frame = window.trix.frame();
      return { visible: frame.layers[0].visible, count: window.trix.state.result.layers[0].count };
    });
    assert.ok(Math.abs(half.visible - half.count / 2) <= 1, JSON.stringify(half));
    const grid = await page.evaluate(() => {
      window.trix.setTime(0);
      const p = window.trix.frame().layers[0].positions;
      let onCentre = 0;
      for (let i = 0; i < p.length; i += 2) if (Math.abs(p[i] % 1 - 0.5) < 1e-4 && Math.abs(p[i + 1] % 1 - 0.5) < 1e-4) onCentre++;
      return onCentre / (p.length / 2);
    });
    assert.equal(grid, 1, 'at t = 0 every dot sits on its cell centre');
    await page.evaluate(() => window.trix.setTime(window.trix.state.result.iterations));
  });

  test('stamp mode exports PNG and a true-size SVG', async () => {
    await page.evaluate(() => {
      window.trix.setValue('stamp', 'on', true);
      window.trix.setValue('stamp', 'postmark', true);
    });
    await sleep(300);
    const out = await page.evaluate(() => {
      const canvas = window.trix.exportCanvas(1200);
      const svg = window.trix.sceneSvg();
      return { w: canvas.width, h: canvas.height, svgLength: svg.length, svg: svg.slice(0, 400), hasCountry: svg.includes('NEDERLAND'), hasValue: svg.includes('80ct'), circles: (svg.match(/<circle /g) || []).length, gravure: /<pattern id="gravure0"[^>]*rotate\(30\)/.test(svg) && svg.includes('fill="url(#gravure0)"') };
    });
    assert.ok(out.w === 1200 || out.h === 1200);
    assert.match(out.svg, /width="[\d.]+mm"/);
    assert.ok(out.hasCountry && out.hasValue);
    assert.ok(out.circles > 500, `${out.circles} circles`);
    assert.ok(out.gravure, 'letters printed through a 30° gravure screen');
  });

  test('PNG, SVG and movie downloads produce real files', async () => {
    await page.evaluate(() => {
      window.__downloads = [];
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download) { window.__downloads.push({ name: this.download, href: this.href }); return undefined; }
        return click.call(this);
      };
    });
    const grab = () => page.evaluate(async () => {
      const d = window.__downloads[window.__downloads.length - 1];
      const blob = await fetch(d.href).then(r => r.blob());
      return { name: d.name, size: blob.size, type: blob.type };
    });
    await page.evaluate(() => window.trix.savePng());
    await page.waitForFunction(() => window.__downloads.length === 1, { timeout: 10000 });
    const png = await grab();
    assert.match(png.name, /^trix-.*\.png$/);
    assert.ok(png.size > 20000, `png ${png.size} bytes`);

    await page.evaluate(() => window.trix.saveSvg());
    const svg = await grab();
    assert.match(svg.name, /\.svg$/);
    assert.equal(svg.type, 'image/svg+xml');

    await page.evaluate(() => window.trix.saveMovie());
    await page.waitForFunction(() => window.__downloads.length === 3, { timeout: 20000 });
    const movie = await grab();
    assert.match(movie.name, /\.(webm|mp4)$/);
    assert.ok(movie.size > 10000, `movie ${movie.size} bytes`);
  });

  test('printing puts the stamp on paper at its true size', async () => {
    const out = await page.evaluate(() => {
      let printed = false;
      const original = window.print;
      window.print = () => { printed = true; };
      window.trix.printScene();
      window.print = original;
      const svg = document.querySelector('#printArea svg');
      return { printed, width: svg && svg.getAttribute('width'), note: document.querySelector('#printArea p').textContent };
    });
    assert.ok(out.printed);
    assert.match(out.width, /^[\d.]+mm$/);
    assert.match(out.note, /20\.8 × 25\.6 mm/);
  });

  test('a series sheet has sixteen stamps in sixteen colours', async () => {
    const out = await page.evaluate(() => {
      window.trix.setValue('stamp', 'sheet', 16);
      const svg = window.trix.sceneSvg();
      const inks = new Set((svg.match(/<use href="#layer0"[^>]*color="(#[0-9a-f]{6})"/g) || []).map(s => s.match(/color="(#[0-9a-f]{6})"/)[1]));
      return { stamps: (svg.match(/<use href="#stampPaper"/g) || []).length, inks: inks.size };
    });
    assert.equal(out.stamps, 16);
    assert.equal(out.inks, 16);
    await page.evaluate(() => window.trix.setValue('stamp', 'sheet', 1));
  });

  test('letters are knocked out of the dots where they overlap', async () => {
    const before = await resultCount();
    await page.evaluate(() => window.trix.setValue('machine', 'aspect', 0.8)); // the field now runs behind the lettering
    await waitForResult(before);
    const hidden = await page.evaluate(() => {
      const layer = window.trix.frame().layers[0];
      return layer.hidden ? layer.hidden.reduce((a, b) => a + b, 0) : 0;
    });
    assert.ok(hidden > 0, 'some dots hide behind NEDERLAND / the value');
    const shown = await page.evaluate(() => {
      window.trix.setValue('stamp', 'knockout', false);
      const layer = window.trix.frame().layers[0];
      return layer.hidden ? layer.hidden.reduce((a, b) => a + b, 0) : 0;
    });
    assert.equal(shown, 0);
    const again = await resultCount();
    await page.evaluate(() => {
      window.trix.setValue('stamp', 'knockout', true);
      window.trix.setValue('machine', 'aspect', 1);
      window.trix.setValue('stamp', 'on', false);
    });
    await waitForResult(again);
  });

  test('the photo booth takes a picture with the (fake) webcam', async () => {
    await page.evaluate(() => window.trix.openBooth());
    await page.waitForFunction(() => document.getElementById('boothVideo').videoWidth > 0, { timeout: 10000 });
    const before = await resultCount();
    await page.evaluate(() => {
      document.getElementById('boothTimer').checked = false;
      window.trix.takePhoto();
    });
    await waitForResult(before);
    const info = await page.evaluate(() => ({
      source: window.trix.state.source.name,
      open: document.getElementById('cameraDialog').open,
      tracks: document.getElementById('boothVideo').srcObject
    }));
    assert.equal(info.source, 'camera');
    assert.equal(info.open, false);
    assert.equal(info.tracks, null, 'camera released after the shot');
  });

  test('the live dot mirror draws dots from the video', async () => {
    await page.evaluate(() => window.trix.openBooth());
    await page.waitForFunction(() => document.getElementById('boothVideo').videoWidth > 0, { timeout: 10000 });
    // the live mirror is on by default
    await sleep(1500);
    const inked = await page.evaluate(() => {
      const canvas = document.getElementById('boothDots');
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let dark = 0;
      for (let i = 0; i < data.length; i += 32) if (data[i] < 200) dark++;
      return { dark, hidden: canvas.hidden };
    });
    assert.equal(inked.hidden, false);
    assert.ok(inked.dark > 50, `${inked.dark} dark samples`);
    await page.evaluate(() => window.trix.closeBooth());
  });

  test('a settings link reproduces the settings', async () => {
    await page.evaluate(() => {
      window.trix.setValue('machine', 'path', 'spiral');
      window.trix.setValue('machine', 'seed', 'koningin');
      window.trix.setValue('look', 'style', 'diamond');
      window.trix.setValue('stamp', 'value', '1G');
    });
    const link = await page.evaluate(() => window.trix.settingsLink());
    assert.match(link, /#t=/);
    await page.goto('about:blank');
    await page.goto(link, { waitUntil: 'load' });
    await waitForResult(0);
    const s = await page.evaluate(() => ({ path: window.trix.state.machine.path, seed: window.trix.state.machine.seed, style: window.trix.state.look.style, value: window.trix.state.stamp.value }));
    assert.deepEqual(s, { path: 'spiral', seed: 'koningin', style: 'diamond', value: '1G' });
  });

  test('keyboard: T toggles the stamp, ⌘/Ctrl-Z undoes a setting', async () => {
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    const before = await page.evaluate(() => window.trix.state.stamp.on);
    await page.keyboard.press('t');
    assert.equal(await page.evaluate(() => window.trix.state.stamp.on), !before);
    await page.keyboard.press('t');

    await page.evaluate(() => window.trix.setValue('machine', 'iterations', 7));
    await sleep(500);
    await page.evaluate(() => window.trix.setValue('machine', 'iterations', 33));
    await sleep(500);
    await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control');
    await page.keyboard.press('z');
    await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control');
    assert.equal(await page.evaluate(() => window.trix.state.machine.iterations), 7);
  });

  test('phone width: no sideways scrolling', async () => {
    await freshPage({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `page is ${overflow}px too wide`);
  });

  test('no errors were logged along the way', () => {
    const real = problems.filter(p => !/net::ERR_FAILED|Failed to load resource/.test(p));
    assert.deepEqual(real, []);
  });
});
