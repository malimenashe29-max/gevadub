// Builds the final track: the bed, plus each person's take cut to their lines.

import { chaosTune } from './autotune.js';
import { singersFor } from './split.js';

const OUT_SR = 44100;

function bufferFrom(samples, sr) {
  const b = new AudioBuffer({ length: Math.max(1, samples.length), numberOfChannels: 1, sampleRate: sr });
  b.copyToChannel(samples, 0);
  return b;
}

// ---------- levels ----------
// How loud someone actually sings: the louder 60% of 20 ms frames inside the given time ranges.
export function singingLevel(samples, sr, ranges) {
  const hop = Math.round(sr * 0.02);
  const frames = [];
  for (const [a, b] of ranges) {
    for (let i = Math.max(0, Math.floor(a * sr)); i + hop <= Math.min(samples.length, Math.floor(b * sr)); i += hop) {
      let s = 0;
      for (let k = i; k < i + hop; k++) s += samples[k] * samples[k];
      const r = Math.sqrt(s / hop);
      if (r > 0.003) frames.push(r);
    }
  }
  if (frames.length < 10) return 0;
  frames.sort((x, y) => y - x);
  const top = frames.slice(0, Math.max(1, Math.round(frames.length * 0.6)));
  return top.reduce((a, v) => a + v, 0) / top.length;
}

// How loud the song is, ignoring silence at the edges.
export function bedLevel(buffer) {
  const sr = buffer.sampleRate, hop = Math.round(sr * 0.05);
  const L = buffer.getChannelData(0), R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
  const frames = [];
  for (let i = 0; i + hop <= L.length; i += hop) {
    let s = 0;
    for (let k = i; k < i + hop; k += 2) { const m = (L[k] + R[k]) * 0.5; s += m * m; }
    frames.push(Math.sqrt(s / (hop / 2)));
  }
  frames.sort((x, y) => x - y);
  const body = frames.slice(Math.floor(frames.length * 0.15));
  return body.length ? body.reduce((a, v) => a + v, 0) / body.length : 0.1;
}

// Under a voice, the song drops to this much. Lower when the original singer is still in it.
export const duckFor = hasSinger => (hasSinger ? 0.32 : 0.5);
// Voices end up about this much louder than the ducked song (≈ +5 dB).
const VOICE_OVER_BED = 1.8;

export function matchGain(takeLevel, bedRms, hasSinger) {
  if (!takeLevel) return 1;
  const target = bedRms * duckFor(hasSinger) * VOICE_OVER_BED;
  return Math.min(40, Math.max(0.3, target / takeLevel));
}

/**
 * @param info    songInfo()
 * @param bed     AudioBuffer under the voices
 * @param bedHasSinger the original vocal is still in the bed (mono file, or the host chose to keep it)
 * @param members [{id, samples: Float32Array, sampleRate}]
 * @param parts   room.parts
 * @param victimId member whose voice goes through the dice
 */
