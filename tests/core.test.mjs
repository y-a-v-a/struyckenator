import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TrixCore as T } from './helpers/core.mjs';

const isPermutation = (path, count) => {
  if (path.length !== count) return false;
  const seen = new Uint8Array(count);
  for (const c of path) {
    if (c >= count || seen[c]) return false;
    seen[c] = 1;
  }
  return true;
};

const maxStepLength = (path, width) => {
  let worst = 0;
  for (let k = 1; k < path.length; k++) {
    const dx = (path[k] % width) - (path[k - 1] % width);
    const dy = Math.floor(path[k] / width) - Math.floor(path[k - 1] / width);
    worst = Math.max(worst, Math.hypot(dx, dy));
  }
  return worst;
};

describe('randomness', () => {
  test('the same seed word gives the same sequence', () => {
    const a = T.createRng('beatrix');
    const b = T.createRng('beatrix');
    for (let i = 0; i < 100; i++) assert.equal(a(), b());
  });

  test('different seeds diverge and values stay in [0, 1)', () => {
    const a = T.createRng('beatrix');
    const b = T.createRng('juliana');
    let same = 0;
    for (let i = 0; i < 1000; i++) {
      const va = a();
      const vb = b();
      if (va === vb) same++;
      assert.ok(va >= 0 && va < 1);
    }
    assert.ok(same < 5);
  });

  test('the generator is roughly uniform', () => {
    const rng = T.createRng(42);
    const bins = new Array(10).fill(0);
    for (let i = 0; i < 100000; i++) bins[Math.floor(rng() * 10)]++;
    for (const b of bins) assert.ok(Math.abs(b - 10000) < 500, `bin ${b}`);
  });
});

describe('scan paths', () => {
  const sizes = [[1, 1], [2, 3], [7, 5], [16, 16], [33, 20], [20, 33], [128, 128]];
  for (const kind of Object.keys(T.PATHS)) {
    test(`${kind} visits every cell exactly once`, () => {
      for (const [w, h] of sizes) {
        assert.ok(isPermutation(T.scanPath(kind, w, h, 0), w * h), `${kind} ${w}x${h}`);
      }
    });
  }

  test('meander, spiral and Hilbert walks only take unit steps', () => {
    for (const kind of ['serpentine', 'spiral']) {
      for (const [w, h] of sizes) assert.ok(maxStepLength(T.scanPath(kind, w, h, 0), w) <= 1, `${kind} ${w}x${h}`);
    }
    // gilbert takes unit steps on even sizes, at most one diagonal step otherwise
    assert.equal(maxStepLength(T.scanPath('hilbert', 128, 128, 0), 128), 1);
    assert.equal(maxStepLength(T.scanPath('hilbert', 64, 40, 0), 64), 1);
    assert.ok(maxStepLength(T.scanPath('hilbert', 33, 20, 0), 33) <= Math.SQRT2);
  });

  test('the serpentine reverses direction on odd rows (Struycken meander)', () => {
    const path = T.scanPath('serpentine', 4, 3, 0);
    assert.deepEqual(Array.from(path), [0, 1, 2, 3, 7, 6, 5, 4, 8, 9, 10, 11]);
  });

  test('all eight orientations are still permutations', () => {
    for (let orientation = 0; orientation < 8; orientation++) {
      for (const kind of ['serpentine', 'hilbert', 'diagonal']) {
        assert.ok(isPermutation(T.scanPath(kind, 9, 6, orientation), 54), `${kind} @${orientation}`);
      }
    }
  });

  test('transposed serpentine walks down the columns', () => {
    const path = T.scanPath('serpentine', 3, 2, 4);
    assert.deepEqual(Array.from(path), [0, 3, 4, 1, 2, 5]);
  });
});

