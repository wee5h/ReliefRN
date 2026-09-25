// AudioWorklet: stream 24 kHz mono PCM16 in 40 ms chunks, without recording files.
class VoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Int16Array(960);
    this.index = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const value of input) {
      const sample = Math.max(-1, Math.min(1, value));
      this.chunk[this.index++] = sample < 0 ? sample * 32768 : sample * 32767;
      if (this.index === this.chunk.length) {
        this.port.postMessage(this.chunk.buffer, [this.chunk.buffer]);
        this.chunk = new Int16Array(960);
        this.index = 0;
      }
    }
    return true;
  }
}
registerProcessor('voice-capture', VoiceCapture);
