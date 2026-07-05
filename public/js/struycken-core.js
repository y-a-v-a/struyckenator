/**
 * struycken-core.js
 *
 * A faithful, DOM-free implementation of the "Technisch procédé" used by
 * Peter Struycken, F.C.A. Groen and P.W. Verbeek (TH Delft) for the 1981
 * Beatrix stamp, as described by Paul Hefting:
 * https://kalden.home.xs4all.nl/stru/struycken-nl.htm
 *
 * Phase 1 (Smeulders): the image is divided into gridSize x gridSize cells.
 * Darkness values (0 = white .. 255 = black) are accumulated while scanning
 * in a meander (serpentine) pattern; each time the running sum reaches 255 a
 * dot is placed in the current cell and 255 is subtracted (the remainder
 * carries on). The source text's own example: 40, 100, 120 -> dot in the
 * third cell, remainder 5.
 *
 * Phase 2 ("shaking the box of marbles"): every dot owns a circular
 * territory. Dots are visited one by one; a die decides a direction
 * (up/down/left/right). A dot may never end up farther than `maxSteps`
 * places from its origin per axis, and may not touch another dot's
 * territory — if the move would violate either rule, it stays put.
 * One pass over the whole field is one iteration; the original used 20.
 *
 * Positions live on a subgrid: each cell is subdivided `subdivisions` times,
 * so one "place" (step) is 1/subdivisions of a cell.
 *
 * Everything is deterministic given a seed (the anti-counterfeiting property
 * of the original: without the program and the structure of the 20
 * iterations, the pattern cannot be reproduced).
 *
 * Loadable both as a browser global (StruyckenCore) and via require() in
 * Node, so the exact same code is unit-testable headlessly.
 */
