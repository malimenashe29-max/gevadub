// Builds the final track: the bed, plus each person's take cut to their lines.

import { chaosTune } from './autotune.js';
import { singersFor } from './split.js';

const OUT_SR = 44100;

function bufferFrom(samples, sr) {
  const b = new AudioBuffer({ length: Math.max(1, samples.length), numberOfChannels: 1, sampleRate: sr });
  b.copyToChannel(samples, 0);
  return b;
}

/**
 * @param info    songInfo()
 * @param bed     AudioBuffer under the voices
 * @param members [{id, samples: Float32Array, sampleRate}]
 * @param parts   room.parts
 * @param victimId member whose voice goes through the dice
 */
export async function buildMix({ info, bed, members, parts, victimId, onStep }) {
  const takes = new Map();
  for (const m of members) {
    let s = m.samples;
    if (m.id === victimId) { onStep?.('הקובייה עובדת'); await new Promise(r => setTimeout(r, 20)); s = chaosTune(s, m.sampleRate, { root: info.root }); }
    takes.set(m.id, { buf: bufferFrom(s, m.sampleRate), samples: s, sampleRate: m.sampleRate });
  }
  onStep?.('מערבב');

  const duration = Math.max(info.duration, bed.duration);
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * OUT_SR), OUT_SR);

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.12;
  limiter.connect(ctx.destination);

  const bedGain = ctx.createGain(); bedGain.gain.value = 0.6;
  const bedSrc = ctx.createBufferSource(); bedSrc.buffer = bed;
  bedSrc.connect(bedGain).connect(limiter); bedSrc.start(0);

  const vox = ctx.createDynamicsCompressor();
  vox.threshold.value = -22; vox.ratio.value = 3.5; vox.attack.value = 0.005; vox.release.value = 0.15;
  const voxOut = ctx.createGain(); voxOut.gain.value = 1.7;
  vox.connect(voxOut).connect(limiter);
  // small room on the voices so they sit in the same space
  const ir = ctx.createBuffer(2, Math.floor(OUT_SR * 1.2), OUT_SR);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3); }
  const conv = ctx.createConvolver(); conv.buffer = ir;
  const wet = ctx.createGain(); wet.gain.value = 0.16;
  voxOut.connect(conv).connect(wet).connect(limiter);

  const lines = info.lines;
  const ids = members.map(m => m.id);
  const timeline = [];
  lines.forEach((l, i) => {
    const singers = singersFor(i, parts, members).filter(id => takes.has(id));
    timeline.push({ ...l, index: i, singers, victim: singers.includes(victimId) && !!victimId });
    const next = lines[i + 1];
    const a = Math.max(0, l.t0 - 0.25);
    let b = l.t1 + 0.45;
    if (next) b = Math.min(b, next.t0 + 0.05);
    const n = singers.length;
    singers.forEach(id => {
      const t = takes.get(id);
      const src = ctx.createBufferSource(); src.buffer = t.buf;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90;
      const g = ctx.createGain();
      const level = n > 1 ? 0.95 / Math.sqrt(n) : 1;
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
