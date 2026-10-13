// End-to-end runs of the dot engine on the photographs in test-images/.
// Besides the assertions, every run writes a contact sheet (dots | what the
// machine saw) to test-output/ so the results can be judged by eye.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { basename, join } from 'node:path';
import { TrixCore as T } from './helpers/core.mjs';
import { decodeImage, fitToGrid, listTestImages, rasterizeDots, syntheticPortrait, writePng, TEST_OUTPUT } from './helpers/images.mjs';

const GRID = 128;
const images = listTestImages();

/** Square crop around the upper-middle part of the frame, where faces live. */
function portraitCrop(image) {
  const side = Math.min(image.width, image.height);
  const y = Math.min(image.height - side, Math.max(0, image.height * 0.38 - side / 2));
  return { x: (image.width - side) / 2, y, w: side, h: side };
}

function loadGrid(file, grid = GRID) {
  const image = decodeImage(file);
  return fitToGrid(image, grid, grid, portraitCrop(image));
}

const slug = file => basename(file).replace(/\.[a-z]+$/i, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();

function saveSheet(name, result, layerIndex = 0) {
  const layer = result.layers[layerIndex];
  const sheet = rasterizeDots(layer.positions, result.width, result.height, { scale: 5, dotRadius: 0.32, source: layer.density });
  writePng(join(TEST_OUTPUT, `${name}.png`), sheet.width, sheet.height, sheet.rgba);
}

/** How well the blurred dots reproduce the blurred target tone (Pearson r). */
function toneFidelity(result, layerIndex = 0, sigma = 2.5) {
  const layer = result.layers[layerIndex];
  const seen = T.splatDensity(layer.positions, result.width, result.height, sigma);
  const wanted = T.blur(layer.density, result.width, result.height, sigma);
  return T.pearson(seen, wanted);
}

const PORTRAIT_TONE = { autoLevels: true, gamma: 1.6, contrast: 1.1, sharpen: 2, clarity: 0.8, fade: 1, fadeRadius: 0.46, fadeY: 0.45, ink: 0.9 };

describe('synthetic test card', () => {
  test('every recipe reproduces the tone of the card', () => {
    const input = syntheticPortrait(GRID);
    for (const [name, recipe] of Object.entries(T.RECIPES)) {
      const result = T.generate(input, Object.assign({ autoLevels: false, seed: 'card' }, recipe));
      saveSheet(`card-${name}`, result);
      const r = toneFidelity(result);
      assert.ok(r > 0.9, `${name}: tone fidelity ${r.toFixed(3)}`);
    }
  });
});

describe('photographs in test-images/', { skip: images.length === 0 && 'no test images found' }, () => {
  for (const file of images) {
    const name = slug(file);

    test(`${name}: classic 1983 recipe`, () => {
      const input = loadGrid(file);
      const result = T.generate(input, Object.assign({}, PORTRAIT_TONE, T.RECIPES.struycken, { seed: name }));
      saveSheet(`${name}-struycken`, result);
      const n = result.layers[0].count;
      assert.ok(n > 1000 && n < 12000, `dot count ${n}`);
      const r = toneFidelity(result);
      assert.ok(r > 0.85, `tone fidelity ${r.toFixed(3)}`);
      assert.ok(result.ms < 3000, `took ${result.ms.toFixed(0)} ms`);
    });

    test(`${name}: every recipe stays faithful to the photo`, () => {
      const input = loadGrid(file);
      for (const [recipeName, recipe] of Object.entries(T.RECIPES)) {
        const result = T.generate(input, Object.assign({}, PORTRAIT_TONE, recipe, { seed: name }));
        saveSheet(`${name}-${recipeName}`, result);
        const r = toneFidelity(result);
        assert.ok(r > 0.85, `${recipeName}: tone fidelity ${r.toFixed(3)}`);
        if (!recipe.lattice && recipe.iterations > 0) {
          assert.ok(T.latticeAlignment(result.layers[0].positions) < 0.15, `${recipeName}: grid still visible`);
        }
      }
    });

    test(`${name}: auto tone gives a balanced portrait without hand tuning`, () => {
      const input = loadGrid(file);
      const result = T.generate(input, Object.assign({}, T.RECIPES.hilbert, {
        autoTone: true, toneTarget: 0.72, contrast: 1.1, sharpen: 2, clarity: 0.8, fade: 1, fadeRadius: 0.46, fadeY: 0.45, ink: 0.9, seed: name
      }));
      saveSheet(`${name}-autotone`, result);
      const share = result.layers[0].count / (result.width * result.height);
      assert.ok(share > 0.08 && share < 0.24, `${(share * 100).toFixed(1)}% of cells inked`);
      assert.ok(toneFidelity(result) > 0.85);
    });

    test(`${name}: identical seeds give identical portraits`, () => {
      const input = loadGrid(file, 96);
      const a = T.generate(input, Object.assign({}, PORTRAIT_TONE, { seed: 'plate-1' }));
      const b = T.generate(input, Object.assign({}, PORTRAIT_TONE, { seed: 'plate-1' }));
      const c = T.generate(input, Object.assign({}, PORTRAIT_TONE, { seed: 'plate-2' }));
      assert.deepEqual(a.layers[0].positions, b.layers[0].positions);
      assert.notDeepEqual(a.layers[0].positions, c.layers[0].positions);
    });

    test(`${name}: colour separations`, () => {
      const input = loadGrid(file, 112);
      const result = T.generate(input, Object.assign({}, PORTRAIT_TONE, { colorMode: 'cmyk', seed: name }));
      assert.equal(result.layers.length, 4);
      for (let i = 0; i < 3; i++) assert.ok(toneFidelity(result, i) > 0.8, `layer ${result.layers[i].key}`);
    });

    test(`${name}: a 256 grid stays fast enough for interactive use`, () => {
      const input = loadGrid(file, 256);
      const result = T.generate(input, Object.assign({}, PORTRAIT_TONE, { seed: name, snapshots: false }));
      assert.ok(result.ms < 4000, `took ${result.ms.toFixed(0)} ms for ${result.layers[0].count} dots`);
    });
  }
});
