// Audio plumbing: one shared context, WAV in and out, and a recorder that
// starts on an exact sample so every take lines up with the beat.

let ctx = null;
export function audioCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// AudioContext time for "right now", via the output timestamp when the browser has it.
export function ctxNow() {
  const c = audioCtx();
  if (c.getOutputTimestamp) {
    const ts = c.getOutputTimestamp();
    if (ts.contextTime && ts.performanceTime) return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
  }
  return c.currentTime;
}

export function encodeWav(samples, sampleRate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0, o = 44; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

export async function decode(arrayBuffer) {
  return audioCtx().decodeAudioData(arrayBuffer.slice(0));
}

// Linear resample is fine for voice going 48k -> 24k after a gentle lowpass.
export function downsample(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  // simple moving-average prefilter
  const k = Math.max(1, Math.round(ratio));
  const filtered = new Float32Array(input.length);
  let acc = 0;
  for (let i = 0; i < input.length; i++) {
    acc += input[i];
    if (i >= k) acc -= input[i - k];
    filtered[i] = acc / Math.min(k, i + 1);
  }
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const p = i * ratio, j = Math.floor(p), f = p - j;
    out[i] = filtered[j] * (1 - f) + (filtered[j + 1] || 0) * f;
  }
  return out;
}

export function mono(buffer) {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();
  const a = buffer.getChannelData(0), b = buffer.getChannelData(1);
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] + b[i]) * 0.5;
  return out;
}

export function rms(arr, from = 0, to = arr.length) {
  let s = 0; const n = Math.max(1, to - from);
  for (let i = from; i < to; i++) s += arr[i] * arr[i];
  return Math.sqrt(s / n);
}

// ---------- mic ----------
let workletReady = null;
async function ensureWorklet() {
  const c = audioCtx();
  if (!workletReady) workletReady = c.audioWorklet.addModule('/js/recorder-worklet.js');
  return workletReady;
}

// Without headphones the mic hears the song from the speaker. The browser's echo canceller
// knows exactly what the page is playing and takes it back out, so it's on unless you have headphones.
export async function openMic({ video = false, headphones = false } = {}) {
  const constraints = {
    audio: { echoCancellation: !headphones, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    video: video ? { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 960 }, frameRate: { ideal: 30 } } : false,
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  await ensureWorklet();
  const c = audioCtx();
  const src = c.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(c, 'geva-recorder', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
  src.connect(node);
  // Keep the node pulled by the graph without making the mic audible.
  const sink = c.createGain(); sink.gain.value = 0;
  node.connect(sink).connect(c.destination);

  let level = 0;
  let chunks = [];
  let doneResolve = null;
  node.port.onmessage = e => {
    const d = e.data;
    if (d.type === 'level') level = d.value;
    else if (d.type === 'chunk') chunks.push(d.data);
    else if (d.type === 'done') { doneResolve?.(join(chunks)); doneResolve = null; }
  };

  return {
    stream,
    get level() { return level; },
    sampleRate: c.sampleRate,
    // Record from context time `at` for `duration` seconds.
    record(at, duration) {
      chunks = [];
      node.port.postMessage({ cmd: 'arm', at, until: at + duration });
      return new Promise(r => { doneResolve = r; });
    },
    stop() { node.port.postMessage({ cmd: 'stop' }); },
    close() {
      try { node.port.postMessage({ cmd: 'stop' }); src.disconnect(); node.disconnect(); } catch {}
      stream.getTracks().forEach(t => t.stop());
    },
  };
}

function join(chunks) {
  const len = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Float32Array(len);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// Round trip from speaker to mic. outputLatency is real on most browsers; input we estimate.
export function roundTripLatency() {
  const c = audioCtx();
  return (c.outputLatency || 0) + (c.baseLatency || 0) + 0.012;
}
