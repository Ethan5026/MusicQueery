// IndexedDB (D-15): settings, cached timelines and track names, so the app opens offline.
// A tiny promise wrapper; every call fails soft (private mode or blocked storage) and logs.
import { log } from '../debug/log'

const DB = 'musicqueery'
const VERSION = 1
export type StoreName = 'settings' | 'timelines' | 'tracks'
const STORES: StoreName[] = ['settings', 'timelines', 'tracks']

let opening: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, VERSION)
      req.onupgradeneeded = () => {
        for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => {
        log('warn', 'idb.open_failed', { err: String(req.error) })
        resolve(null)
      }
    } catch (err) {
      log('warn', 'idb.open_failed', { err: String(err) })
      resolve(null)
    }
  })
  return opening
}

async function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const db = await open()
  if (!db) return undefined
  return new Promise((resolve) => {
    try {
      const req = fn(db.transaction(store, mode).objectStore(store))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => {
        log('warn', 'idb.failed', { store, mode, err: String(req.error) })
        resolve(undefined)
      }
    } catch (err) {
      log('warn', 'idb.failed', { store, mode, err: String(err) })
      resolve(undefined)
    }
  })
}

export const idbGet = <T>(store: StoreName, key: string): Promise<T | undefined> =>
  run(store, 'readonly', (s) => s.get(key) as IDBRequest<T>)

export const idbSet = async (store: StoreName, key: string, value: unknown): Promise<void> => {
  await run(store, 'readwrite', (s) => s.put(value, key))
}

export const idbDelete = async (store: StoreName, key: string): Promise<void> => {
  await run(store, 'readwrite', (s) => s.delete(key))
}

export const idbKeys = async (store: StoreName): Promise<string[]> =>
  ((await run(store, 'readonly', (s) => s.getAllKeys())) ?? []).map(String)
