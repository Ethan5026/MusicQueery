import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { isStandalone } from './config'
import { log, startRemoteLog } from './debug/log'
import { runClock, useApp } from './services'
import { handleCallback } from './spotify/auth'
import { App } from './ui/App'
import './ui/styles.css'

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

void handleCallback().then((handled) => {
  if (handled) useApp.getState().refreshAuth()
  runClock()
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
