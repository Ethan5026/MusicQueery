# Truth set

Evaluation truth for the companion's chord analysis (`pnpm companion bakeoff`). Audio is never stored here (D-18).

- `<artist>--<title>.json` / `.timeline.json`: human, time-aligned chord annotations, shifted onto the Spotify release
  (`mqc import-annotated`, D-39). Derived from ChoCo (de Berardinis et al., *Scientific Data* 10:641, 2023,
  https://github.com/smashub/choco, CC BY 4.0), which redistributes:
  - Isophonics reference annotations (C. Harte, M. Mauch et al., Centre for Digital Music, Queen Mary University of London)
  - McGill Billboard (J. A. Burgoyne, J. Wild, I. Fujinaga, ISMIR 2011)
- the other `*.json` / `.timeline.json`: iReal Pro chart chords laid on a madmom beat grid (D-37), a secondary yardstick.
