// Built-in charts for Generated (sketch list plus pop progressions, D-36). Changes as commonly played; anything
// else comes from an iReal Pro playlist import.
import type { Chart } from '@mq/model'
import { DEMO_CHART } from '@mq/theory'
import { sheet } from './sheet'

export const TUNES: Chart[] = [
  { ...DEMO_CHART, id: 'attya', source: { kind: 'manual' } },
  sheet(
    { id: 'autumn-leaves', title: 'Autumn Leaves', composer: 'Joseph Kosma', key: { tonic: 'G', mode: 'minor' }, style: 'Medium Swing', tempo: 140, choruses: 3 },
    `[A] Cm7 | F7 | Bbmaj7 | Ebmaj7 | Am7b5 | D7 | Gm6 | Gm6 |
     [A] Cm7 | F7 | Bbmaj7 | Ebmaj7 | Am7b5 | D7 | Gm6 | Gm6 |
     [B] Am7b5 | D7 | Gm6 | Gm6 | Cm7 | F7 | Bbmaj7 | Ebmaj7 |
     [C] Am7b5 | D7 | Gm7 C7 | Fm7 Bb7 | Am7b5 | D7 | Gm6 | Gm6`,
  ),
  sheet(
    { id: 'blue-bossa', title: 'Blue Bossa', composer: 'Kenny Dorham', key: { tonic: 'C', mode: 'minor' }, style: 'Bossa Nova', tempo: 150, choruses: 4 },
    `[A] Cm7 | Cm7 | Fm7 | Fm7 | Dm7b5 | G7 | Cm7 | Cm7 |
     [B] Ebm7 | Ab7 | Dbmaj7 | Dbmaj7 | Dm7b5 | G7 | Cm7 | Dm7b5 G7`,
  ),
  sheet(
    { id: 'blues-in-f', title: 'Blues in F', key: { tonic: 'F', mode: 'major' }, style: 'Medium Swing', tempo: 120, choruses: 6 },
    `[A] F7 | Bb7 | F7 | Cm7 F7 | Bb7 | Bdim7 | F7 | D7 | Gm7 | C7 | F7 D7 | Gm7 C7`,
  ),
  sheet(
    { id: 'rhythm-changes', title: 'Rhythm changes', key: { tonic: 'B♭', mode: 'major' }, style: 'Up Tempo Swing', tempo: 200, choruses: 3 },
    `[A] Bbmaj7 G7 | Cm7 F7 | Dm7 G7 | Cm7 F7 | Fm7 Bb7 | Ebmaj7 Ab7 | Dm7 G7 | Cm7 F7 |
     [A] Bbmaj7 G7 | Cm7 F7 | Dm7 G7 | Cm7 F7 | Fm7 Bb7 | Ebmaj7 Ab7 | Cm7 F7 | Bb6 |
     [B] D7 | D7 | G7 | G7 | C7 | C7 | F7 | F7 |
     [A] Bbmaj7 G7 | Cm7 F7 | Dm7 G7 | Cm7 F7 | Fm7 Bb7 | Ebmaj7 Ab7 | Cm7 F7 | Bb6`,
  ),
  sheet(
    { id: 'body-and-soul-ballad', title: 'Ballad ii–V–I in D♭', key: { tonic: 'D♭', mode: 'major' }, style: 'Ballad', tempo: 60, choruses: 2 },
    `[A] Ebm7 | Ab7 | Dbmaj7 | Bbm7 | Ebm7 | Ab7 | Fm7 Bbm7 | Ebm7 Ab7 |
     [B] Dbmaj7 | Gbmaj7 | Fm7 | Bb7 | Ebm7 | Ab7 | Dbmaj7 | Dbmaj7`,
  ),
  sheet(
    { id: 'pop-four-chord', title: 'Four-chord pop · I–V–vi–IV', key: { tonic: 'C', mode: 'major' }, style: 'Pop', tempo: 100, choruses: 8 },
    `[Verse] C | G | Am | F | C | G | Am | F`,
  ),
  sheet(
    { id: 'pop-ballad', title: 'Pop ballad · vi–IV–I–V', key: { tonic: 'G', mode: 'major' }, style: 'Pop Ballad', tempo: 72, choruses: 6 },
    `[Verse] Em | C | G | D | Em | C | G | D`,
  ),
  sheet(
    { id: 'doo-wop', title: 'Doo-wop · I–vi–IV–V', key: { tonic: 'B♭', mode: 'major' }, style: 'Pop', tempo: 84, choruses: 8 },
    `[A] Bb | Gm | Eb | F | Bb | Gm | Eb | F`,
  ),
  sheet(
    { id: 'rock-blues-a', title: '12-bar rock blues in A', key: { tonic: 'A', mode: 'major' }, style: 'Rock', tempo: 116, choruses: 6 },
    `[A] A7 | D7 | A7 | A7 | D7 | D7 | A7 | A7 | E7 | D7 | A7 | E7`,
  ),
  sheet(
    { id: 'funk-vamp', title: 'Funk vamp · i–IV', key: { tonic: 'E', mode: 'minor' }, style: 'Funk', tempo: 96, choruses: 12 },
    `[A] Em7 | Em7 | A7 | A7`,
  ),
  sheet(
    { id: 'jazz-waltz', title: 'Jazz waltz ii–V–I in F', key: { tonic: 'F', mode: 'major' }, style: 'Jazz Waltz', tempo: 150, meter: { num: 3, den: 4 }, choruses: 6 },
    `[A] Gm7 | C7 | Fmaj7 | Fmaj7 | Am7b5 | D7 | Gm7 | C7 |
     [B] Fmaj7 | Bbmaj7 | Em7b5 | A7 | Dm7 | G7 | Gm7 | C7`,
  ),
]
