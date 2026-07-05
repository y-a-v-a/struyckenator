/**
 * Node wrapper around the shared self-test suite.
 * Run with:  node --test test/
 * The same tests run in the browser from public/index3.html.
 */
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const selftest = require('../public/js/struycken-selftest.js');

for (const t of selftest.tests) {
  test(t.name, () => t.fn());
}
