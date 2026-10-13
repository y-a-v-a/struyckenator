// Image helpers for the tests: decode the photos in test-images/, fit them
// to the dot grid the same way the page does (centre crop + area average),
// and rasterise dot patterns to PNG files in test-output/ for eyeballing.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const TEST_IMAGES = join(ROOT, 'test-images');
export const TEST_OUTPUT = join(ROOT, 'test-output');

export function listTestImages() {
  if (!existsSync(TEST_IMAGES)) return [];
  return readdirSync(TEST_IMAGES)
    .filter(name => /\.(png|jpe?g)$/i.test(name))
    .map(name => join(TEST_IMAGES, name));
}

/** Decode a PNG or JPEG file into { width, height, rgba }. */
export function decodeImage(file) {
  const buffer = readFileSync(file);
  if (/\.png$/i.test(extname(file))) {
    const png = PNG.sync.read(buffer);
    return { width: png.width, height: png.height, rgba: new Uint8ClampedArray(png.data) };
  }
  const img = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
  return { width: img.width, height: img.height, rgba: new Uint8ClampedArray(img.data) };
}

/**
 * Crop a window (fractions of the source, like the page's crop frame) and
 * area-average it down to gridWidth × gridHeight.
 */
export function fitToGrid(image, gridWidth, gridHeight, crop = null) {
  const aspect = gridWidth / gridHeight;
  let cw = image.width;
  let ch = image.height;
  if (cw / ch > aspect) cw = ch * aspect;
  else ch = cw / aspect;
  const window = crop || { x: (image.width - cw) / 2, y: (image.height - ch) / 2, w: cw, h: ch };
  const out = new Uint8ClampedArray(gridWidth * gridHeight * 4);
  for (let gy = 0; gy < gridHeight; gy++) {
    const y0 = Math.floor(window.y + (gy * window.h) / gridHeight);
    const y1 = Math.max(y0 + 1, Math.floor(window.y + ((gy + 1) * window.h) / gridHeight));
    for (let gx = 0; gx < gridWidth; gx++) {
      const x0 = Math.floor(window.x + (gx * window.w) / gridWidth);
      const x1 = Math.max(x0 + 1, Math.floor(window.x + ((gx + 1) * window.w) / gridWidth));
      const sum = [0, 0, 0, 0];
      let n = 0;
      for (let y = y0; y < y1 && y < image.height; y++) {
        for (let x = x0; x < x1 && x < image.width; x++) {
          const p = (y * image.width + x) * 4;
          sum[0] += image.rgba[p];
          sum[1] += image.rgba[p + 1];
          sum[2] += image.rgba[p + 2];
          sum[3] += image.rgba[p + 3];
          n++;
        }
      }
      const q = (gy * gridWidth + gx) * 4;
      for (let c = 0; c < 4; c++) out[q + c] = n ? Math.round(sum[c] / n) : 255;
    }
  }
  return { width: gridWidth, height: gridHeight, rgba: out };
}

/** A synthetic test card: horizontal gradient, a dark disc and a white bar. */
export function syntheticPortrait(size) {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 255 * (x / (size - 1));
      const dx = x - size * 0.5, dy = y - size * 0.42;
      if (dx * dx + dy * dy < (size * 0.22) ** 2) v = 40;
      if (y > size * 0.78 && y < size * 0.86) v = 255;
      const p = (y * size + x) * 4;
      rgba[p] = rgba[p + 1] = rgba[p + 2] = v;
      rgba[p + 3] = 255;
    }
  }
  return { width: size, height: size, rgba };
}

export function writePng(file, width, height, rgba) {
  mkdirSync(TEST_OUTPUT, { recursive: true });
  const png = new PNG({ width, height });
  png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  writeFileSync(file, PNG.sync.write(png));
}

/**
 * Anti-aliased disc rasteriser: positions are in grid cells, `scale` is
 * pixels per cell, `dotRadius` is in cells. Optionally places a grey
 * preview of the source next to the dots (side-by-side contact sheet).
 */
export function rasterizeDots(positions, gridWidth, gridHeight, { scale = 4, dotRadius = 0.3, ink = [20, 20, 20], paper = [250, 248, 242], source = null } = {}) {
  const panel = gridWidth * scale;
  const width = source ? panel * 2 : panel;
  const height = gridHeight * scale;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const coverage = new Float32Array(panel * height);
  const r = dotRadius * scale;
  for (let i = 0; i < positions.length; i += 2) {
    const cx = positions[i] * scale;
    const cy = positions[i + 1] * scale;
    for (let y = Math.max(0, Math.floor(cy - r - 1)); y <= Math.min(height - 1, Math.ceil(cy + r + 1)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r - 1)); x <= Math.min(panel - 1, Math.ceil(cx + r + 1)); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const a = Math.min(1, Math.max(0, r - d + 0.5));
        const k = y * panel + x;
        coverage[k] = Math.min(1, coverage[k] + a);
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      if (x < panel) {
        const a = coverage[y * panel + x];
        for (let c = 0; c < 3; c++) rgba[p + c] = paper[c] * (1 - a) + ink[c] * a;
      } else {
        const sx = Math.floor((x - panel) / scale);
        const sy = Math.floor(y / scale);
        const v = 255 * (1 - source[sy * gridWidth + sx]);
        rgba[p] = rgba[p + 1] = rgba[p + 2] = v;
      }
      rgba[p + 3] = 255;
    }
  }
  return { width, height, rgba };
}
