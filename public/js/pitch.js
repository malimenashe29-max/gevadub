// YIN pitch detection (de Cheveigné & Kawahara). Returns Hz, or 0 when the frame isn't voiced.

export function yin(frame, sampleRate, { minHz = 70, maxHz = 1000, threshold = 0.12 } = {}) {
  const maxTau = Math.min(Math.floor(sampleRate / minHz), Math.floor(frame.length / 2));
  const minTau = Math.max(2, Math.floor(sampleRate / maxHz));
  const W = frame.length - maxTau;
  if (W < 32) return 0;

  let energy = 0;
  for (let i = 0; i < W; i++) energy += frame[i] * frame[i];
  if (energy / W < 1e-5) return 0; // silence

  const d = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) { const x = frame[i] - frame[i + tau]; s += x * x; }
    d[tau] = s;
  }
  // cumulative mean normalized difference
  let run = 0;
  d[0] = 1;
  for (let tau = 1; tau <= maxTau; tau++) { run += d[tau]; d[tau] = run ? (d[tau] * tau) / run : 1; }

  let tau = -1;
  for (let t = minTau; t <= maxTau; t++) {
    if (d[t] < threshold) {
      while (t + 1 <= maxTau && d[t + 1] < d[t]) t++;
      tau = t; break;
    }
  }
  if (tau < 0) return 0;
  // parabolic interpolation
  const a = d[tau - 1] ?? d[tau], b = d[tau], c = d[tau + 1] ?? d[tau];
  const denom = a + c - 2 * b;
  const shift = denom ? (a - c) / (2 * denom) : 0;
  return sampleRate / (tau + shift);
}

// Box-filter decimation. Voice pitch lives well under 1 kHz, so ~11 kHz is plenty for analysis.
export function decimate(x, factor) {
  if (factor <= 1) return x;
  const out = new Float32Array(Math.floor(x.length / factor));
  for (let i = 0, j = 0; i < out.length; i++) {
    let s = 0;
    for (let k = 0; k < factor; k++) s += x[j++];
    out[i] = s / factor;
  }
  return out;
}
export const analysisFactor = sr => Math.max(1, Math.floor(sr / 11025));

// Pitch + loudness every ~20 ms. Times are in seconds of the original signal.
export function track(input, inputRate, { hopSec = 0.02, sizeSec = 0.046, minHz, maxHz } = {}) {
  const f = analysisFactor(inputRate);
  const samples = decimate(input, f);
  const sampleRate = inputRate / f;
  const hop = Math.round(hopSec * sampleRate), size = Math.round(sizeSec * sampleRate);
  const out = [];
  for (let i = 0; i + size <= samples.length; i += hop) {
    const frame = samples.subarray(i, i + size);
    let s = 0;
    for (let j = 0; j < size; j++) s += frame[j] * frame[j];
    const level = Math.sqrt(s / size);
    out.push({ t: (i + size / 2) / sampleRate, f0: level > 0.008 ? yin(frame, sampleRate, { minHz, maxHz }) : 0, level });
  }
  // light median smoothing to kill octave blips
  for (let i = 1; i < out.length - 1; i++) {
    const v = [out[i - 1].f0, out[i].f0, out[i + 1].f0].sort((x, y) => x - y);
    out[i].f0s = v[1];
  }
  if (out.length) { out[0].f0s = out[0].f0; out[out.length - 1].f0s = out[out.length - 1].f0; }
  return out;
}

export const hzToMidi = hz => 69 + 12 * Math.log2(hz / 440);
export const midiToHz = m => 440 * Math.pow(2, (m - 69) / 12);

export function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))];
}
