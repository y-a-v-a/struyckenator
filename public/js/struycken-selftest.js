/**
 * struycken-selftest.js
 *
 * Framework-agnostic test suite for struycken-core.js. Every test is
 * deterministic (seeded PRNG, no wall clock), so it can run:
 *  - headless via `node --test test/` (see test/struycken-core.test.mjs)
 *  - in the browser from index3.html ("Run self-tests" button)
 *
 * Where possible, tests verify against independent brute-force
 * reimplementations (e.g. O(n^2) pair distances vs the core's spatial hash)
 * and against the literal worked example in the source text:
 * https://kalden.home.xs4all.nl/stru/struycken-nl.htm
 */
(function (global, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./struycken-core.js'));
  } else {
    global.StruyckenSelfTest = factory(global.StruyckenCore);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';

  // --- tiny assertion helpers -------------------------------------------

  function fail(message) {
    throw new Error(message);
  }

  function assertTrue(cond, message) {
    if (!cond) fail(message || 'expected condition to hold');
  }

  function assertEqual(actual, expected, message) {
    if (actual !== expected) {
      fail((message || 'values differ') + ' — expected ' + expected + ', got ' + actual);
    }
  }

  function assertClose(actual, expected, tol, message) {
    if (Math.abs(actual - expected) > tol) {
      fail((message || 'values not close') + ' — expected ~' + expected + ', got ' + actual);
    }
  }

  // --- independent brute-force helpers (adversarial cross-checks) --------

  function bruteMinPairDistance(points) {
    let best = Infinity;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const dx = points[i].x - points[j].x;
        const dy = points[i].y - points[j].y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < best) best = d;
      }
    }
    return best;
  }

  function pearson(xs, ys) {
    const n = xs.length;
    let mx = 0, my = 0;
    for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
    mx /= n; my /= n;
    let num = 0, dx2 = 0, dy2 = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - mx;
      const dy = ys[i] - my;
      num += dx * dy;
      dx2 += dx * dx;
      dy2 += dy * dy;
    }
    return num / Math.sqrt(dx2 * dy2);
  }

  function uniformDarkness(gridSize, value) {
    const d = new Float64Array(gridSize * gridSize);
    d.fill(value);
    return d;
  }

  function randomDarkness(gridSize, seed) {
    const rng = core.createRng(seed);
    const d = new Float64Array(gridSize * gridSize);
    for (let i = 0; i < d.length; i++) d[i] = rng() * 255;
    return d;
  }

  function pointKey(p) {
    return p.x.toFixed(6) + ',' + p.y.toFixed(6);
  }

  // --- the tests ----------------------------------------------------------

  const tests = [];
  function test(name, fn) {
    tests.push({ name: name, fn: fn });
  }

  test('phase 1 reproduces the worked example from the source text', function () {
    // "het eerste hokje geeft de grijswaarde 40 aan, het tweede 100, het
    //  derde 120 - dan wordt in het derde hokje die zwarte punt geplaatst en
    //  met de rest (5) wordt verder opgeteld: vierde 100, vijfde 80,
    //  zesde 100; dus in dat hokje weer een zwarte punt en met de rest (30)
    //  wordt verder geteld."
    const n = 6;
    const darkness = uniformDarkness(n, 0);
    [40, 100, 120, 100, 80, 100].forEach(function (v, x) { darkness[x] = v; });
    const points = core.placePoints(darkness, n);
    assertEqual(points.length, 2, 'dot count for the text example');
    assertEqual(points[0].x, 2, 'first dot lands in the third cell');
    assertEqual(points[0].y, 0, 'first dot row');
    assertEqual(points[1].x, 5, 'second dot lands in the sixth cell');
    assertEqual(points[1].y, 0, 'second dot row');
  });

  test('phase 1 scans in a meander pattern with carry across rows', function () {
    // 2x2 grid. Row 0 (L->R): 200, then 300 -> dot at (1,0), carry 45.
    // Row 1 scans R->L: cell (1,1)=150 -> 195; cell (0,1)=200 -> 395 -> dot
    // at (0,1). A plain left-to-right scan would put the dot at (1,1)
    // instead, so this pins the serpentine order.
    const darkness = Float64Array.from([200, 100, 200, 150]);
    const points = core.placePoints(darkness, 2);
    assertEqual(points.length, 2, 'dot count');
    assertEqual(points[0].x + ',' + points[0].y, '1,0', 'row 0 dot');
    assertEqual(points[1].x + ',' + points[1].y, '0,1', 'row 1 dot must land in the LEFT cell (meander)');
  });

  test('phase 1: white yields no dots, black fills every cell exactly once', function () {
    const n = 16;
    assertEqual(core.placePoints(uniformDarkness(n, 0), n).length, 0, 'all-white count');
    const black = core.placePoints(uniformDarkness(n, 255), n);
    assertEqual(black.length, n * n, 'all-black count');
    const cells = new Set(black.map(function (p) { return p.x + ',' + p.y; }));
    assertEqual(cells.size, n * n, 'all-black: one dot per cell');
  });

  test('phase 1: dot count is exactly floor(total darkness / 255)', function () {
    const n = 16;
    [13, 51, 128, 200, 254].forEach(function (g) {
      const points = core.placePoints(uniformDarkness(n, g), n);
      assertEqual(points.length, Math.floor((n * n * g) / 255),
        'count for uniform gray ' + g);
    });
    const rnd = randomDarkness(32, 42);
    assertEqual(core.placePoints(rnd, 32).length, core.expectedPointCount(rnd),
      'count for random field matches expectedPointCount');
  });

  test('phase 1: at most one dot per cell, integer origins, in bounds', function () {
    const n = 32;
    const points = core.placePoints(randomDarkness(n, 7), n);
    const cells = new Set();
    points.forEach(function (p) {
      assertTrue(Number.isInteger(p.x) && Number.isInteger(p.y), 'integer cell coords');
      assertEqual(p.x, p.ox, 'origin x equals start x');
      assertEqual(p.y, p.oy, 'origin y equals start y');
      assertTrue(p.x >= 0 && p.x < n && p.y >= 0 && p.y < n, 'in bounds');
      const key = p.x + ',' + p.y;
      assertTrue(!cells.has(key), 'cell ' + key + ' used twice');
      cells.add(key);
    });
  });

  test('tone mapping: neutral is identity; invert, contrast, brightness behave', function () {
    for (let v = 0; v <= 255; v += 17) {
      assertEqual(core.applyTone(v, {}), v, 'neutral tone at ' + v);
    }
    assertEqual(core.applyTone(100, { invert: true }), 155, 'invert');
    assertEqual(core.applyTone(64, { contrast: 2 }), 0, 'contrast expands around 128');
    assertEqual(core.applyTone(128, { contrast: 0 }), 128, 'zero contrast pins mid-gray');
    assertEqual(core.applyTone(250, { brightness: 20 }), 255, 'brightness clamps');
    const dark = core.rgbaToDarkness([255, 255, 255, 255, 0, 0, 0, 255], 2, {});
    assertEqual(dark[0], 0, 'white pixel has zero darkness');
    assertEqual(dark[1], 255, 'black pixel has full darkness');
    const transparent = core.rgbaToDarkness([0, 0, 0, 0], 1, {});
    assertEqual(transparent[0], 0, 'transparent composites to paper white');
  });

  test('phase 2 is deterministic for a seed, differs across seeds', function () {
    const n = 24;
    const start = core.placePoints(uniformDarkness(n, 128), n);
    const run = function (seed) {
      return core.shakePoints(start, n, { rng: core.createRng(seed) })
        .map(pointKey).join(';');
    };
    assertEqual(run(1981), run(1981), 'same seed, same pattern');
    assertTrue(run(1981) !== run(1982), 'different seed, different pattern');
  });

  test('phase 2 leaves positions untouched when iterations = 0', function () {
    const n = 16;
    const start = core.placePoints(uniformDarkness(n, 128), n);
    const after = core.shakePoints(start, n, { iterations: 0, rng: core.createRng(1) });
    assertEqual(after.map(pointKey).join(';'), start.map(pointKey).join(';'),
      'zero iterations is the identity');
  });

  test('phase 2 respects the 3-places bound and the subgrid lattice', function () {
    const n = 24;
    const subdivisions = 4;
    const maxSteps = 3;
    const step = 1 / subdivisions;
    const start = core.placePoints(uniformDarkness(n, 128), n);
    const after = core.shakePoints(start, n, {
      iterations: 20, maxSteps: maxSteps, subdivisions: subdivisions,
      minDistance: 0.8, rng: core.createRng(1981)
    });
    after.forEach(function (p) {
      assertTrue(Math.abs(p.x - p.ox) <= maxSteps * step + 1e-9, 'x offset within bound');
      assertTrue(Math.abs(p.y - p.oy) <= maxSteps * step + 1e-9, 'y offset within bound');
      const kx = (p.x - p.ox) / step;
      const ky = (p.y - p.oy) / step;
      assertClose(kx, Math.round(kx), 1e-9, 'x offset on subgrid lattice');
      assertClose(ky, Math.round(ky), 1e-9, 'y offset on subgrid lattice');
      assertTrue(p.x >= 0 && p.x <= n - 1 && p.y >= 0 && p.y <= n - 1, 'in bounds after shake');
    });
  });

  test('phase 2 never violates a territory (brute-force cross-check)', function () {
    const n = 32;
    const minDistance = 0.8;
    const start = core.placePoints(randomDarkness(n, 99), n);
    assertTrue(start.length > 100, 'test needs a decently populated field');
    const after = core.shakePoints(start, n, {
      iterations: 20, minDistance: minDistance, rng: core.createRng(1981)
    });
    const brute = bruteMinPairDistance(after);
    assertTrue(brute >= minDistance - 1e-9,
      'min pairwise distance ' + brute + ' >= territory ' + minDistance);
    const hashed = core.minPairDistance(after, n, 2);
    assertClose(hashed, brute, 1e-9, 'spatial-hash min distance agrees with brute force');
  });

  test('phase 2 actually breaks the raster (most dots leave their origin)', function () {
    const n = 24;
    const start = core.placePoints(uniformDarkness(n, 128), n);
    const after = core.shakePoints(start, n, { rng: core.createRng(1981) });
    const metrics = core.computeMetrics(after, n, {});
    assertTrue(metrics.movedFraction > 0.6,
      'moved fraction ' + metrics.movedFraction.toFixed(2) + ' should exceed 0.6');
    assertTrue(metrics.meanDisplacement > 0.2,
      'mean displacement ' + metrics.meanDisplacement.toFixed(3) + ' should exceed 0.2');
    assertTrue(metrics.inBounds, 'metrics report in-bounds');
    assertTrue(metrics.withinOffset, 'metrics report offsets within bound');
  });

  test('outcome preserves tone: dot density tracks darkness after shaking', function () {
    const n = 64;
    const darkness = new Float64Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) darkness[y * n + x] = (255 * x) / (n - 1);
    }
    const after = core.shakePoints(core.placePoints(darkness, n), n, {
      rng: core.createRng(1981)
    });
    const bands = 8;
    const counts = new Array(bands).fill(0);
    after.forEach(function (p) {
      counts[Math.min(bands - 1, Math.floor(((p.x + 0.5) / n) * bands))]++;
    });
    const centers = counts.map(function (_, b) { return b + 0.5; });
    const r = pearson(centers, counts);
    assertTrue(r > 0.95, 'band count vs darkness correlation ' + r.toFixed(3) + ' > 0.95');
  });

  test('SVG export contains one circle per dot and the right viewBox', function () {
    const n = 16;
    const points = core.placePoints(uniformDarkness(n, 128), n);
    const svg = core.pointsToSVG(points, { gridSize: n, dotRadius: 0.3 });
    const circles = (svg.match(/<circle /g) || []).length;
    assertEqual(circles, points.length, 'circle count');
    assertTrue(svg.indexOf('viewBox="0 0 16 16"') !== -1, 'viewBox matches grid');
  });

  test('seeded PRNG is stable across runs and uniform-ish', function () {
    const rng = core.createRng(123);
    const first = [rng(), rng(), rng()];
    const rng2 = core.createRng(123);
    const second = [rng2(), rng2(), rng2()];
    assertEqual(first.join(','), second.join(','), 'identical sequences for one seed');
    let sum = 0;
    const rng3 = core.createRng(7);
    for (let i = 0; i < 10000; i++) sum += rng3();
    assertClose(sum / 10000, 0.5, 0.02, 'mean of 10k draws near 0.5');
  });

  /**
   * Run every test. Never throws; returns one result row per test.
   * @returns {{name:string, passed:boolean, message:string}[]}
   */
  function runAll() {
    return tests.map(function (t) {
      try {
        t.fn();
        return { name: t.name, passed: true, message: 'ok' };
      } catch (err) {
        return { name: t.name, passed: false, message: err.message };
      }
    });
  }

  return { tests: tests, runAll: runAll };
});
