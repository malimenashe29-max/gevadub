// Songs from the gallery. All of this runs on the device; the file never leaves it.

import { decode, mono } from './audio.js';
import { track, hzToMidi, percentile } from './pitch.js';
import { getSong } from './util.js';

export const MAX_SECONDS = 180;

export async function decodeFile(file) {
  const buf = await file.arrayBuffer();
  let audio;
  try { audio = await decode(buf); }
  catch { throw new Error('לא הצלחנו לקרוא את הקובץ. נסו סרטון MP4 או קובץ שמע אחר.'); }
  if (audio.duration < 5) throw new Error('הקטע קצר מדי. צריך לפחות 5 שניות.');
  return { audio, bytes: buf };
}

// How much of the song is off-center. Vocals usually sit dead center; if the file is mono,
// there's nothing to subtract and the singer stays.
export function sideRatio(audio) {
  if (audio.numberOfChannels < 2) return 0;
  const L = audio.getChannelData(0), R = audio.getChannelData(1);
  let m = 0, s = 0;
  for (let i = 0; i < L.length; i += 7) { const a = L[i] + R[i], b = L[i] - R[i]; m += a * a; s += b * b; }
  return m ? Math.sqrt(s / m) : 0;
}

// Classic karaoke: keep what's different between left and right (instruments spread wide),
// throw away the center (the singer), then put the bass back from the center below 150 Hz.
export async function removeVocals(audio) {
  const sr = audio.sampleRate;
  const len = Math.min(audio.length, Math.ceil(MAX_SECONDS * sr));
  const ctx = new OfflineAudioContext(2, len, sr);
  const src = ctx.createBufferSource(); src.buffer = audio;
  const split = ctx.createChannelSplitter(2);
  const merge = ctx.createChannelMerger(2);
  src.connect(split);

  const side = ctx.createGain(); side.gain.value = 1;
  const l = ctx.createGain(); l.gain.value = 1;
  const r = ctx.createGain(); r.gain.value = -1;
  split.connect(l, 0); split.connect(r, audio.numberOfChannels > 1 ? 1 : 0);
  l.connect(side); r.connect(side);

  const mid = ctx.createGain(); mid.gain.value = 0.5;
  split.connect(mid, 0); if (audio.numberOfChannels > 1) split.connect(mid, 1);
  const low = ctx.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 150; low.Q.value = 0.6;
  mid.connect(low);

  const sideL = ctx.createGain(); sideL.gain.value = 0.85;
  const sideR = ctx.createGain(); sideR.gain.value = -0.85;
  side.connect(sideL).connect(merge, 0, 0);
  side.connect(sideR).connect(merge, 0, 1);
  low.connect(merge, 0, 0); low.connect(merge, 0, 1);
  merge.connect(ctx.destination);
  src.start();
  return ctx.startRendering();
}

export function trimmed(audio) {
  const sr = audio.sampleRate;
  const len = Math.min(audio.length, Math.ceil(MAX_SECONDS * sr));
  if (len === audio.length) return audio;
  const out = new AudioBuffer({ length: len, numberOfChannels: audio.numberOfChannels, sampleRate: sr });
  for (let c = 0; c < audio.numberOfChannels; c++) out.copyToChannel(audio.getChannelData(c).subarray(0, len), c);
  return out;
}

// Loudness every quarter second. Good enough to tell "same TikTok" from "different song".
export function fingerprint(audio) {
  const x = mono(audio), sr = audio.sampleRate, step = Math.floor(sr / 4);
  const n = Math.min(360, Math.floor(x.length / step));
  const out = [];
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * step; j < (i + 1) * step; j += 4) s += x[j] * x[j];
    out.push(Math.sqrt(s / (step / 4)));
  }
  const max = Math.max(...out, 1e-6);
  return out.map(v => Math.round((v / max) * 1000) / 1000);
}

export function sameSong(a, b) {
  if (!a?.length || !b?.length) return { ok: false, score: 0 };
  let best = 0;
  for (let lag = -8; lag <= 8; lag++) {
    const xs = [], ys = [];
    for (let i = 0; i < a.length; i++) { const j = i + lag; if (j >= 0 && j < b.length) { xs.push(a[i]); ys.push(b[j]); } }
    if (xs.length < 12) continue;
    const mx = xs.reduce((p, c) => p + c, 0) / xs.length, my = ys.reduce((p, c) => p + c, 0) / ys.length;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < xs.length; i++) { const u = xs[i] - mx, v = ys[i] - my; num += u * v; dx += u * u; dy += v * v; }
    const r = num / Math.sqrt(dx * dy || 1);
    if (r > best) best = r;
  }
  const lenOk = Math.abs(a.length - b.length) <= 8;
  return { ok: best > 0.82 && lenOk, score: best };
}

// Rough register of each line, read from the center channel (where the singer is).
export function lineRegisters(audio, lines) {
  const sr = audio.sampleRate;
  const L = audio.getChannelData(0), R = audio.numberOfChannels > 1 ? audio.getChannelData(1) : L;
  return lines.map(l => {
    const a = Math.max(0, Math.floor(l.t0 * sr)), b = Math.min(L.length, Math.floor(l.t1 * sr));
    if (b - a < sr * 0.5) return null;
    const mid = new Float32Array(b - a);
    for (let i = 0; i < mid.length; i++) mid[i] = (L[a + i] + R[a + i]) * 0.5;
    const fr = track(mid, sr, { minHz: 90, maxHz: 900 });
    const voiced = fr.filter(f => f.f0s > 0).map(f => hzToMidi(f.f0s));
    if (voiced.length < fr.length * 0.3) return null;
    return percentile(voiced, 50);
  });
}

// What a member needs to play an imported song: the original (to sing along to) and the instrumental.
// The room decides whether the original singer stays, so every member's video matches.
export async function loadImported(code, keepSinger) {
  const rec = await getSong(`room:${code}`);
  if (!rec) return null;
  const { audio } = await decodeFile(new Blob([rec.bytes]));
  const full = trimmed(audio);
  const keep = keepSinger || sideRatio(audio) <= 0.08;
  const instrumental = keep ? full : await removeVocals(audio);
  return { full, instrumental, keepSinger: keep };
}
