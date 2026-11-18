// Runs on the audio thread. Mixes the inputs to mono, resamples to the target rate with an averaging filter
// (cheap anti-aliasing that is plenty for speech) and posts 16-bit frames with their loudness.
class SynapseRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options.processorOptions || {};
    this.ratio = sampleRate / (opts.targetRate || 16000);
    this.frame = new Int16Array(opts.frameSamples || 1600);
    this.filled = 0;
    this.sum = 0;
    this.count = 0;
    this.phase = 0;
    this.energy = 0;
    this.running = true;
    this.port.onmessage = event => {
      if (event.data !== "stop") return;
      this.emit();
      this.running = false;
      this.port.postMessage({ done: true });
    };
  }

  emit() {
    if (!this.filled) return;
    const pcm = this.frame.slice(0, this.filled);
    const rms = Math.sqrt(this.energy / this.filled);
    this.filled = 0;
    this.energy = 0;
    this.port.postMessage({ pcm, rms }, [pcm.buffer]);
  }

  process(inputs) {
    if (!this.running) return false;
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      this.sum += channel[i];
      this.count++;
      this.phase += 1;
      if (this.phase < this.ratio) continue;
      this.phase -= this.ratio;
      let s = this.sum / this.count;
      this.sum = 0;
      this.count = 0;
      s = s > 1 ? 1 : s < -1 ? -1 : s;
      this.energy += s * s;
      this.frame[this.filled++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.filled === this.frame.length) this.emit();
    }
    return true;
  }
}

registerProcessor("synapse-recorder", SynapseRecorder);
