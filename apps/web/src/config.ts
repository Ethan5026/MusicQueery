export const SPOTIFY_CLIENT_ID: string = import.meta.env.VITE_SPOTIFY_CLIENT_ID ?? ''
// Same origin in production (the Worker serves both); Vite proxies /api in dev.
export const API_URL: string = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')
export const BUILD: string = __BUILD__

export const SPOTIFY_SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
].join(' ')

export function redirectUri(): string {
  return `${location.origin}/callback`
}

export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || matchMedia('(display-mode: standalone)').matches
}
