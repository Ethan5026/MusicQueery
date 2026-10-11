// Shared by Generated and Drills: the picked backing track, its band card, and Play (open on the band's clock,
// start, and go to Stand). The track open on Stand is edited live; any other pick only changes its own spec.
import { useState } from 'react'
import { band } from '../../audio/engine'
import type { BandKind, BandSpec } from '../../audio/library'
import { ensureBand, openBand, playBand, updateBand, useSession } from '../../services'
import { BandCard } from './BandCard'

export interface Pick {
  spec: BandSpec
  mode: 'major' | 'minor'
  title: string
}

export function useBackingPick(kinds: BandKind[]) {
  const open = useSession((s) => (s.driver === 'audio' ? s.band : null))
  const openTitle = useSession((s) => s.meta?.title ?? '')
  const [pick, setPick] = useState<Pick | null>(null)
  const isLive = (p: Pick | null): boolean => !!(p && open && open.kind === p.spec.kind && open.ref === p.spec.ref)
  // nothing picked yet: show the open track if it belongs to this list
  const current: Pick | null = pick ?? (open && kinds.includes(open.kind) ? { spec: open, mode: open.mode, title: openTitle } : null)
  const live = isLive(current)
  const spec = live && open ? open : current?.spec

  const change = (patch: Partial<BandSpec>) => {
    if (!current) return
    if (live) void updateBand(patch)
    setPick({ ...current, spec: { ...(live && open ? open : current.spec), ...patch } })
  }

  const play = () => {
    if (!current || !spec) return
    // unlock audio inside the tap, before anything awaits
    void ensureBand()
    void (async () => {
      if (!(live && band.playing)) {
        if (!live && !(await openBand(spec))) return
        if (!(await playBand())) return
      }
      useSession.getState().setTab('stand')
    })()
  }

  const card =
    current && spec ? (
      <BandCard spec={spec} mode={current.mode} title={current.title} live={live} onChange={change} onPlay={play} />
    ) : null

  return { pick: current, setPick, live, card, openRef: open?.ref ?? null }
}
