// AudioWorklet: click onset detector for the drift probe. Plain JS (loaded as a URL, not bundled).
// High-pass, then a fast peak follower against a slow noise-floor follower; an onset is the first
// sample where the peak rises `ratio` times above the floor, with a refractory gap after it.

class OnsetProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.prevX = 0
    this.hp = 0
    this.peak = 0
    this.floor = 1e-4
    this.ratio = 6
    this.minPeak = 0.01
    this.refractory = Math.round(0.25 * sampleRate)
    this.last = -1e12
    this.meterMax = 0
    this.meterAt = 0
    this.peakDecay = Math.exp(-1 / (0.005 * sampleRate))
    this.floorAlpha = 1 / (0.8 * sampleRate)
    this.port.onmessage = (e) => {
      const d = e.data
      if (d.refractoryS) this.refractory = Math.round(d.refractoryS * sampleRate)
      if (d.ratio) this.ratio = d.ratio
      if (d.minPeak) this.minPeak = d.minPeak
    }
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i]
      this.hp = 0.98 * (this.hp + x - this.prevX)
      this.prevX = x
      const a = Math.abs(this.hp)
      this.peak = a > this.peak ? a : this.peak * this.peakDecay
      this.floor += (this.peak - this.floor) * this.floorAlpha
      if (this.peak > this.meterMax) this.meterMax = this.peak
      const frame = currentFrame + i
      if (frame - this.last > this.refractory && this.peak > this.minPeak && this.peak > this.ratio * this.floor) {
        this.last = frame
        this.port.postMessage({ type: 'onset', frame, level: this.peak, floor: this.floor })
      }
    }
    if (currentFrame - this.meterAt > sampleRate / 10) {
      this.port.postMessage({ type: 'meter', peak: this.meterMax, floor: this.floor })
      this.meterMax = 0
      this.meterAt = currentFrame
    }
    return true
  }
}

registerProcessor('onset-processor', OnsetProcessor)
