// Downloads the band's sample set (M6, SP5) into public/samples/ and squeezes it with ffmpeg: mono, leading silence
// cut, length capped with a fade, mp3 (every browser decodes it, including Playwright's WebKit on Windows).
// The output is committed; run again only to change the set. Usage: node apps/web/scripts/fetch-samples.mjs
// Sources and licences are written to public/samples/CREDITS.md.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = new URL('../public/samples/', import.meta.url)
const SAL = 'https://tonejs.github.io/audio/salamander/'
const BASS = 'https://smpldsnds.github.io/sfzinstruments-dsmolken-double-bass/pizz/'
const VCSL = 'https://smpldsnds.github.io/sgossner-vcsl/'

// Piano: Salamander every minor third, A1..C7 (comping, drones and pop voicings live in C2..C6).
const piano = ['A1', 'C2', 'Ds2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5', 'Ds5', 'Fs5', 'A5', 'C6', 'Ds6', 'Fs6', 'A6', 'C7']
// Double bass pizzicato, mezzo-forte, first round-robin.
const bass = ['c1', 'eb1', 'g1', 'bb1', 'd2', 'f2', 'a2', 'c3', 'e3', 'g3', 'a3']
const drums = {
  ride: 'Idiophones/Struck Idiophones/Suspended Cymbal 2/susCymb2_hit_stick_mp1',
  bell: 'Idiophones/Struck Idiophones/Suspended Cymbal 2/susCymb2_hit_bell_p1',
  crash: 'Idiophones/Struck Idiophones/Suspended Cymbal 1/susCymb1_hit_mp1',
  hhfoot: 'Idiophones/Struck Idiophones/Hi-Hat Cymbal/HiHat_Close_rr1_Mid',
  hhclosed: 'Idiophones/Struck Idiophones/Hi-Hat Cymbal/HiHat_HitC_v2_rr1_Mid',
  hhopen: 'Idiophones/Struck Idiophones/Hi-Hat Cymbal/HiHat_HitO_rr1_Mid',
  kick: 'Membranophones/Struck Membranophones/Bass Drum 1/BDrumNew_hit_v5_rr1_Sum',
  snare: 'Membranophones/Struck Membranophones/Snare Drum, Modern 2/Snare3M_HitSN_v4_rr1_Mid',
  ghost: 'Membranophones/Struck Membranophones/Snare Drum, Modern 2/Snare3M_HitSN_v2_rr1_Mid',
  xstick: 'Membranophones/Struck Membranophones/Snare Drum, Modern 2/Snare3M_Xstick_v2_rr1_Mid',
  shaker: 'Idiophones/Struck Idiophones/Shaker, Small/Mid_Shaker_Slap_rr1',
}

const tmp = join(tmpdir(), 'mq-samples')
mkdirSync(tmp, { recursive: true })
mkdirSync(OUT, { recursive: true })

async function get(url, file) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  writeFileSync(file, Buffer.from(await res.arrayBuffer()))
}

/** Mono, leading silence removed, at most `len` s with a `fade` s fade-out, 96 kbit/s mp3. */
function squeeze(src, dst, len, fade) {
  execFileSync('ffmpeg', [
    '-v', 'error', '-y', '-i', src,
    '-af', `silenceremove=start_periods=1:start_threshold=-55dB,atrim=0:${len},afade=t=out:st=${Math.max(0, len - fade)}:d=${fade}`,
    '-ac', '1', '-ar', '44100', '-b:a', '96k', dst,
  ])
}

let total = 0
async function one(url, ext, name, len, fade) {
  const src = join(tmp, `${name.replace('/', '-')}.${ext}`)
  const dst = new URL(name + '.mp3', OUT)
  await get(url, src)
  squeeze(src, fileURLToPath(dst), len, fade)
  total += statSync(dst).size
}

mkdirSync(new URL('piano/', OUT), { recursive: true })
mkdirSync(new URL('bass/', OUT), { recursive: true })
mkdirSync(new URL('drums/', OUT), { recursive: true })
for (const n of piano) await one(`${SAL}${n}.mp3`, 'mp3', `piano/${n}`, 4.5, 1.5)
for (const n of bass) await one(`${BASS}pizz_${n}_ma.m4a`, 'm4a', `bass/${n}`, 2.5, 0.8)
for (const [k, path] of Object.entries(drums)) {
  const long = k === 'ride' || k === 'bell' || k === 'crash' || k === 'hhopen'
  await one(VCSL + path.split('/').map(encodeURIComponent).join('/') + '.m4a', 'm4a', `drums/${k}`, long ? 3 : 1, long ? 1.5 : 0.3)
}
rmSync(tmp, { recursive: true, force: true })

writeFileSync(
  new URL('CREDITS.md', OUT),
  `# Band samples

Trimmed, mono, mp3 copies made by \`apps/web/scripts/fetch-samples.mjs\`.

- \`piano/\`: Salamander Grand Piano V3 by Alexander Holm, CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/),
  via ${SAL}
- \`bass/\`: Double bass pizzicato by D. Smolken (Rubner bass), CC0 1.0, via ${BASS}
- \`drums/\`: Versilian Community Sample Library by Sam Gossner, CC0 1.0, via ${VCSL}
`,
)
console.log(`samples: ${piano.length + bass.length + Object.keys(drums).length} files, ${(total / 1024).toFixed(0)} KB`)