describe('phase 1: accumulation', () => {
  test('reproduces the worked example from the Delft description', () => {
    // 40 + 100 + 120 = 260 → dot on the third cell, carry 5;
    // 5 + 100 + 80 + 100 = 285 → dot on the sixth cell, carry 30.
    const values = [40, 100, 120, 100, 80, 100];
    const { cells, carry } = T.accumulate(values, [0, 1, 2, 3, 4, 5], 255, 0);
    assert.deepEqual(Array.from(cells), [2, 5]);
    assert.equal(carry, 30);
  });

  test('white paper gets no dots, solid black gets a dot in every cell', () => {
    const path = T.scanPath('serpentine', 10, 10, 0);
    assert.equal(T.accumulate(new Array(100).fill(0), path, 255).cells.length, 0);
    assert.equal(T.accumulate(new Array(100).fill(255), path, 255).cells.length, 100);
  });

  test('ink is conserved: dots = total grey / 255 (± 1)', () => {
    const rng = T.createRng(7);
    const values = Array.from({ length: 4096 }, () => Math.floor(rng() * 256));
    const total = values.reduce((a, b) => a + b, 0);
    for (const kind of Object.keys(T.PATHS)) {
      const { cells, carry } = T.accumulate(values, T.scanPath(kind, 64, 64, 0, rng), 255);
      assert.equal(cells.length * 255 + carry, total);
      assert.ok(Math.abs(cells.length - total / 255) <= 1);
    }
  });

  test('50% grey gives a dot in every other cell along the walk', () => {
    const path = T.scanPath('serpentine', 8, 8, 0);
    const { cells } = T.accumulate(new Array(64).fill(127.5), path, 255);
    assert.equal(cells.length, 32);
  });

  test('cells become dot positions at the cell centres', () => {
    const pos = T.cellsToPositions(Uint32Array.from([0, 5, 11]), 4);
    assert.deepEqual(Array.from(pos), [0.5, 0.5, 1.5, 1.5, 3.5, 2.5]);
  });
});

describe('tone mapping', () => {
  const ramp = (w, h) => Float32Array.from({ length: w * h }, (_, i) => (i % w) / (w - 1));

  test('maps white to no ink and black to full ink, monotonically', () => {
    const lum = ramp(64, 4);
    const density = T.toneMap(lum, 64, 4, { autoLevels: false });
    assert.ok(density[0] > 0.99);
    assert.ok(density[63] < 0.01);
    for (let x = 1; x < 64; x++) assert.ok(density[x] <= density[x - 1] + 1e-6);
  });

  test('auto levels stretch a washed-out image to the full range', () => {
    const lum = Float32Array.from(ramp(100, 2), v => 0.4 + v * 0.2);
    const density = T.toneMap(lum, 100, 2, { autoLevels: true });
    assert.ok(Math.max(...density) > 0.95);
    assert.ok(Math.min(...density) < 0.05);
  });

  test('gamma above 1 lightens the midtones', () => {
    const lum = new Float32Array(16).fill(0.5);
    const neutral = T.toneMap(lum, 4, 4, { autoLevels: false })[0];
    const opened = T.toneMap(lum, 4, 4, { autoLevels: false, gamma: 2 })[0];
    assert.ok(opened < neutral);
  });

  test('invert swaps ink and paper', () => {
    const lum = new Float32Array(16).fill(0.2);
    const density = T.toneMap(lum, 4, 4, { autoLevels: false, invert: true })[0];
    assert.ok(Math.abs(density - 0.2) < 1e-6);
  });

  test('the oval fade empties the corners but keeps the centre', () => {
    const lum = new Float32Array(64 * 64).fill(0);
    const density = T.toneMap(lum, 64, 64, { autoLevels: false, fade: 1, fadeY: 0.5 });
    assert.ok(density[0] < 0.01, 'corner faded to paper');
    assert.ok(density[32 * 64 + 32] > 0.99, 'centre untouched');
  });

  test('ink below 1 economises on dots', () => {
    const lum = new Float32Array(16).fill(0);
    assert.ok(Math.abs(T.toneMap(lum, 4, 4, { autoLevels: false, ink: 0.5 })[0] - 0.5) < 1e-6);
  });

  test('blur preserves the mean and smooths a spike', () => {
    const src = new Float32Array(31 * 31);
    src[15 * 31 + 15] = 1;
    const out = T.blur(src, 31, 31, 2);
    const sum = out.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-3);
    assert.ok(out[15 * 31 + 15] < 0.2 && out[15 * 31 + 16] > 0);
  });
});

