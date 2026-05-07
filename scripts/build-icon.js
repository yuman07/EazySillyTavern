#!/usr/bin/env node
'use strict';

// Generates a placeholder 1024x1024 PNG icon used for both macOS (.icns conversion)
// and Windows (.ico conversion) by electron-builder.
//
// This is intentionally minimal: a solid-color rounded square with the text "EST".
// Replace build/icon.png with a real designed icon before public release.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SIZE = 1024;
const OUTPUT = path.join(__dirname, '..', 'build', 'icon.png');

const BG = [17, 24, 39];        // #111827
const ACCENT_A = [99, 102, 241]; // #6366f1
const ACCENT_B = [236, 72, 153]; // #ec4899

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
function lerpColor(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

// 7-segment-ish stencil for "E", "S", "T" laid out across a coarse 7x9 grid.
const GLYPHS = {
  E: [
    '11111',
    '10000',
    '10000',
    '10000',
    '11110',
    '10000',
    '10000',
    '10000',
    '11111',
  ],
  S: [
    '01111',
    '10000',
    '10000',
    '10000',
    '01110',
    '00001',
    '00001',
    '00001',
    '11110',
  ],
  T: [
    '11111',
    '00100',
    '00100',
    '00100',
    '00100',
    '00100',
    '00100',
    '00100',
    '00100',
  ],
};

function createCanvas(w, h) {
  const buf = Buffer.alloc(w * h * 4);
  return { w, h, buf };
}

function setPixel(c, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const i = (y * c.w + x) * 4;
  c.buf[i] = r; c.buf[i + 1] = g; c.buf[i + 2] = b; c.buf[i + 3] = a;
}

function fillCanvas(c, color) {
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const t = (x + y) / (c.w + c.h);
      const cc = lerpColor(color[0], color[1], t);
      setPixel(c, x, y, cc[0], cc[1], cc[2]);
    }
  }
}

function fillRoundedRect(c, x0, y0, w, h, radius, color) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const dx = Math.max(x0 + radius - x, 0, x - (x0 + w - 1 - radius));
      const dy = Math.max(y0 + radius - y, 0, y - (y0 + h - 1 - radius));
      if (dx * dx + dy * dy > radius * radius) continue;
      setPixel(c, x, y, color[0], color[1], color[2], 255);
    }
  }
}

function drawGlyphs(c) {
  const text = 'EST';
  const gridCols = 5;
  const gridRows = 9;
  const cellSize = 38;
  const spacing = 26;
  const totalW = text.length * gridCols * cellSize + (text.length - 1) * spacing;
  const startX = Math.round((c.w - totalW) / 2);
  const startY = Math.round((c.h - gridRows * cellSize) / 2);

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const grid = GLYPHS[char];
    if (!grid) continue;
    const offsetX = startX + i * (gridCols * cellSize + spacing);
    for (let row = 0; row < grid.length; row++) {
      for (let col = 0; col < grid[row].length; col++) {
        if (grid[row][col] === '1') {
          for (let dy = 0; dy < cellSize; dy++) {
            for (let dx = 0; dx < cellSize; dx++) {
              setPixel(c, offsetX + col * cellSize + dx, startY + row * cellSize + dy, 244, 244, 245);
            }
          }
        }
      }
    }
  }
}

function encodePng(c) {
  const rows = [];
  for (let y = 0; y < c.h; y++) {
    rows.push(Buffer.from([0]));
    rows.push(c.buf.subarray(y * c.w * 4, (y + 1) * c.w * 4));
  }
  const raw = Buffer.concat(rows);
  const compressed = zlib.deflateSync(raw);

  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  }

  function crc32(buf) {
    let c = 0xffffffff;
    for (const byte of buf) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    return ~c >>> 0;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.w, 0);
  ihdr.writeUInt32BE(c.h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function main() {
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  const canvas = createCanvas(SIZE, SIZE);
  // background
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      setPixel(canvas, x, y, BG[0], BG[1], BG[2]);
    }
  }
  // accent gradient rounded square
  const inset = 96;
  fillRoundedRectGradient(canvas, inset, inset, SIZE - 2 * inset, SIZE - 2 * inset, 160, ACCENT_A, ACCENT_B);
  drawGlyphs(canvas);
  fs.writeFileSync(OUTPUT, encodePng(canvas));
  console.log(`Wrote ${OUTPUT} (${SIZE}x${SIZE})`);
}

function fillRoundedRectGradient(c, x0, y0, w, h, radius, c1, c2) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const dx = Math.max(x0 + radius - x, 0, x - (x0 + w - 1 - radius));
      const dy = Math.max(y0 + radius - y, 0, y - (y0 + h - 1 - radius));
      if (dx * dx + dy * dy > radius * radius) continue;
      const t = ((x - x0) + (y - y0)) / (w + h);
      const cc = lerpColor(c1, c2, t);
      setPixel(c, x, y, cc[0], cc[1], cc[2]);
    }
  }
}

main();
