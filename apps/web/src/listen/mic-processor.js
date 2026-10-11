// AudioWorklet: hands the mic's samples to the chord decoder's Worker in 2048-sample chunks (M7). Plain JS, loaded
// as a URL. The Worker's port arrives in the first message; chunks are transferred, not copied. It also reports
// how long process() takes (SP7: worklet CPU) and the level, ten times a second. For the echo test it records
// `length` frames of input from frame `from` and posts them back on its own port.

class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.out = null
    this.size = 2048
    this.buf = new Float32Array(this.size)
    this.n = 0
    this.first = -1
    this.peak = 0
    this.busy = 0
    this.blocks = 0
    this.meterAt = 0
    this.rec = null
    this.port.onmessage = (e) => {
      if (e.data && e.data.port) this.out = e.data.port
      if (e.data && e.data.type === 'record') this.rec = { from: e.data.from, buf: new Float32Array(e.data.length) }
    }
  }

  process(inputs) {
    const t0 = Date.now()
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    for (let i = 0; i < ch.length; i++) {
      if (this.n === 0) this.first = currentFrame + i
      const x = ch[i]
      this.buf[this.n++] = x
      if (this.rec) {
        const k = currentFrame + i - this.rec.from
        if (k >= 0 && k < this.rec.buf.length) this.rec.buf[k] = x
        if (k === this.rec.buf.length - 1) {
          this.port.postMessage({ type: 'recorded', from: this.rec.from, samples: this.rec.buf }, [this.rec.buf.buffer])
          this.rec = null
        }
      }
      const a = x < 0 ? -x : x
      if (a > this.peak) this.peak = a
      if (this.n === this.size) {
        if (this.out) this.out.postMessage({ frame: this.first, samples: this.buf }, [this.buf.buffer])
        this.buf = new Float32Array(this.size)
        this.n = 0
      }
    }
    this.busy += Date.now() - t0
    this.blocks++
    if (currentFrame - this.meterAt >= sampleRate / 10) {
      this.port.postMessage({ type: 'meter', peak: this.peak, busyMs: this.busy, blocks: this.blocks })
      this.peak = 0
      this.busy = 0
      this.blocks = 0
      this.meterAt = currentFrame
    }
    return true
  }
}

registerProcessor('mic-processor', MicProcessor)
