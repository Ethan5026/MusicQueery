// Draws the app icon (staff lines + a brass quaver) into PNGs. Run: node scripts/make-icons.mjs
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const BG = [15, 17, 21]
const LINE = [70, 76, 90]
const BRASS = [212, 169, 60]

function crc32(buf) {
  let crc = 0xffffffff
  for (const b of buf) {
    let c = (crc ^ b) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

/** Colour at unit coordinates (u, v) in [0, 1). */
function shade(u, v) {
  // Note head: tilted ellipse; stem on its right; flag from the top of the stem.
  const dx = u - 0.42
  const dy = v - 0.62
  const a = -0.35
  const x = dx * Math.cos(a) - dy * Math.sin(a)
  const y = dx * Math.sin(a) + dy * Math.cos(a)
  if ((x / 0.115) ** 2 + (y / 0.08) ** 2 <= 1) return BRASS
  if (u >= 0.515 && u <= 0.55 && v >= 0.22 && v <= 0.6) return BRASS
  const flagX = 0.53 + (v - 0.22) * 1.3
  if (v >= 0.22 && v <= 0.36 && u <= flagX && u >= flagX - 0.05) return BRASS
  for (const ly of [0.3, 0.4, 0.5, 0.6, 0.7]) if (Math.abs(v - ly) < 0.007 && u > 0.14 && u < 0.86) return LINE
  return BG
}

function png(size) {
  const ss = 4
  const stride = size * 3 + 1
  const raw = Buffer.alloc(stride * size)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0]
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const c = shade((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size)
          for (let i = 0; i < 3; i++) acc[i] += c[i]
        }
      for (let i = 0; i < 3; i++) raw[py * stride + 1 + px * 3 + i] = Math.round(acc[i] / (ss * ss))
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const out = new URL('../public/', import.meta.url)
for (const [name, size] of [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
])
  writeFileSync(new URL(name, out), png(size))
console.log('icons written')
