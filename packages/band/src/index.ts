// The backing band (M6, D-21): chart → playing-order form → piano, bass and drum events per bar, by style.
// Pure TS (no DOM, no audio): apps/web schedules the events on the Web Audio clock. Also the built-in tunes and
// the all-keys drills, which are plain Chart v1 so they get exact timelines like any chart.
export * from './types'
export * from './form'
export * from './styles'
export * from './rng'
export * from './notes'
export * from './piano'
export * from './bass'
export * from './drums'
export * from './arrange'
export * from './sheet'
export * from './tunes'
export * from './drills'
