// Runs on the audio thread. Captures the mic from an exact context time.
class GevaRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.armed = false;
    this.at = 0;
    this.until = 0;
    this.pending = [];
    this.pendingLen = 0;
    this.levelAcc = 0;
    this.levelN = 0;
    this.port.onmessage = e => {
      const d = e.data;
      if (d.cmd === 'arm') { this.armed = true; this.at = d.at; this.until = d.until; this.pending = []; this.pendingLen = 0; }
      if (d.cmd === 'stop' && this.armed) { this.until = Math.min(this.until, currentTime); }
    };
  }

  flush() {
    if (!this.pendingLen) return;
    const out = new Float32Array(this.pendingLen);
    let o = 0;
    for (const p of this.pending) { out.set(p, o); o += p.length; }
    this.port.postMessage({ type: 'chunk', data: out }, [out.buffer]);
    this.pending = []; this.pendingLen = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;

    for (let i = 0; i < ch.length; i++) { this.levelAcc += ch[i] * ch[i]; }
    this.levelN += ch.length;
    if (this.levelN >= 2048) {
      this.port.postMessage({ type: 'level', value: Math.sqrt(this.levelAcc / this.levelN) });
      this.levelAcc = 0; this.levelN = 0;
    }

    if (!this.armed) return true;
    const t = currentTime;
    const blockEnd = t + ch.length / sampleRate;
    if (blockEnd > this.at && t < this.until) {
      const from = Math.max(0, Math.round((this.at - t) * sampleRate));
      const to = Math.min(ch.length, Math.round((this.until - t) * sampleRate));
      if (to > from) {
        this.pending.push(ch.slice(from, to));
        this.pendingLen += to - from;
        if (this.pendingLen >= sampleRate / 2) this.flush();
      }
    }
    if (t >= this.until) {
      this.flush();
      this.armed = false;
      this.port.postMessage({ type: 'done' });
    }
    return true;
  }
}
registerProcessor('geva-recorder', GevaRecorder);
