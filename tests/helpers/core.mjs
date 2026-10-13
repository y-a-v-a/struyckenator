// Loads the dot engine straight out of public/trix.html, so the tests
// exercise exactly the code that ships in the page (no copy, no build step).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const TRIX_HTML_PATH = new URL('../../public/trix.html', import.meta.url);

export function readTrixHtml() {
  return readFileSync(TRIX_HTML_PATH, 'utf8');
}

export function extractScript(html, id) {
  const match = html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`));
  if (!match) throw new Error(`<script id="${id}"> not found in trix.html`);
  return match[1];
}

function loadCore() {
  const source = extractScript(readTrixHtml(), 'trix-core');
  vm.runInThisContext(source, { filename: 'trix.html#trix-core' });
  if (!globalThis.TrixCore) throw new Error('trix-core did not define TrixCore');
  return globalThis.TrixCore;
}

export const TrixCore = loadCore();
