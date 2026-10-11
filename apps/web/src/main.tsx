import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { isStandalone } from './config'
import { log, startRemoteLog } from './debug/log'
import { perf } from './perf'
import { restoreSession, runClock, useApp } from './services'
import { handleCallback } from './spotify/auth'
import { loadSettings } from './store/settings'
import { Shell } from './ui/Shell'
import './ui/fonts'
import './ui/app.css'

startRemoteLog()
log('info', 'boot', {
  build: __BUILD__,
  standalone: isStandalone(),
  ua: navigator.userAgent,
  path: location.pathname,
})

if (new URLSearchParams(location.search).has('debug') || localStorage.getItem('mq.debug') === '1') {
  void import('eruda').then(({ default: eruda }) => eruda.init())
}

registerSW({
  immediate: true,
  onRegisteredSW: (url) => log('info', 'sw.registered', { url }),
  onRegisterError: (err) => log('error', 'sw.error', { err: String(err) }),
})

void navigator.storage?.persist?.().then((persisted) => log('info', 'storage.persist', { persisted }))

void Promise.all([handleCallback(), loadSettings()]).then(([handled]) => {
  if (handled) useApp.getState().refreshAuth()
  runClock()
  perf.start()
  void restoreSession()
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <Shell />
    </StrictMode>,
  )
})
