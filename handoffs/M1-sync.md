# M1 · Sync spike

**Status:** done · 2026-10-10 · **Next:** M2
**Commit:** see `git log` for "M1: sync spike" (pushed to origin/main)

## Goal of this stage
Monorepo scaffold; PWA installed on the iPhone; Spotify PKCE; `SpotifyClock`; debug overlay + remote log;
drift probe. Answer SP1, SP2, SP8. Exit: login survives restart; median |drift| ≤ 60 ms, p95 ≤ 150 ms over
10 min; re-lock ≤ 1.5 s after seek/skip/pause.

## Decisions
- D-23 One Cloudflare Worker serves the PWA and `/api/*` (supersedes the hosting part of D-14, D-17's separate Worker)
- D-24 SP1 passed: PKCE login inside the Home Screen app, no token broker
- D-25 SP2: Spotify dev-mode rules, and what `timestamp` really means
- D-26 SpotifyClock design: resync re-anchoring + learned per-device start bias
- D-27 SP8 passed: Screen Wake Lock works in the standalone PWA (no video fallback)
- D-28 Main playback device is a Fire TV (Spotify Connect); sync acceptance tests run on it

## Built
- `package.json`, `pnpm-workspace.yaml` (14-day `minimumReleaseAge`), `tsconfig.base.json`, `eslint.config.js`, `vitest.config.ts`
- `apps/web` — Vite 8 + React 19 + Zustand + vite-plugin-pwa. M1 is a single debug page (`src/ui/App.tsx`)
  - `src/clock/SpotifyClock.ts` — polling clock (D-26); `types.ts` Clock interface; `offsets.ts` per-device offset + start-bias stores
  - `src/spotify/` — `pkce.ts`, `auth.ts` (PKCE, refresh, SP1 diagnostics in `mq.sp1`), `api.ts` (`/me/player`, play/pause/seek/next)
  - `src/probe/` — `onset-processor.js` (AudioWorklet click detector), `analysis.ts` (DriftAnalyzer), `DriftProbe.ts` (mic wiring, report upload)
  - `src/debug/log.ts` — remote log batches to `/api/log`; Eruda via `?debug` or the Debug card toggle
  - `src/wakelock.ts` — Screen Wake Lock with re-acquire on visibility
  - `scripts/replay-probe.ts` — replays an uploaded report through the current clock + analyzer (`node apps/web/scripts/replay-probe.ts report.json`)
  - `scripts/make-icons.mjs` — draws the PNG icons into `public/`
- `apps/worker` — `src/index.ts`: static assets + `/api/health`, `/api/log` (console → `pnpm tail`), `/api/report` (KV, 90-day TTL). `wrangler.toml` (KV `STORE` id 26a5977c…)
- `packages/theory`, `packages/model` — empty stubs for M2
- Root scripts: `pnpm dev` (http://127.0.0.1:5173, proxies `/api`), `pnpm test`, `pnpm lint`, `pnpm typecheck`,
  `pnpm ship` (build + `wrangler deploy`), `pnpm tail` (live device logs)

## Verified
- `pnpm test` → 26 passed · `pnpm typecheck`, `pnpm lint` → clean
- Live: https://musicqueery.ethangruening.workers.dev — `/api/health` → `ok`; `/api/log` 204 own origin, 403 foreign origin
- Device: iPhone, iOS 27.0 (Safari 27; the UA still says "iPhone OS 18_7", so don't parse it for the version)
- SP1 (remote log `auth.callback`): `loginStartedStandalone: true, callbackStandalone: true, verifierFound: true,
  exchanged: true`; user confirmed still logged in after a force-quit and reopen. `storage.persist` → true in the app
- SP8: wake lock `acquired`, screen stayed on through an 11-min probe with Auto-Lock not "Never" (user confirmed)
- Mic in the standalone app: `getUserMedia` (EC/NS/AGC off accepted), AudioWorklet, `getOutputTimestamp` all work;
  48 kHz, baseLatency 2.7 ms, outputLatency 9.7 ms
- Drift, report `report:2026-10-10T23:18:01.296Z:f937bbe1` (Fire TV playing a 120 BPM click track, phone mic, 11 min):
  - steady 9.4 min, nobody touching it: median |drift| **2.6 ms**, p95 **9.2 ms**, max 92 ms, trend +0.47 ms/min
  - whole run replayed through the final clock (seeks, skip, pauses included): median **2.9 ms**, p95 **13.9 ms**, trend 0.83 ms/min
  - tempo check −37 ppm (phone clock vs track); poll RTT median 138 ms, p95 350 ms
- Re-lock on Fire TV (clock update after the last click on the old position): 0.22–0.93 s over 2 skips, 3 seeks and 1 play.
  The Fire TV goes silent for ~1 s rebuffering after each seek, so the clock is usually right before the audio returns
- SP2 finding behind D-26: Spotify reports ran ~310 ms ahead of the Fire TV audio after each fresh start, until the
  device re-reported (`timestamp` changed): 30 s after one start, 1.5 s after one seek, never across one other seek.
  The learned bias predicted the 647.8 s resync to within 1 ms. A quick pause→resume showed no bias

## Open
- [ ] next stage: the first fresh start on a new device is ~300 ms off until its first resync teaches the bias (it's saved per device after that)
- [ ] M5: re-lock not measured with the PC or the iPhone as the player (user plays mostly on Fire TV; D-28)
- [ ] M5: a calibration UI for the absolute device offset (`offsets.ts` is stored but only settable by typing a number)
- [ ] M3: `/api/report` and `/api/log` only check `Origin`; the bearer secret (D-17) arrives with `/api/timelines`
- [ ] M5: the clock polls only while visible; the mic stops if the app is backgrounded (expected iOS behaviour)
- [ ] user, by M2: download a "Jazz 1300" iReal Pro playlist (the parser corpus)
- [ ] Spotify refresh tokens die 6 months after first login (≈ 2027-04-10); the app falls back to the login button

## Skip
- `apps/web/src/ui/App.tsx` — throwaway M1 debug page; M4 replaces it with the real shell (keep the probe reachable from Settings/debug)
- `apps/web/src/probe/*`, `apps/web/scripts/replay-probe.ts` — only needed to re-measure sync
- `handoffs/02-dev-plan.md` — still the source for M2's scope and exit criteria (read its M2 row and SP6 only)

## Next prompt
```
Read CLAUDE.md, handoffs/DECISIONS.md and handoffs/M1-sync.md, then the M2 row and SP6 in handoffs/02-dev-plan.md.
Then do M2: build packages/theory (port and extend the sketch's engine from the <script> block of
design/sketchbook.html) and packages/model (Chart v1 / Timeline v1 zod schemas), plus the irealb:// parser.
Ask me for the Jazz 1300 playlist file when you need it.
```
