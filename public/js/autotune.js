// The dice. Hard-snap auto-tune with zero glide, done with TD-PSOLA:
// find each glottal pulse, then re-space the pulses at the period of the nearest allowed note.
// Snapping to a pentatonic scale instead of all 12 notes makes the jumps bigger, which is the point.

import { yin, hzToMidi, midiToHz, decimate, analysisFactor } from './pitch.js';

const PENTA = [0, 2, 4, 7, 9];

function snap(midi, root) {
  const rel = midi - root;
  const oct = Math.floor(rel / 12);
  let best = 0, bestD = Infinity;
  for (const p of [...PENTA, 12]) {
    const d = Math.abs(rel - (oct * 12 + p));
    if (d < bestD) { bestD = d; best = oct * 12 + p; }
  }
  return root + best;
}

export function chaosTune(x, sr, { root = 55, extra = 0 } = {}) {
  // Pitch is found on a decimated copy (fast); pulses are cut from the full-rate signal.
  const dec = analysisFactor(sr);
  const xd = decimate(x, dec);
  const srd = sr / dec;
  const hop = Math.round(sr * 0.005);          // 5 ms analysis hop, in full-rate samples
  const size = Math.round(srd * 0.04);         // 40 ms window, in decimated samples
  const frames = Math.ceil(x.length / hop);
  const f0 = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const start = Math.round((f * hop) / dec) - (size >> 1);
    if (start < 0 || start + size > xd.length) continue;
    const fr = xd.subarray(start, start + size);
    let e = 0;
    for (let i = 0; i < fr.length; i += 2) e += fr[i] * fr[i];
    if (e / (fr.length / 2) < 2e-5) continue;
    f0[f] = yin(fr, srd, { minHz: 75, maxHz: 700, threshold: 0.15 });
  }
  // fill single-frame gaps so pulses don't stutter
  for (let f = 1; f < frames - 1; f++) if (!f0[f] && f0[f - 1] && f0[f + 1]) f0[f] = (f0[f - 1] + f0[f + 1]) / 2;

  const f0At = i => f0[Math.min(frames - 1, Math.max(0, Math.round(i / hop)))];

  // analysis pitch marks
  const marks = [];
  const unvoicedStep = Math.round(sr * 0.008);
  let i = 0;
  while (i < x.length) {
    const hz = f0At(i);
    if (hz) {
      const T = sr / hz;
      // snap the mark to the strongest peak near where the next pulse should be
      const lo = Math.max(0, Math.round(i - T * 0.25)), hi = Math.min(x.length - 1, Math.round(i + T * 0.25));
      let p = i, pv = -Infinity;
      for (let k = lo; k <= hi; k++) if (x[k] > pv) { pv = x[k]; p = k; }
      if (marks.length && p <= marks[marks.length - 1].pos) p = marks[marks.length - 1].pos + Math.round(T * 0.5);
      marks.push({ pos: p, T, voiced: true });
      i = Math.round(p + T);
    } else {
      marks.push({ pos: i, T: unvoicedStep, voiced: false });
      i += unvoicedStep;
    }
  }
  if (marks.length < 2) return x.slice();

  const y = new Float32Array(x.length);
  const wsum = new Float32Array(x.length);
  let m = 0;
  let ts = marks[0].pos;
  while (ts < x.length) {
    while (m + 1 < marks.length && Math.abs(marks[m + 1].pos - ts) < Math.abs(marks[m].pos - ts)) m++;
    const mk = marks[m];
    const T0 = Math.max(16, Math.round(mk.T));
    let T1 = T0;
    if (mk.voiced) {
      const hz = sr / mk.T;
      const target = snap(hzToMidi(hz), root) + extra;
      T1 = Math.max(16, Math.round(sr / midiToHz(target)));
    }
    // overlap-add a two-period Hann grain from the analysis mark at the synthesis position
    const L = T0;
    for (let k = -L; k < L; k++) {
      const si = mk.pos + k, di = Math.round(ts) + k;
      if (si < 0 || si >= x.length || di < 0 || di >= y.length) continue;
      const w = 0.5 - 0.5 * Math.cos((Math.PI * (k + L)) / L);
      y[di] += x[si] * w;
      wsum[di] += w;
    }
    ts += T1;
  }
  for (let k = 0; k < y.length; k++) y[k] = wsum[k] > 0.15 ? y[k] / wsum[k] : y[k];

  // a touch of grit so it reads as "effect", not "mistake"
  for (let k = 0; k < y.length; k++) y[k] = Math.tanh(y[k] * 1.6) / 1.25;
  return y;
}