describe('phase 2: shaking the box', () => {
  const lattice = (w, h, every) => {
    const pts = [];
    for (let y = 0; y < h; y += every) for (let x = 0; x < w; x += every) pts.push(x + 0.5, y + 0.5);
    return Float32Array.from(pts);
  };

  test('dots never leave the box', () => {
    const pos = lattice(40, 30, 2);
    T.shake(pos, { width: 40, height: 30, iterations: 30, maxStep: 3, radius: 0.5, seed: 1 });
    for (let i = 0; i < pos.length; i += 2) {
      assert.ok(pos[i] >= 0 && pos[i] < 40 && pos[i + 1] >= 0 && pos[i + 1] < 30);
    }
  });

  test('strict 1983 rules: no move ever invades a territory', () => {
    const pos = lattice(48, 48, 3);
    const territory = 2; // minimum distance between dots
    T.shake(pos, { width: 48, height: 48, iterations: 20, maxStep: 3, lattice: true, relax: false, radius: territory / 2, seed: 'strict' });
    const nn = T.nearestNeighbourDistances(pos, 48, 48);
    assert.ok(Math.min(...nn) >= territory - 1e-6, `min distance ${Math.min(...nn)}`);
  });

  test('lattice mode moves at most maxStep positions per pass, and only in whole cells', () => {
    const pos = lattice(48, 48, 3);
    const snapshots = [];
    T.shake(pos, {
      width: 48, height: 48, iterations: 10, maxStep: 3, lattice: true, radius: 0.9, seed: 3,
      onIteration: (_, p) => snapshots.push(Float32Array.from(p))
    });
    for (let s = 1; s < snapshots.length; s++) {
      for (let i = 0; i < pos.length; i++) {
        const delta = Math.abs(snapshots[s][i] - snapshots[s - 1][i]);
        assert.ok(delta <= 3 + 1e-6);
        assert.ok(Math.abs(delta - Math.round(delta)) < 1e-6);
      }
    }
  });

  test('continuous mode breaks the grid', () => {
    const pos = lattice(64, 64, 2);
    assert.equal(T.latticeAlignment(pos), 1);
    T.shake(pos, { width: 64, height: 64, iterations: 20, maxStep: 3, radius: 0.6, seed: 9 });
    assert.ok(T.latticeAlignment(pos) < 0.05);
  });

  test('the tether keeps every dot near its original cell', () => {
    const pos = lattice(64, 64, 4);
    const start = Float32Array.from(pos);
    T.shake(pos, { width: 64, height: 64, iterations: 40, maxStep: 3, radius: 0.5, tether: 2, seed: 5 });
    for (let i = 0; i < pos.length; i += 2) {
      assert.ok(Math.hypot(pos[i] - start[i], pos[i + 1] - start[i + 1]) <= 2 + 1e-5);
    }
  });

  test('the same seed shakes identically, another seed differently', () => {
    const run = seed => {
      const pos = lattice(32, 32, 2);
      T.shake(pos, { width: 32, height: 32, iterations: 10, radius: 0.6, seed });
      return pos;
    };
    assert.deepEqual(run('a'), run('a'));
    assert.notDeepEqual(run('a'), run('b'));
  });

  test('zero iterations leaves the first-phase grid untouched', () => {
    const pos = lattice(16, 16, 2);
    const copy = Float32Array.from(pos);
    const result = T.shake(pos, { width: 16, height: 16, iterations: 0, seed: 1 });
    assert.deepEqual(pos, copy);
    assert.equal(result.acceptance.length, 0);
  });

  test('relaxation resolves the overlaps that the first phase leaves behind', () => {
    const W = 64, H = 64;
    const values = new Uint16Array(W * H).fill(64);
    const { cells } = T.accumulate(values, T.scanPath('serpentine', W, H, 0), 255);
    const field = T.createRadiusField(Float32Array.from(values, v => v / 255), W, H, 0.75, 8);
    const minDist = 2 * field[0];
    const violations = pos => T.nearestNeighbourDistances(pos, W, H).filter(d => d < minDist - 1e-3).length / (pos.length / 2);
    const pos = T.cellsToPositions(cells, W);
    const before = violations(pos);
    T.shake(pos, { width: W, height: H, iterations: 20, maxStep: 2, attempts: 2, radiusField: field, relax: true, seed: 2 });
    assert.ok(before > 0.3, `meander rows start too close: ${before}`);
    assert.ok(violations(pos) < 0.02, `after ${violations(pos)}`);
  });

  test('a dense block jiggles in place when territories fit', () => {
    const pos = lattice(40, 40, 1);
    T.shake(pos, { width: 40, height: 40, iterations: 20, radius: 0.4, seed: 2 });
    const nn = T.nearestNeighbourDistances(pos, 40, 40);
    assert.ok(Math.min(...nn) >= 0.8 - 1e-6);
    assert.ok(T.latticeAlignment(pos) < 0.1);
  });

  test('tone-adaptive territories give blue noise: evenly spaced, never clumped', () => {
    const W = 80, H = 80;
    const values = new Uint16Array(W * H).fill(64); // a quarter of the cells get a dot
    const { cells } = T.accumulate(values, T.scanPath('hilbert', W, H, 0), 255);
    const pos = T.cellsToPositions(cells, W);
    const field = T.createRadiusField(Float32Array.from(values, v => v / 255), W, H, 0.75, 8);
    T.shake(pos, { width: W, height: H, iterations: 30, maxStep: 2, radiusField: field, seed: 'blue' });
    const nn = T.nearestNeighbourDistances(pos, W, H);
    const mean = nn.reduce((s, v) => s + v, 0) / nn.length;
    const sd = Math.sqrt(nn.reduce((s, v) => s + (v - mean) ** 2, 0) / nn.length);
    // white noise has a coefficient of variation of ~0.52; blue noise is much tighter
    assert.ok(sd / mean < 0.25, `cv ${sd / mean}`);
    assert.ok(Math.min(...nn) > 1.2, `min nn ${Math.min(...nn)}`);
  });

  test('acceptance is reported per pass and tends to drop as the box settles', () => {
    const pos = lattice(48, 48, 2);
    const { acceptance } = T.shake(pos, { width: 48, height: 48, iterations: 12, radius: 0.85, seed: 4, anneal: true });
    assert.equal(acceptance.length, 12);
    for (const a of acceptance) assert.ok(a >= 0 && a <= 1);
  });
});

