
'use strict';

// Generates assets/icon.png (256x256) — an AMOLED black gradient icon
// with a stylized 'AM' mark, using only Node built-ins (zlib).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
const OUT = path.join(__dirname, '..', 'assets', 'icon.png');

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function lerp(a, b, t) { return a + (b - a) * t; }

function main() {
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y++) {
    const rowStart = y * (SIZE * 4 + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < SIZE; x++) {
      const i = rowStart + 1 + x * 4;
      // Rounded-square clip
      const radius = 56;
      const dx = Math.max(radius - x, 0, x - (SIZE - 1 - radius));
      const dy = Math.max(radius - y, 0, y - (SIZE - 1 - radius));
      const inside = Math.sqrt(dx * dx + dy * dy) <= radius || dx === 0 || dy === 0;
      if (!inside) {
        raw[i] = 0; raw[i + 1] = 0; raw[i + 2] = 0; raw[i + 3] = 0;
        continue;
      }
      // Diagonal gradient #181822 -> #050508
      const t = (x + y) / (2 * (SIZE - 1));
      const r = lerp(24, 6, t);
      const g = lerp(24, 6, t);
      const b = lerp(34, 8, t);
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = 255;

      // Accent corner glow
      const gx = SIZE - 1 - x, gy = SIZE - 1 - y;
      const gl = Math.max(0, 1 - Math.sqrt(gx * gx + gy * gy) / 320);
      if (gl > 0) {
        raw[i] = Math.min(255, raw[i] + Math.round(lerp(0, 80, gl)));
        raw[i + 1] = Math.min(255, raw[i + 1] + Math.round(lerp(0, 60, gl)));
        raw[i + 2] = Math.min(255, raw[i + 2] + Math.round(lerp(0, 200, gl)));
      }

      // Draw 'AM' letters with simple 5x7 bitmap strokes scaled 16x
      const drawLetter = (letter, ox, oy) => {
        const glyphs = {
          A: [
            '01110','10001','10001','11111','10001','10001','10001'
          ],
          M: [
            '10001','11011','10101','10101','10001','10001','10001'
          ],
        };
        const g = glyphs[letter];
        if (!g) return;
        for (let gy2 = 0; gy2 < 7; gy2++) {
          for (let gx2 = 0; gx2 < 5; gx2++) {
            if (g[gy2][gx2] === '1') {
              for (let px = 0; px < 8; px++) {
                for (let py = 0; py < 8; py++) {
                  const X = ox + gx2 * 8 + px;
                  const Y = oy + gy2 * 8 + py;
                  if (X < 0 || X >= SIZE || Y < 0 || Y >= SIZE) continue;
                  const idx = Y * (SIZE * 4 + 1) + 1 + X * 4;
                  raw[idx] = 238; raw[idx + 1] = 236; raw[idx + 2] = 255; raw[idx + 3] = 255;
                }
              }
            }
          }
        }
      };
      // Letters centered: 'A' at x=58,y=86; 'M' at x=150,y=86
      drawLetter('A', 58, 86);
      drawLetter('M', 150, 86);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, png);
  console.log('wrote ' + OUT + ' (' + png.length + ' bytes)');
}

if (require.main === module) main();
module.exports = { main };
