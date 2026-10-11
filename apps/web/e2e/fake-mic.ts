// A stand-in microphone for the listening tests (M7). Playwright's WebKit on Windows has no Web Audio (D-63) and no
// mic, so before the app loads this installs getUserMedia, an AudioContext on performance.now(), and an
// AudioWorkletNode that, once the listener hands it the decoder Worker's port, streams a synthesised
// C – Am – F – G loop (4 beats each at 100 BPM, harmonic tones over a bass note, a kick on every beat) in real time.
// The real decoder Worker runs on it; what the iPhone's mic hears over speakers is the SP7 test's job.
export const FAKE_MIC = () => {
  const SR = 22050
  const BPM = 100
  const CHORDS = [
    [48, 60, 64, 67],
    [45, 57, 60, 64],
    [41, 57, 60, 65],
    [43, 55, 59, 62],
  ]
  const t0 = performance.now()
  const now = () => (performance.now() - t0) / 1000
  const node = () => ({ connect: (n: unknown) => n, disconnect() {} })

  class FakeMicContext {
    sampleRate = SR
    baseLatency = 0.005
    outputLatency = 0.01
    state = 'running'
    destination = node()
    audioWorklet = { addModule: () => Promise.resolve() }
    get currentTime() {
      return now()
    }
    resume() {
      return Promise.resolve()
    }
    close() {
      return Promise.resolve()
    }
    createGain() {
      return { ...node(), gain: { value: 1 } }
    }
    createMediaStreamSource() {
      return node()
    }
    getOutputTimestamp() {
      return { contextTime: now(), performanceTime: performance.now() }
    }
  }

  class FakeWorkletNode {
    port = {
      onmessage: null as ((e: MessageEvent) => void) | null,
      postMessage: (msg: { port?: MessagePort }) => {
        if (msg.port) feed(msg.port, this.port)
      },
    }
    connect(n: unknown) {
      return n
    }
    disconnect() {
      stopped = true
    }
  }

  let stopped = false
  function feed(out: MessagePort, meterPort: { onmessage: ((e: MessageEvent) => void) | null }) {
    const beat = 60 / BPM
    let frame = Math.round(now() * SR)
    const tick = () => {
      if (stopped) return
      const target = Math.round(now() * SR)
      while (frame + 2048 <= target) {
        const buf = new Float32Array(2048)
        let peak = 0
        for (let i = 0; i < 2048; i++) {
          const t = (frame + i) / SR
          const chord = CHORDS[Math.floor(t / (4 * beat)) % 4]!
          let x = 0
          for (const m of chord) {
            const f = 440 * 2 ** ((m - 69) / 12)
            for (let h = 1; h <= 5; h++) x += (0.04 * 0.6 ** (h - 1)) * Math.sin(2 * Math.PI * f * h * t)
          }
          const sinceBeat = t % beat
          if (sinceBeat < 0.06) x += 0.4 * Math.exp(-sinceBeat / 0.012) * Math.sin(2 * Math.PI * 60 * sinceBeat)
          buf[i] = x
          peak = Math.max(peak, Math.abs(x))
        }
        out.postMessage({ frame, samples: buf }, [buf.buffer])
        meterPort.onmessage?.({ data: { type: 'meter', peak, busyMs: 0, blocks: 16 } } as MessageEvent)
        frame += 2048
      }
      setTimeout(tick, 40)
    }
    tick()
  }

  const track = {
    stop() {},
    getSettings: () => ({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: SR }),
  }
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: () => Promise.resolve({ getAudioTracks: () => [track], getTracks: () => [track] }) },
  })
  ;(window as unknown as { AudioContext: unknown }).AudioContext = FakeMicContext
  ;(window as unknown as { AudioWorkletNode: unknown }).AudioWorkletNode = FakeWorkletNode
}
