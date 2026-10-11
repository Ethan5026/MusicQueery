// Downloads iReal Pro's Essential Playlists (Jazz 1460, Brazilian, Latin, Blues, Pop, Country) as irealb://
// links into packages/theory/corpus/ (gitignored), where ireal.test.ts runs the parser over every chord.
// Usage: pnpm --filter @mq/theory corpus
import { mkdirSync, writeFileSync } from 'node:fs'

const PAGE = 'https://www.irealpro.com/main-playlists/'
const out = new URL('../corpus/', import.meta.url)

const html = await (await fetch(PAGE, { headers: { 'user-agent': 'Mozilla/5.0' } })).text()
const links = [...html.matchAll(/href="(irealb:\/\/[^"]+)"/g)].map((m) => m[1]!)
mkdirSync(out, { recursive: true })
let saved = 0
for (const link of links) {
  const parts = decodeURIComponent(link).split('===')
  if (parts.length < 3) continue // a single song, not a playlist
  const name = parts[parts.length - 1]!
  const file = name.toLowerCase().replace(/[^a-z0-9]/g, '') + '.txt'
  writeFileSync(new URL(file, out), `<a href="${link}">${name}</a>\n`)
  console.log(`${file}: ${name}, ${parts.length - 1} songs`)
  saved++
}
if (saved === 0) throw new Error(`no playlists found at ${PAGE}`)