describe('analysis', () => {
  test('k nearest neighbours match brute force', () => {
    const rng = T.createRng('knn');
    const pos = Float32Array.from({ length: 400 }, (_, i) => rng() * (i % 2 ? 30 : 50));
    const k = 5;
    const fast = T.nearestNeighbours(pos, 50, 30, k);
    for (let i = 0; i < 200; i++) {
      const brute = [];
      for (let j = 0; j < 200; j++) {
        if (j !== i) brute.push([Math.hypot(pos[2 * i] - pos[2 * j], pos[2 * i + 1] - pos[2 * j + 1]), j]);
      }
      brute.sort((a, b) => a[0] - b[0]);
      for (let q = 0; q < k; q++) {
        const j = fast[i * k + q];
        const d = Math.hypot(pos[2 * i] - pos[2 * j], pos[2 * i + 1] - pos[2 * j + 1]);
        assert.ok(Math.abs(d - brute[q][0]) < 1e-5);
      }
    }
  });

  test('splatting conserves the number of dots', () => {
    const pos = Float32Array.from([1.2, 1.7, 5.5, 5.5, 3.9, 0.6]);
    const grid = T.splatDensity(pos, 8, 8, 0);
    assert.ok(Math.abs(grid.reduce((a, b) => a + b, 0) - 3) < 1e-5);
  });

  test('pearson correlation of a signal with itself is 1, with its negation -1', () => {
    const a = Float32Array.from([1, 2, 3, 4, 8]);
    assert.ok(Math.abs(T.pearson(a, a) - 1) < 1e-9);
    assert.ok(Math.abs(T.pearson(a, a.map(v => -v)) + 1) < 1e-9);
  });
});

