# Alternative approaches: other apps and open-source projects

Survey of 2026-11-01, made outside the stage plan (no D-xx changed). Method: web search, project pages and READMEs,
and the GitHub API for stars and last-push dates. Star counts and dates are a snapshot from that day. Claims marked
**unverified** come from third-party listings or were not checked against the project itself.

## Summary

Nothing found does MusicQueery's whole loop: Spotify's own audio → an analysed chord timeline (keys and key changes)
→ a jazz lead sheet with scales and E♭/B♭ sax views, synced to a Spotify Connect device. Every piece exists
somewhere else:

- **Analysis synced to playback** exists for YouTube, uploads and local files (Chordify, ChordMini, ChordFlask, Capo,
  Moises). ChordCue (Oct 2026) follows Spotify, but analyses a matching YouTube upload, not Spotify's audio.
- **Spotify "now playing" tools** only look up an Ultimate Guitar sheet for the current track. They have no timing,
  or at best auto-scroll from lyric timestamps (ChordSync).
- **Improvisation tools** (JazzBuddy, iReal Pro, Impro-Visor, JJazzLab, Scaler) work from charts, not recordings.
- The only commercial product that synced chords to a streaming service, Fender Songs (Apple Music), lasted from
  Oct 2019 to Jun 2020.

The strongest things to borrow are in [Ideas worth borrowing](#ideas-worth-borrowing-ranked).

## MusicQueery's core loop, for comparison

Spotify supplies only identity and position (D-02). The companion captures the real audio (WASAPI loopback on
Windows, D-33; librespot into a PipeWire null sink on Linux, D-83), analyses beats, chords and keys (D-34), adds the
melody (D-76), and stores a Timeline v1 the phone plays against a SpotifyClock (D-26). On top: Roman numerals and
scale lenses (D-06), transposed sax views (D-05, D-08), iReal chart alignment (D-68), a band from the same chart
(D-57..D-59), live mic decoding (D-64).

Our own numbers, to compare against anything below: offline sevenths per beat Let It Be 0.85, Imagine 0.70,
Mas Que Nada 0.64, Fly Me to the Moon 0.54 (D-34); live mic majmin/sevenths 65.7/46.9, with chorus consensus
70.5/52.3 (D-64); melody note F on vocadito mixed at 0 dB and separated 0.68 (D-76).

## 1. Apps that work out chords from audio and sync them to playback

### ChordCue — closest twin of the companion
[github.com/chinown/ChordCue](https://github.com/chinown/ChordCue) · MIT · 1★ · pushed 2026-10-21 · 10 commits

- Manifest V3 browser extension (side panel) plus a local Python FastAPI server, started through native messaging,
  localhost-only, exits 5 min after the last request. Windows-focused installer.
- **Audio:** never Spotify's. YouTube, YouTube Music and SoundCloud audio is fetched with yt-dlp. For Spotify (web or
  desktop) it reads title, artist and length and downloads a matching YouTube upload, preferring the official
  "Artist – Topic" upload (same master, so the timing lines up). Intro differences need a manual Sync nudge.
- **Following playback:** site adapters read the web players (pause, seek, skip, ads). For the Spotify desktop app it
  reads Windows' media controls (SMTC, the volume-flyout data) and can seek the app.
- **Pipeline:** htdemucs isolates bass + other (vocals and drums removed; GPU/CUDA only) → Beat This! → BTC
  (170 chord types) → frame outputs averaged per beat and smoothed with Viterbi, so changes land on beats. Key and a
  capo suggestion are derived from the chords.
- **Cost:** ~20 s per song on a 6-core CPU; cached as `data/songs/<id>/sheet.json`; audio deleted after analysis;
  songs over 900 s rejected.
- **UI:** current chord, "Next" card counting beats to the change, scrolling chord lane, bar chart view with
  click-to-seek, transpose, capo, sharps/flats auto from key, Simplify (7ths → triads), guitar/ukulele/piano
  diagrams (a Deno test checks every shape in 14 types × 12 keys). No scales, Roman numerals or key changes.
- Inspired by anychord.net's play-along view.

### ChordMini — the most complete open-source app
[github.com/ptnghia-j/ChordMiniApp](https://github.com/ptnghia-j/ChordMiniApp) · MIT · 427★ · pushed 2026-07-30 ·
site chordmini.me

- **Inputs:** YouTube search and links, uploads (MP3, WAV, FLAC; 50 MB audio, 100 MB video). No Spotify.
- **Beats:** Beat-Transformer (with Spleeter) and madmom. **Chords:** Chord-CNN-LSTM, BTC-SL and BTC-PL, 301 labels
  (12 roots × 25 types + N).
- **Theory:** Roman numerals, key changes and enharmonic fixes come from an LLM (Gemini), which also segments the song.
  SongFormer (Docker service) for sections.
- **Melody:** experimental Sheet Sage service, rendered with OpenSheetMusicDisplay, MIDI export; slower than the
  chord pipeline.
- Also: beat-synced chord grid with metronome, LRCLIB lyrics, piano visualiser, guitar diagrams, an AI chat panel.
- **Stack:** Next.js 15 front end, Flask back end (port 5001), Firestore cache keyed
  `${videoId}_${beatModel}_${chordModel}`, Firebase Storage. Native Windows installs are called unreliable (WSL2 or
  Docker recommended).
- **Research behind it:** "Enhancing Automatic Chord Recognition via Pseudo-Labeling and Knowledge Distillation"
  (Phan, Jin, Liu, Dong; [arXiv 2602.19778](https://arxiv.org/abs/2602.19778), accepted to DAFx26). A BTC teacher
  pseudo-labels 1,000+ h of unlabeled audio; BTC and 2E1D students train on it, then on ground truth with selective
  distillation. The BTC student beats the teacher on all seven mir_eval metrics, with large gains on rare qualities.
- **Weights:** [github.com/ptnghia-j/ChordMini](https://github.com/ptnghia-j/ChordMini) (MIT, 25★, pushed 2026-06-11)
  holds `checkpoints/btc_model_best.pth` (36 MB), `checkpoints/2e1d_model_best.pth` (28 MB) and the original
  `checkpoints/btc_model_large_voca.pt` (12 MB). ChordMiniApp's `btc_pl_detector.py` loads
  `checkpoints/btc/btc_combined_best.pth`, so which file is the published PL model is **unverified**. An ONNX export
  exists on Hugging Face as `musetric/chordmini-onnx` (contents **unverified**).
- A listing claims 92% accuracy on clean recordings against Billboard: **unverified**, not in the repo.

### ChordFlask
[github.com/bkl2000/chordflask](https://github.com/bkl2000/chordflask) · MIT · 8★ · pushed 2026-10-17

- Self-hosted, local-first; MP3, MP4, WebM. Chordino by default, optional BTC as a second track, QM Vamp beats and
  bars, optional Demucs with per-stem volume.
- Beat playhead, A/B loop, transpose, beat-by-beat chord edits with undo, LRC/LRCLIB lyrics, a per-song journal,
  an experimental Score view. Phones get the Grid only. Shipped as source, a .deb and a portable Linux archive.

### Commercial apps

| App | Audio source | What it does | Notes |
|---|---|---|---|
| [Chordify](https://support.chordify.net/hc/en-us/articles/360002148497-How-to-use-Chordify-on-Desktop) | YouTube, SoundCloud, uploads (Premium); Deezer links currently broken | Chords from audio in a synced player; "Chords over Lyrics" for 7,500+ songs | Official pages never mention Spotify; users asked for Spotify import in [2021](https://support.chordify.net/hc/en-us/community/posts/360014645678-A-few-features-to-help-transfer-Spotify-playlists-to-Chordify-setlists). AlternativeTo's "Spotify integration" is **unverified** |
| [anychord.net](https://anychord.net/) | YouTube link, title, MP3 | Chords in time with diagrams and a countdown to the next chord | Android app plays through the official YouTube player; new songs take 1–2 min |
| [Moises](https://apps.apple.com/us/app/moises-the-musicians-app/id1515796612) | Files, Drive, Dropbox, public URL | Stems, chords at three levels, key, BPM, transpose with pitch shift | No Spotify or Apple Music import found |
| [Capo](https://supermegaultragroovy.com/products/capo/) (Mac, iOS) | Local files | "Chord Intelligence mkIV" (inversions), key, tempo, slow-down, loops | All on device. Mac only: spectrogram tabs and a publication-quality lead sheet |
| [Chord ai](https://www.chordai.net/real-time-chord-recognition-from-your-mic/) | Mic in real time; files, SoundCloud, YouTube | Chords, beats, voicings, lyrics (Pro), on device | The same idea as our M7 live listening; no published accuracy |
| [Yamaha Chord Tracker](https://usa.yamaha.com/products/musical_instruments/pianos/apps/chord_tracker/index.html) | Local non-DRM files only | Chord chart, tempo, transpose, slow-down, chord edits | Free; sends progressions to Yamaha keyboards |
| [Logic Pro 12 Chord ID](https://cdm.link/logic-pro-12-hands-on/) | Any audio or MIDI region | Writes the chord track; "Analyze Key" | Apple advises Stem Splitter first; June 2026 rebuild for extended chords and inversions |
| [Band-in-a-Box Audio Chord Wizard](https://www.pgmusic.com/manuals/bbw2026full/chapter11.htm) | WAV, MP3, WMA… | You mark bar lines, it detects chords, key, tempo, tuning, then the band plays the song | Closest to our analyse-then-band loop; desktop, manual bars |
| [Fender Songs](https://songs-support.fender.com/hc/en-us/articles/360043950551) | Apple Music | Chords and lyrics scrolling with the real track, 750k songs, checked by musicians | Launched Oct 2019, [shut 19 Jun 2020](https://songs-support.fender.com/hc/en-us/articles/360043950551); publishing deals with Sony/ATV, Warner Chappell, Kobalt, BMG |

### Songle (AIST) — the research precedent
- [Songle](https://staff.aist.go.jp/m.goto/PAPER/ISMIR2011goto.pdf) (Goto et al., ISMIR 2011) shows chorus sections,
  beats, the vocal melody and chords during web playback, and was the first to let anonymous users correct them.
- [Songle Widget](https://widget.songle.jp/docs/v1?lang=en) (ISM 2015) exposes timestamped beat, chord and chorus
  events (`chord.start/duration/name`, prev/next) synced to an embedded YouTube player, with annotation revisions.
  Same shape as our Timeline + Clock design.

### Hookpad Aria (not audio detection)
[Aria](https://www.hooktheory.com/blog/generative-ai-songwriting/) generates chords and melody from notes in a
Hookpad project (Anticipatory Music Transformer, Chris Donahue's group, fine-tuned on TheoryTabs). Hooktheory's FAQ
says Hookpad cannot detect chords from audio yet.

## 2. Spotify "now playing" projects: sheet lookup, no analysis

The common pattern: poll the current track, search Ultimate Guitar, show the sheet. None times the chords.

| Project | How it works |
|---|---|
| [ChordSync](https://github.com/simonroedig/ChordSync) | Python web app; Spotify (Premium) + Google Custom Search for UG pages (~100 free queries a day); bi-directional auto-scroll driven by LRCLIB synced lyrics (its earlier Musixmatch method stopped working); loop sections, capo, key/BPM display, tuner |
| [guitar-chud](https://github.com/willseiple/guitar-chud) | Floating macOS window; reads the Spotify desktop app over Apple Events, no login |
| [cagdass/Spotify-Chords](https://github.com/cagdass/Spotify-Chords) | Node page for the current track; refresh on song change; works while Spotify plays on the phone |
| [cemolcay/ChordDetector](https://github.com/cemolcay/ChordDetector) | macOS menu bar app, iTunes/Spotify, UG top-rated chords, last updated 2019 |
| [Linuus/spotitar](https://github.com/Linuus/spotitar) | Proof of concept on the dead in-client Spotify Apps platform |
| [spotifychords.luca.gg](https://news.ycombinator.com/item?id=29459956) | Show HN: links each playlist song to UG; HN thread also names Capo, Chordino, Omnizart, Rocksmith+ |
| [ProtemS/tabify](https://github.com/ProtemS/tabify), [findmetabs](https://github.com/nicolaikozel/findmetabs), [spotify2tabs](https://github.com/ethan-egerton/spotify2tabs), [Chordinate](https://sites.psu.edu/nzr5205passion/2018/04/12/chordinate-get-guitar-chords-for-your-spotify-music-automagically/) | Library/playlist → UG or Tab4U sheets; extension that opens UG search for the web player |
| [UG Tab Connect](https://chromewebstore.google.com/detail/instant-chords-tab-connec/egmfpidcpoojopcpppnidcpefamjejab?hl=en) and the [UG app](https://play.google.com/store/apps/details?id=com.ultimateguitar.tabs&hl=en_US) | Official: "Open Chords" button on the Spotify/YouTube web players; app streams the tabbed song from Spotify |
| [JustChords](https://www.justchords.app/) | Your own charts, with a Spotify/Apple Music/YouTube track attached as backing; "Chord Beats" durations and autoscroll |

Spotify itself has no chords feature; the [Chords & Tabs idea](https://community.spotify.com/t5/Live-Ideas/Chords-amp-Tabs/idi-p/5645802)
is still "New Suggestion".

Lyrics projects that solve the same clock problem (poll position, interpolate between polls):
[Spotify_lyric_player](https://github.com/KavinLokeswaran/Spotify_lyric_player) (polls every 2 s, LRCLIB),
[aome510/spotify-player](https://github.com/aome510/spotify-player) (Rust terminal client with synced lyrics).

## 3. Improvisation and practice tools (charts, not recordings)

- **[JazzBuddy](https://jazzbuddy.app/)** — browser app; chord sheet that auto-scrolls with a scale for each chord
  (Dorian, Lydian, Mixolydian, Bebop, Altered…), metronome, voice commands. You type charts in; subscribers get 10
  standards. $1.99/month. No audio sync, mic or backing band. The closest match to our Scale coach.
- **iReal Pro** — the reference backing band; no recordings.
- **[JJazzLab](https://github.com/jjazzboss/JJazzLab)** (LGPL-2.1, 608★, pushed 2026-10-21) — chord symbols + style →
  drums, bass, guitar, piano, strings with variations; FluidSynth synth, VST via MIDI, reads Yamaha .sty styles;
  Netbeans platform plus a GUI-less toolkit jar. Called the closest free iReal on a computer; no mobile app.
- **MMA (Musical MIDI Accompaniment)** — open-source accompaniment generator; [musicxml-midi](https://github.com/infojunkie)
  uses it to play iReal styles.
- **[Impro-Visor](https://github.com/Impro-Visor/Impro-Visor)** (GPL-2.0, 162★, last release 10.2 in 2019) — lead
  sheets in a text notation, backing tracks, note colouring (chord/colour/approach tones), a lick database and
  grammar-based solo generation, and **roadmaps**: the tune analysed into "bricks" (Cork/Elliott harmonic idioms)
  with implied keys.
- **[Scaler 3](https://www.pluginboutique.com/product/3-Studio-Tools/93-Music-Theory-Tools/14563-Scaler-3)** — DAW plugin;
  detects chords, keys and scales from audio or MIDI and suggests fitting scales, chords and modulation routes.
- **iReal tooling:** [ireal-musicxml](https://github.com/infojunkie/ireal-musicxml) (now `@music-i18n/ireal-musicxml`)
  turns `irealb://` and playlists into MusicXML exactly; its `doc/irealpro.md` documents the format (16 cells a row,
  a cell is not a beat). Same author: musicxml-player (Web Audio/MIDI), chirp (batch conversion), a Verovio fork.

## 4. Open-source building blocks

### Chord recognition
| Model / tool | Notes |
|---|---|
| BTC large-vocab | In our D-34 vote (1.2); ChordCue and ChordMini use it too |
| BTC-PL / 2E1D ([ChordMini](https://github.com/ptnghia-j/ChordMini)) | Distilled students that beat the BTC teacher; MIT weights published (see §1) |
| [ChordFormer](https://arxiv.org/abs/2502.11840) | Conformer, structured outputs, reweighted loss; +2% frame-wise, +6% class-wise over SOTA on large vocabularies; IEEE TASLP; code at mwaseemrandhawa/ChordFormer (licence **unverified**) |
| [lv-chordia](https://github.com/openmirlab/lv-chordia) | MIT package of the ISMIR 2019 large-vocabulary model (Jiang et al.) with pretrained ensembles; inference only. ChordFormer started from it; Chord-CNN-LSTM in ChordMini is the same family |
| Chordino (NNLS Chroma) | In our vote (1.0) and ChordFlask's default; our `packages/listen` is Chordino-style (D-64) |
| madmom | In our vote (0.8) |
| [omnizart](https://github.com/topics/chord-detection) | Transcribes vocal, drums, chords, beats |
| [krist311/chords-recognition](https://github.com/krist311/chords-recognition) | LSTM, MIREX categories, realtime demo |
| [Essentia.js](https://transactions.ismir.net/articles/10.5334/tismir.111) | WASM; real-time HPCP chroma demo in an AudioWorklet; [live-akkorderkennung](https://github.com/alikianrad81ak-spec/live-akkorderkennung) does live browser chords on it (HPCP bin 0 is A, not C) |

### Beats and structure
- **Beat This!** — ours (D-34) and ChordCue's. **Beat-Transformer** — ChordMini's.
- **[allin1](https://github.com/mir-aidj/all-in-one)** (MIT, 875★, pushed 2024-05) — tempo, beats, downbeats and
  labelled sections (intro/verse/chorus/bridge/outro) on demixed audio; `harmonix-all` ensemble; 33 min of audio in
  73 s on an RTX 4090; ports for Apple MLX/MPS.
- **SongFormer** — ChordMini's segmentation service.

### Melody and lead sheets
- **[Sheet Sage](https://github.com/chrisdonahue/sheetsage)** (471★, pushed 2025-05; licence not stated, madmom,
  Jukebox and Melisma restrict commercial use) — audio → lead sheet PDF (LilyPond) + aligned MIDI of melody and
  chords; Transformers on Jukebox features trained on HookTheory; ~24 s segments; brittle dependencies, Docker.
  [sheetsage-infer](https://github.com/openmirlab/sheetsage-infer) is an inference-only repackaging.
- **[ROSVOT](https://arxiv.org/abs/2405.09940)** (ACL 2024) — singing note transcription; needs separated vocals and
  leans on Montreal Forced Aligner word timings. Common 2025–26 recipe: lead-vocal separation → de-reverb → RMVPE F0
  → ROSVOT notes. Alternatives: [SongTrans](https://arxiv.org/html/2409.14619v1) (lyrics + notes, on par), VOCANO,
  JDC_note. Our D-76 already rejected basic-pitch, pYIN, FCPE and full CREPE.
- **OpenSheetMusicDisplay** — ChordMini's renderer (we engrave our own, D-80).

### Score following
- **[matchmaker](https://github.com/pymatchmaker/matchmaker)** (Apache-2.0, 93★, pushed 2026-10-30) — real-time
  audio/MIDI alignment to a score (online DTW variants such as OLTWDixon, HMM); returns score position in beats;
  ISMIR 2025 paper; Python 3.12; needs FluidSynth + pyfluidsynth.

## 5. Data

- **No open, crowdsourced database of time-synced chords exists** (nothing like LRCLIB for chords).
  [Open Chord Charts](https://github.com/open-chord-charts/web-api) is untimed and abandoned (2015); the Songsterr API
  is proprietary.
- **Hooktheory TheoryTabs** — 50k+ hand-made pop analyses (melody as scale degrees, chords as Roman numerals) synced
  to YouTube. The [official API](https://www.hooktheory.com/api/trends/docs) covers only chord-progression statistics
  (Trends; wrapped by `hooktheory-mcp`); a third-party [parse.bot API](https://parse.bot/marketplace/5483984b-7030-4e96-a4eb-a3b2686b72bb/hooktheory-com-api)
  claims full section data with YouTube sync points (**unverified**, terms unclear).
- **[Popular Hooks](https://huggingface.co/datasets/NEXTLab-ZJU/popular-hook)** (ICMEW 2024) — 38,694 hooks with MIDI,
  lyrics, keys, TheoryTab URLs and YouTube start/end times (you download the audio).
- **[Weimar Jazz Database](https://jazzomat.hfm-weimar.de/)** — 456 note-for-note solos by 78 players, aligned to
  audio, with chord changes, beats, phrases and choruses; SQLite; ODbL. DTL1000 adds 1,750 automatic transcriptions.
- Already in use: ChoCo (Isophonics, Billboard) for evaluation (D-39), Chordonomicon for chart names (D-40), the iReal
  corpus (D-30), vocadito for melody (D-76).

## 6. Spotify platform constraints

- **DRM:** apps cannot read the stream, which is why everyone else re-sources the audio. Spotify's iOS SDK (App
  Remote) gives control and metadata only.
- **Analysis endpoints gone:** audio-features and audio-analysis (beats, bars, sections, key, tempo) were removed for
  new and development-mode apps on 27 Nov 2024; there is no official replacement.
- **Development mode:** since 11 Feb 2026 the app owner needs Premium (matches D-25).
- **ML ban:** Developer Policy §III.14 and Developer Terms v10 (effective 15 May 2025) forbid training ML models on,
  or otherwise ingesting, Spotify Content; in Aug 2025 Spotify said there are no exceptions, even for research.
  MusicQueery's capture sits outside the Web API, but running models on Spotify audio is the use these terms target.
  Fine for a personal tool; it would block publishing MusicQueery as a public app.

## 7. How others get audio for a streamed song

| Approach | Used by | Trade-off |
|---|---|---|
| Re-source the same recording from YouTube | ChordCue, Chordify, anychord, ChordMini | Fast, no real-time playback needed; timing depends on finding the same master; YouTube terms |
| User's own files | Capo, ChordFlask, Chord Tracker, Moises | Clean, but not the streaming library |
| Microphone | Chord ai, our M7 | Works with anything; room noise and latency |
| Licensed catalogue | Fender Songs | Needs publishing deals; did not last |
| Lyric timestamps | ChordSync | No audio; only as good as lyric timing |
| Capture Spotify's own output | **MusicQueery only** (WASAPI loopback, librespot + PipeWire) | Exact recording and timing; costs real-time playback per track |

## 8. What MusicQueery has that none of them do

- E♭ alto and B♭ tenor views beside concert (D-05, D-08).
- A scale per chord under three lenses, drawn on a staff (D-06, D-11, D-73).
- Keys and key changes from the analysis itself (ChordMini needs an LLM).
- An engraved lead sheet with the melody transcribed from the recording (D-79..D-82).
- iReal charts aligned to the recording (D-68), and a band playing the same chart (D-57..D-59).
- Clock sync to a Spotify Connect device such as a Fire TV (D-26, D-28), and a playlist inbox (D-54).

## Ideas worth borrowing, ranked

1. **BTC-PL weights in the D-34 vote.** Same BTC architecture and large vocabulary we run, MIT, 36 MB; the paper's
   biggest gains are on rare qualities, and sevenths are our weakest score (Fly Me to the Moon 0.54). Test: swap it
   in as the BTC voter, then score the 7 human-annotated songs (D-39). Check first which checkpoint is the PL one
   (§1). If it helps, the ONNX export might also serve `packages/listen`.
2. **Chords from the bass + other stems.** ChordCue feeds BTC htdemucs bass + other. Our companion already separates
   those stems for the melody (D-76), so running BTC/Chordino on them costs almost nothing extra.
3. **Section labels for analysed tracks.** allin1 or SongFormer could label verse/chorus/bridge on the Song map,
   which needs a chart today (D-72).
4. **Melody yardsticks.** Run Sheet Sage and the RMVPE → ROSVOT recipe on vocadito mixes against D-76's 0.68.
5. **Live alignment.** matchmaker, if mic timing comes back (D-71).
6. **Theory.** Impro-Visor's bricks as a roadmap lens for jazz charts only (pop stays untouched, D-36); its note
   colouring maps onto our scale staff.
7. **Data.** Popular Hooks as a pop test set with keys and Roman numerals; the Weimar Jazz Database for the jazz side
   of Coach. Check licences first.
8. **UI details.** ChordCue's beat count-in to the next chord, and its "Simplify" toggle (7ths → triads).

## Open questions (unverified)

- Which ChordMini checkpoint is the published BTC-PL model, and what `musetric/chordmini-onnx` contains.
- Whether Chordify supports Spotify at all (only third-party sites say so).
- ChordMini's "92% on Billboard" claim.
- ChordFormer's code licence; whether ROSVOT ships pretrained checkpoints.
- The "SheetSage: A Hierarchical Transformer…" ISMIR 2024 citation in sheetsage-infer's README.
