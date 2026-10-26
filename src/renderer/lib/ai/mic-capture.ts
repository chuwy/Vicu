/**
 * The one recorder local speech uses (docs/ai-assistant-v1.md section 3.1): the microphone through
 * an AudioContext running at 16 kHz (Chromium resamples), mixed down to mono by an AudioWorklet
 * (pcm-worklet.js) and handed to `onChunk` in blocks of 100 ms of float samples. Where the worklet
 * cannot load, a ScriptProcessorNode does the same on the main thread.
 *
 * Audio is kept in memory only: each block goes to the main process, which drops it once its
 * phrase is transcribed.
 */
export interface MicCapture {
  /** Stops recording; resolves once the last samples were handed over. */
  stop(): Promise<void>
}

export const CAPTURE_SAMPLE_RATE = 16000

export async function startMicCapture(onChunk: (samples: Float32Array) => void): Promise<MicCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  const context = new AudioContext({ sampleRate: CAPTURE_SAMPLE_RATE })
  const source = context.createMediaStreamSource(stream)
  // Nodes are pulled by the graph only when they reach the destination: a muted gain keeps them running.
  const sink = context.createGain()
  sink.gain.value = 0
  sink.connect(context.destination)

  let stopTap: () => Promise<void>
  try {
    await context.audioWorklet.addModule(new URL('./pcm-worklet.js', import.meta.url).href)
    const node = new AudioWorkletNode(context, 'vicu-pcm-tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCountMode: 'explicit', channelCount: 1 })
    node.port.onmessage = (event: MessageEvent<Float32Array>) => onChunk(event.data)
    source.connect(node)
    node.connect(sink)
    stopTap = async () => {
      node.port.postMessage('flush')
      // The flushed block arrives on the next message turn.
      await new Promise((resolve) => setTimeout(resolve, 30))
      source.disconnect()
      node.disconnect()
      node.port.onmessage = null
    }
  } catch {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- the fallback where the worklet cannot load
    const processor = context.createScriptProcessor(2048, 1, 1)
    processor.onaudioprocess = (event) => onChunk(new Float32Array(event.inputBuffer.getChannelData(0)))
    source.connect(processor)
    processor.connect(sink)
    stopTap = async () => {
      source.disconnect()
      processor.disconnect()
      processor.onaudioprocess = null
    }
  }
  if (context.state === 'suspended') await context.resume().catch(() => {})

  let stopped = false
  return {
    stop: async () => {
      if (stopped) return
      stopped = true
      await stopTap().catch(() => {})
      for (const track of stream.getTracks()) track.stop()
      await context.close().catch(() => {})
    },
  }
}
