/// <reference types="vite/client" />
declare const __BUILD__: string

interface ImportMetaEnv {
  readonly VITE_SPOTIFY_CLIENT_ID?: string
  readonly VITE_API_URL?: string
}
