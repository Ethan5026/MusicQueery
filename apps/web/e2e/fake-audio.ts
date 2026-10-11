// Playwright's WebKit on Windows ships without Web Audio, so the band tests install this stand-in before the app
// loads: a context whose clock runs on performance.now(), silent buffers, and nodes that accept every call. It checks
// the UI, the scheduler and the AudioClock; how the band sounds on the iPhone is the SP5 audio test's job.
export const FAKE_AUDIO = () => {
  const param = () => ({ value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} })
  const node = () => ({ connect: (n: unknown) => n, disconnect() {} })
  class FakeAudioContext {
    sampleRate = 44100
    baseLatency = 0.005
    outputLatency = 0.02
    state = 'running'
    destination = node()
    private t0 = performance.now()
    get currentTime() {
      return (performance.now() - this.t0) / 1000
    }
    resume() {
      return Promise.resolve()
    }
    close() {
      return Promise.resolve()
    }
    createGain() {
      return { ...node(), gain: param() }
    }
    createDynamicsCompressor() {
      return { ...node(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }
    }
    createBuffer(_c: number, len: number, rate: number) {
      return { duration: len / rate, sampleRate: rate, getChannelData: () => new Float32Array(len) }
    }
    createBufferSource() {
      return { ...node(), buffer: null, playbackRate: param(), start() {}, stop() {} }
    }
    decodeAudioData() {
      const data = new Float32Array(4410)
      data[100] = 1
      return Promise.resolve({ duration: 0.1, sampleRate: 44100, getChannelData: () => data })
    }
    getOutputTimestamp() {
      return { contextTime: this.currentTime, performanceTime: performance.now() }
    }
  }
  ;(window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext
}