export async function buildMix({ info, bed, bedHasSinger = false, members, parts, victimId, onStep }) {
  const takes = new Map();
  for (const m of members) {
    let s = m.samples;
    if (m.id === victimId) { onStep?.('הקובייה עובדת'); await new Promise(r => setTimeout(r, 20)); s = chaosTune(s, m.sampleRate, { root: info.root }); }
    takes.set(m.id, { buf: bufferFrom(s, m.sampleRate), samples: s, sampleRate: m.sampleRate });
  }
  onStep?.('מערבב');

  const lines = info.lines;
  const segOf = (l, i) => {
    const next = lines[i + 1];
    const a = Math.max(0, l.t0 - 0.25);
    let b = l.t1 + 0.45;
    if (next) b = Math.min(b, next.t0 + 0.05);
    return [a, b];
  };

  // Everyone is brought up (or down) to sit on top of the song, so a quiet phone mic still gets heard.
  const bedRms = bedLevel(bed);
  for (const m of members) {
    const t = takes.get(m.id);
    const ranges = lines.map((l, i) => [l, i]).filter(([, i]) => singersFor(i, parts, members).includes(m.id)).map(([l, i]) => segOf(l, i));
    t.gain = matchGain(singingLevel(t.samples, t.sampleRate, ranges), bedRms, bedHasSinger);
  }

  const duration = Math.max(info.duration, bed.duration);
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * OUT_SR), OUT_SR);

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.12;
  limiter.connect(ctx.destination);

  // The song: carve a pocket where voices live (1-3 kHz), and duck it whenever someone sings.
  const bedSrc = ctx.createBufferSource(); bedSrc.buffer = bed;
  const carve1 = ctx.createBiquadFilter(); carve1.type = 'peaking'; carve1.frequency.value = 1100; carve1.Q.value = 0.8; carve1.gain.value = bedHasSinger ? -9 : -4;
  const carve2 = ctx.createBiquadFilter(); carve2.type = 'peaking'; carve2.frequency.value = 2900; carve2.Q.value = 0.9; carve2.gain.value = bedHasSinger ? -7 : -3;
  const duck = ctx.createGain(); duck.gain.value = 1;
  const bedGain = ctx.createGain(); bedGain.gain.value = 1;
  bedSrc.connect(carve1).connect(carve2).connect(duck).connect(bedGain).connect(limiter); bedSrc.start(0);

  const sung = lines.map((l, i) => [l, i]).filter(([, i]) => singersFor(i, parts, members).some(id => takes.has(id))).map(([l, i]) => segOf(l, i));
  const merged = [];
  for (const [a, b] of sung.sort((x, y) => x[0] - y[0])) {
    const last = merged[merged.length - 1];
    if (last && a - last[1] < 0.6) last[1] = Math.max(last[1], b); else merged.push([a, b]);
  }
  const low = duckFor(bedHasSinger);
  duck.gain.setValueAtTime(1, 0);
  for (const [a, b] of merged) {
    duck.gain.setValueAtTime(1, Math.max(0, a - 0.15));
    duck.gain.linearRampToValueAtTime(low, a + 0.05);
    duck.gain.setValueAtTime(low, b);
    duck.gain.linearRampToValueAtTime(1, b + 0.35);
  }

  const vox = ctx.createDynamicsCompressor();
  vox.threshold.value = -24; vox.ratio.value = 3; vox.attack.value = 0.005; vox.release.value = 0.15; vox.knee.value = 8;
  const voxOut = ctx.createGain(); voxOut.gain.value = 1.35;
  // a little presence so words come through
  const presence = ctx.createBiquadFilter(); presence.type = 'peaking'; presence.frequency.value = 3200; presence.Q.value = 0.9; presence.gain.value = 3;
  vox.connect(presence).connect(voxOut).connect(limiter);
  // small room on the voices so they sit in the same space
  const ir = ctx.createBuffer(2, Math.floor(OUT_SR * 1.2), OUT_SR);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3); }
  const conv = ctx.createConvolver(); conv.buffer = ir;
  const wet = ctx.createGain(); wet.gain.value = 0.16;
  voxOut.connect(conv).connect(wet).connect(limiter);

  const ids = members.map(m => m.id);
  const timeline = [];
  lines.forEach((l, i) => {
    const singers = singersFor(i, parts, members).filter(id => takes.has(id));
    timeline.push({ ...l, index: i, singers, victim: singers.includes(victimId) && !!victimId });
    const [a, b] = segOf(l, i);
    const n = singers.length;
    singers.forEach(id => {
      const t = takes.get(id);
      const src = ctx.createBufferSource(); src.buffer = t.buf;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 110;
      const g = ctx.createGain();
      const level = t.gain * (n > 1 ? 1.1 / Math.sqrt(n) : 1);
      g.gain.setValueAtTime(0, a); g.gain.linearRampToValueAtTime(level, a + 0.04);
      g.gain.setValueAtTime(level, Math.max(a + 0.05, b - 0.09)); g.gain.linearRampToValueAtTime(0, b);
      const pan = ctx.createStereoPanner();
      // a crowd sounds wider than one person
      pan.pan.value = n > 1 ? ((ids.indexOf(id) / Math.max(1, ids.length - 1)) * 2 - 1) * 0.55 : 0;
      src.connect(hp).connect(g).connect(pan).connect(vox);
      if (a < t.buf.duration) src.start(a, a, b - a);
    });
  });

  const out = await ctx.startRendering();
  // normalize
  let peak = 0;
  for (let c = 0; c < out.numberOfChannels; c++) { const d = out.getChannelData(c); for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i])); }
  if (peak > 0) { const k = 0.95 / peak; for (let c = 0; c < out.numberOfChannels; c++) { const d = out.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= k; } }
  return { buffer: out, timeline, takes };
}
