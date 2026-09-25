#!/usr/bin/env node
// Генерирует простые PNG-иконки (тёмный квадрат со скруглением и светлой буквой «T» из блоков)
// без внешних зависимостей. Запуск: node scripts/make-icons.mjs → public/icon-{16,32,48,128}.png

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const r = size * 0.22;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      // скруглённый квадрат
      const dx = Math.max(r - x, 0, x - (size - 1 - r));
      const dy = Math.max(r - y, 0, y - (size - 1 - r));
      const inside = dx * dx + dy * dy <= r * r;
      // буква T: перекладина и ножка
      const bar = y >= size * 0.24 && y < size * 0.4 && x >= size * 0.2 && x < size * 0.8;
      const stem = x >= size * 0.42 && x < size * 0.58 && y >= size * 0.24 && y < size * 0.8;
      const light = bar || stem;
      const [cr, cg, cb, ca] = !inside ? [0, 0, 0, 0] : light ? [245, 245, 245, 255] : [17, 17, 17, 255];
      raw[i] = cr;
      raw[i + 1] = cg;
      raw[i + 2] = cb;
      raw[i + 3] = ca;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public', { recursive: true });
for (const s of [16, 32, 48, 128]) writeFileSync(`public/icon-${s}.png`, png(s));
console.log('ok: public/icon-{16,32,48,128}.png');