(function (global, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    global.StruyckenCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EPS = 1e-9;

  // The four cardinal directions from the source text:
  // "naar onderen of naar boven, of naar links en rechts"
  const DIRECTIONS4 = [
    [0, -1], // up
    [0, 1],  // down
    [-1, 0], // left
    [1, 0]   // right
  ];
  const DIRECTIONS8 = DIRECTIONS4.concat([
    [-1, -1], [1, -1], [-1, 1], [1, 1]
  ]);

  /**
   * mulberry32 — small, fast, seedable PRNG. Returns floats in [0, 1).
   * @param {number} seed
   */
  function createRng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp255(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  /**
   * Tone-map a single luminance value (0 = black .. 255 = white).
   * Order: invert -> brightness -> contrast (around 128) -> gamma.
   * Neutral options are the identity.
   * @param {number} luminance
   * @param {{brightness?:number, contrast?:number, gamma?:number, invert?:boolean}} [tone]
   */
  function applyTone(luminance, tone) {
    const t = tone || {};
    let v = luminance;
    if (t.invert) v = 255 - v;
    if (t.brightness) v += t.brightness;
    const c = t.contrast === undefined ? 1 : t.contrast;
    if (c !== 1) v = (v - 128) * c + 128;
    v = clamp255(v);
    const g = t.gamma === undefined ? 1 : t.gamma;
    if (g !== 1 && g > 0) v = 255 * Math.pow(v / 255, 1 / g);
    return clamp255(v);
  }

  /**
   * Convert RGBA pixel data to a darkness grid (0 = white .. 255 = black),
   * the scale the original procedure works in. Alpha is composited over
   * paper white first.
   * @param {Uint8ClampedArray|number[]} data - RGBA bytes
   * @param {number} pixelCount
   * @param {object} [tone] - see applyTone
   * @returns {Float64Array} darkness values, length pixelCount
   */
  function rgbaToDarkness(data, pixelCount, tone) {
    const out = new Float64Array(pixelCount);
    for (let p = 0; p < pixelCount; p++) {
      const i = p * 4;
      let lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      const a = data[i + 3];
      if (a < 255) lum = (lum * a + 255 * (255 - a)) / 255;
      out[p] = 255 - applyTone(lum, tone);
    }
    return out;
  }

  /**
   * Phase 1: serpentine (meander) accumulation.
   * Scans row by row, even rows left-to-right, odd rows right-to-left; the
   * running sum (and its remainder) carries across row boundaries. When the
   * sum reaches `threshold`, a dot is placed in the current cell.
   * A cell can never receive more than one dot (darkness <= 255 <= threshold
   * per cell), and the total number of dots is exactly
   * floor(sum(darkness) / threshold).
   * @param {Float64Array|number[]} darkness - gridSize*gridSize values, 0..255
   * @param {number} gridSize
   * @param {number} [threshold=255]
   * @returns {{x:number, y:number, ox:number, oy:number}[]}
   */
  function placePoints(darkness, gridSize, threshold) {
    const th = threshold === undefined ? 255 : threshold;
    const points = [];
    let sum = 0;
    for (let y = 0; y < gridSize; y++) {
      const leftToRight = y % 2 === 0;
      for (let i = 0; i < gridSize; i++) {
        const x = leftToRight ? i : gridSize - 1 - i;
        sum += darkness[y * gridSize + x];
        if (sum >= th) {
          points.push({ x: x, y: y, ox: x, oy: y });
          sum -= th;
        }
      }
    }
    return points;
  }

  /**
   * Exact number of dots phase 1 will produce for a darkness grid.
   */
  function expectedPointCount(darkness, threshold) {
    const th = threshold === undefined ? 255 : threshold;
    let sum = 0;
    for (let i = 0; i < darkness.length; i++) sum += darkness[i];
    return Math.floor(sum / th + EPS);
  }

  /**
   * Phase 2: shake the box of marbles.
   * Visits every dot once per iteration, in placement order ("een voor een").
   * For each dot one die roll picks a direction; the dot moves one step
   * (1/subdivisions of a cell) unless the move would leave the grid, exceed
   * `maxSteps` steps from its origin on either axis, or come closer than
   * `minDistance` (its territory) to any other dot — then it stays put.
   *
   * Does not mutate the input; returns new point objects.
   *
   * @param {{x:number,y:number,ox?:number,oy?:number}[]} inputPoints
   * @param {number} gridSize
   * @param {{
   *   iterations?: number,     // passes over the whole field (default 20)
   *   maxSteps?: number,       // max places from origin per axis (default 3)
   *   subdivisions?: number,   // subgrid resolution per cell (default 4)
   *   minDistance?: number,    // territory, in cell units (default 0.8, keep <= 1)
   *   directions?: 4|8,        // die faces (default 4, per the source text)
   *   shuffleOrder?: boolean,  // reshuffle visiting order each iteration
   *   rng?: () => number       // seeded PRNG (default createRng(1981))
   * }} [options]
   */
  function shakePoints(inputPoints, gridSize, options) {
    const opts = options || {};
    const iterations = opts.iterations === undefined ? 20 : opts.iterations;
    const maxSteps = opts.maxSteps === undefined ? 3 : opts.maxSteps;
    const subdivisions = opts.subdivisions === undefined ? 4 : opts.subdivisions;
    const minDistance = opts.minDistance === undefined ? 0.8 : opts.minDistance;
    const dirs = opts.directions === 8 ? DIRECTIONS8 : DIRECTIONS4;
    const rng = opts.rng || createRng(1981);

    const step = 1 / subdivisions;
    const maxOffset = maxSteps * step + EPS;
    const minDistSq = minDistance * minDistance;
    const n = gridSize;
    const max = n - 1;

    const points = inputPoints.map(function (p) {
      return {
        x: p.x,
        y: p.y,
        ox: p.ox === undefined ? p.x : p.ox,
        oy: p.oy === undefined ? p.y : p.oy
      };
    });

    // Spatial hash: one bucket per grid cell, holding point indices.
    const buckets = new Array(n * n);
    for (let i = 0; i < buckets.length; i++) buckets[i] = [];
    const bucketIndex = function (x, y) {
      return Math.floor(y) * n + Math.floor(x);
    };
    for (let i = 0; i < points.length; i++) {
      buckets[bucketIndex(points[i].x, points[i].y)].push(i);
    }

    // Points closer than minDistance can be at most ceil(minDistance)
    // buckets apart on either axis.
    const reach = Math.max(1, Math.ceil(minDistance));

    const territoryFree = function (nx, ny, self) {
      const cx = Math.floor(nx);
      const cy = Math.floor(ny);
      const y0 = Math.max(0, cy - reach);
      const y1 = Math.min(max, cy + reach);
      const x0 = Math.max(0, cx - reach);
      const x1 = Math.min(max, cx + reach);
      for (let by = y0; by <= y1; by++) {
        for (let bx = x0; bx <= x1; bx++) {
          const bucket = buckets[by * n + bx];
          for (let k = 0; k < bucket.length; k++) {
            const j = bucket[k];
            if (j === self) continue;
            const dx = nx - points[j].x;
            const dy = ny - points[j].y;
            if (dx * dx + dy * dy < minDistSq - EPS) return false;
          }
        }
      }
      return true;
    };

    const order = points.map(function (_, i) { return i; });

    for (let it = 0; it < iterations; it++) {
      if (opts.shuffleOrder) {
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
        }
      }
      for (let oi = 0; oi < order.length; oi++) {
        const i = order[oi];
        const p = points[i];
        // One die roll per dot per iteration; on any rule violation the
        // dot stays in place ("dan moet hij maar op z'n plaats blijven").
        const d = dirs[Math.floor(rng() * dirs.length)];
        const nx = p.x + d[0] * step;
        const ny = p.y + d[1] * step;
        if (nx < 0 || nx > max || ny < 0 || ny > max) continue;
        if (Math.abs(nx - p.ox) > maxOffset || Math.abs(ny - p.oy) > maxOffset) continue;
        if (!territoryFree(nx, ny, i)) continue;

        const oldBucket = buckets[bucketIndex(p.x, p.y)];
        oldBucket.splice(oldBucket.indexOf(i), 1);
        p.x = nx;
        p.y = ny;
        buckets[bucketIndex(nx, ny)].push(i);
      }
    }
    return points;
  }

  /**
   * Minimum pairwise distance among points, searched up to `cap` cell units.
   * Returns Infinity when no pair is closer than cap (then the true minimum
   * is irrelevant for territory verification).
   */
  function minPairDistance(points, gridSize, cap) {
    const limit = cap === undefined ? 2 : cap;
    const n = gridSize;
    const buckets = new Map();
    const key = function (x, y) { return Math.floor(y) * n + Math.floor(x); };
    for (let i = 0; i < points.length; i++) {
      const k = key(points[i].x, points[i].y);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(i);
    }
    const reach = Math.ceil(limit);
    let best = Infinity;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const cx = Math.floor(p.x);
      const cy = Math.floor(p.y);
      for (let by = cy - reach; by <= cy + reach; by++) {
        for (let bx = cx - reach; bx <= cx + reach; bx++) {
          const bucket = buckets.get(by * n + bx);
          if (!bucket) continue;
          for (let k = 0; k < bucket.length; k++) {
            const j = bucket[k];
            if (j <= i) continue;
            const dx = p.x - points[j].x;
            const dy = p.y - points[j].y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < best) best = d;
          }
        }
      }
    }
    return best > limit ? Infinity : best;
  }

  /**
   * Outcome metrics + invariant checks for a processed point set.
   * @returns {{
   *   count:number, movedCount:number, movedFraction:number,
   *   meanDisplacement:number, maxOffsetX:number, maxOffsetY:number,
   *   minPair:number, inBounds:boolean, withinOffset:boolean
   * }}
   */
  function computeMetrics(points, gridSize, opts) {
    const o = opts || {};
    const maxSteps = o.maxSteps === undefined ? 3 : o.maxSteps;
    const subdivisions = o.subdivisions === undefined ? 4 : o.subdivisions;
    const allowed = maxSteps / subdivisions + 1e-6;
    let moved = 0;
    let sumDisp = 0;
    let maxDx = 0;
    let maxDy = 0;
    let inBounds = true;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const dx = Math.abs(p.x - p.ox);
      const dy = Math.abs(p.y - p.oy);
      if (dx > EPS || dy > EPS) moved++;
      sumDisp += Math.sqrt(dx * dx + dy * dy);
      if (dx > maxDx) maxDx = dx;
      if (dy > maxDy) maxDy = dy;
      if (p.x < 0 || p.x > gridSize - 1 || p.y < 0 || p.y > gridSize - 1) inBounds = false;
    }
    return {
      count: points.length,
      movedCount: moved,
      movedFraction: points.length ? moved / points.length : 0,
      meanDisplacement: points.length ? sumDisp / points.length : 0,
      maxOffsetX: maxDx,
      maxOffsetY: maxDy,
      minPair: minPairDistance(points, gridSize, 2),
      inBounds: inBounds,
      withinOffset: maxDx <= allowed && maxDy <= allowed
    };
  }

  /**
   * Render points into any CanvasRenderingContext2D-compatible context.
   * Dot centers sit at (x + 0.5, y + 0.5) cell units; dotRadius is in cell
   * units so output is resolution-independent.
   */
  function renderPoints(ctx, points, opts) {
    const o = opts || {};
    const gridSize = o.gridSize;
    const width = o.width;
    const height = o.height === undefined ? width : o.height;
    const scale = width / gridSize;
    const r = (o.dotRadius === undefined ? 0.35 : o.dotRadius) * scale;
    ctx.fillStyle = o.background || '#f4f1ea';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = o.dotColor || '#1a1a1a';
    const TAU = Math.PI * 2;
    for (let i = 0; i < points.length; i++) {
      ctx.beginPath();
      ctx.arc((points[i].x + 0.5) * scale, (points[i].y + 0.5) * scale, r, 0, TAU);
      ctx.fill();
    }
  }

  /**
   * Vector export — a nod to the Dr. Neher-laboratorium plotter that drew
   * the original models. Returns a standalone SVG document string.
   */
  function pointsToSVG(points, opts) {
    const o = opts || {};
    const n = o.gridSize;
    const size = o.size === undefined ? 1024 : o.size;
    const r = o.dotRadius === undefined ? 0.35 : o.dotRadius;
    const bg = o.background || '#f4f1ea';
    const fg = o.dotColor || '#1a1a1a';
    const parts = [];
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n +
      '" width="' + size + '" height="' + size + '">');
    parts.push('<rect width="' + n + '" height="' + n + '" fill="' + bg + '"/>');
    parts.push('<g fill="' + fg + '">');
    for (let i = 0; i < points.length; i++) {
      const cx = Math.round((points[i].x + 0.5) * 10000) / 10000;
      const cy = Math.round((points[i].y + 0.5) * 10000) / 10000;
      parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '"/>');
    }
    parts.push('</g></svg>');
    return parts.join('\n');
  }

  return {
    DIRECTIONS4: DIRECTIONS4,
    DIRECTIONS8: DIRECTIONS8,
    createRng: createRng,
    applyTone: applyTone,
    rgbaToDarkness: rgbaToDarkness,
    placePoints: placePoints,
    expectedPointCount: expectedPointCount,
    shakePoints: shakePoints,
    minPairDistance: minPairDistance,
    computeMetrics: computeMetrics,
    renderPoints: renderPoints,
    pointsToSVG: pointsToSVG
  };
});
