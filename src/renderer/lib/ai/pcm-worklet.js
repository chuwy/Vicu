// The microphone tap of local speech (docs/ai-assistant-v1.md section 3.1), run on the audio
// thread: the AudioContext already runs at 16 kHz, so this only mixes the input down to mono and
// hands it over in blocks of 100 ms. Plain JavaScript: it is loaded as a module by
// AudioWorklet.addModule (lib/ai/mic-capture.ts), outside the bundle.
const BLOCK = 1600

class VicuPcmTap extends AudioWorkletProcessor {
  constructor() {
    super()
    this.block = new Float32Array(BLOCK)
    this.filled = 0
    this.port.onmessage = (event) => {
      if (event.data === 'flush' && this.filled > 0) {
        this.port.postMessage(this.block.slice(0, this.filled))
        this.filled = 0
      }
    }
  }

  process(inputs) {
    const channels = inputs[0]
    if (!channels || channels.length === 0) return true
    const frames = channels[0].length
    for (let i = 0; i < frames; i++) {
      let sum = 0
      for (let c = 0; c < channels.length; c++) sum += channels[c][i]
      this.block[this.filled++] = sum / channels.length
      if (this.filled === BLOCK) {
        this.port.postMessage(this.block)
        this.block = new Float32Array(BLOCK)
        this.filled = 0
      }
    }
    return true
  }
}

registerProcessor('vicu-pcm-tap', VicuPcmTap)