describe('one-line tour', () => {
  const randomPoints = (n, seed) => {
    const rng = T.createRng(seed);
    return Float32Array.from({ length: 2 * n }, () => rng() * 60);
  };

  test('visits every dot exactly once', () => {
    const pos = randomPoints(1500, 'tour');
    const order = T.lineTour(pos, 60, 60);
    assert.ok(isPermutation(order, 1500));
  });

  test('2-opt improves on the greedy walk', () => {
    const pos = randomPoints(1200, 'opt');
    const greedy = T.lineTour(pos, 60, 60, { passes: 0 });
    const optimised = T.lineTour(pos, 60, 60, { passes: 8 });
    assert.ok(T.tourLength(pos, optimised) < T.tourLength(pos, greedy));
  });

  test('handles tiny inputs', () => {
    assert.deepEqual(Array.from(T.lineTour(Float32Array.from([1, 1, 2, 2]), 4, 4)), [0, 1]);
  });
});

describe('stamp geometry', () => {
  test('the perforated outline stays on the stamp and bites out the right area', () => {
    const w = 20.8, h = 25.6, r = 0.5, pitch = 20 / 13.5;
    const outline = T.perforatedOutline(w, h, r, pitch, 32);
    for (let i = 0; i < outline.length; i += 2) {
      assert.ok(outline[i] >= -1e-4 && outline[i] <= w + 1e-4);
      assert.ok(outline[i + 1] >= -1e-4 && outline[i + 1] <= h + 1e-4);
    }
    const holesX = Math.round(w / pitch) - 1;
    const holesY = Math.round(h / pitch) - 1;
    const expected = w * h - Math.PI * r * r * (holesX + holesY + 1);
    const area = T.polygonArea(outline);
    assert.ok(Math.abs(area - expected) / expected < 0.002, `${area} vs ${expected}`);
  });
});

describe('the whole machine', () => {
  const card = size => {
    const rgba = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      const v = 255 * ((i % size) / (size - 1));
      rgba[4 * i] = rgba[4 * i + 1] = rgba[4 * i + 2] = v;
      rgba[4 * i + 3] = 255;
    }
    return { width: size, height: size, rgba };
  };

  test('is deterministic for a seed and records snapshots of the shake', () => {
    const a = T.generate(card(48), { seed: 'x', iterations: 6 });
    const b = T.generate(card(48), { seed: 'x', iterations: 6 });
    assert.deepEqual(a.layers[0].positions, b.layers[0].positions);
    const snaps = a.layers[0].snapshots;
    assert.equal(snaps[0].iteration, 0);
    assert.equal(snaps[snaps.length - 1].iteration, 6);
    assert.deepEqual(snaps[snaps.length - 1].positions, a.layers[0].positions);
  });

  test('more dots where the image is darker', () => {
    const { layers } = T.generate(card(64), { autoLevels: false, iterations: 4 });
    const pos = layers[0].positions;
    let left = 0, right = 0;
    for (let i = 0; i < pos.length; i += 2) (pos[i] < 32 ? left++ : right++);
    assert.ok(left > right * 2.5, `${left} vs ${right}`);
  });

  test('colour modes produce one layer per ink', () => {
    assert.equal(T.generate(card(24), { colorMode: 'cmyk', iterations: 2 }).layers.length, 4);
    assert.equal(T.generate(card(24), { colorMode: 'rgb', iterations: 2 }).layers.length, 3);
  });

  test('asks for the tour only when needed', () => {
    assert.equal(T.generate(card(24), { iterations: 1 }).layers[0].tour, null);
    const { layers } = T.generate(card(24), { iterations: 1, tour: true });
    assert.ok(isPermutation(layers[0].tour, layers[0].count));
  });
});
