// Chord detail per track (M12): plain triads, as heard (or charted), or the 7ths a jazz lead sheet would write
// (`withChordDetail`). Kept on the phone (IndexedDB settings `detail:<id>`); as heard unless the player picks another.
import type { ChordDetail } from '@mq/theory'
import { log } from '../debug/log'
import { idbDelete, idbGet, idbSet } from '../store/idb'

const key = (id: string) => `detail:${id}`

export const loadDetail = async (id: string): Promise<ChordDetail> => (await idbGet<ChordDetail>('settings', key(id))) ?? 'heard'

export async function saveDetail(id: string, detail: ChordDetail): Promise<void> {
  if (detail === 'heard') await idbDelete('settings', key(id))
  else await idbSet('settings', key(id), detail)
  log('info', 'detail.set', { id, detail })
}
