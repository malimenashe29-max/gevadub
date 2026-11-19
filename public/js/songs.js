// GevaDub's own songs. Every sound here is synthesized in the browser, so there's
// nothing to license: the birthday melody is public domain, "החבר'ה" is ours.

const SR = 44100;
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

// ---------- instruments ----------
const noiseCache = new WeakMap();
function noise(ctx) {
  if (!noiseCache.has(ctx)) {
    const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = b.getChannelData(0);
    let seed = 1234567;
    for (let i = 0; i < d.length; i++) { seed = (seed * 16807) % 2147483647; d[i] = (seed / 2147483647) * 2 - 1; }
    noiseCache.set(ctx, b);
  }
  return noiseCache.get(ctx);
}

function env(g, t, peak, attack, decay, floor = 0.0001) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(floor, t + attack + decay);
}

function noiseHit(ctx, out, t, { type = 'highpass', freq = 7000, q = 0.7, peak = 0.2, attack = 0.002, decay = 0.05, offset = 0 }) {
  const s = ctx.createBufferSource(); s.buffer = noise(ctx);
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); env(g, t, peak, attack, decay);
  s.connect(f).connect(g).connect(out);
  s.start(t, offset % 0.9, attack + decay + 0.02);
}

const I = {
  kick(ctx, out, t, v = 1) {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    const g = ctx.createGain(); env(g, t, 0.95 * v, 0.002, 0.42);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.5);
    noiseHit(ctx, out, t, { type: 'lowpass', freq: 1600, peak: 0.12 * v, decay: 0.012 });
  },
  snare(ctx, out, t, v = 1) {
    noiseHit(ctx, out, t, { type: 'bandpass', freq: 1900, q: 0.6, peak: 0.5 * v, decay: 0.17, offset: t * 7.3 });
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(205, t); o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    const g = ctx.createGain(); env(g, t, 0.28 * v, 0.002, 0.09);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.15);
  },
  clap(ctx, out, t, v = 1) {
    for (const d of [0, 0.011, 0.023]) noiseHit(ctx, out, t + d, { type: 'bandpass', freq: 1250, q: 1.1, peak: 0.32 * v, decay: 0.03, offset: d * 31 });
    noiseHit(ctx, out, t + 0.03, { type: 'bandpass', freq: 1150, q: 0.9, peak: 0.22 * v, decay: 0.16, offset: 0.4 });
  },
  hat(ctx, out, t, v = 1, open = false) {
    noiseHit(ctx, out, t, { freq: 7600, peak: 0.17 * v, decay: open ? 0.26 : 0.04, offset: t * 3.1 });
  },
  shaker(ctx, out, t, v = 1) {
    noiseHit(ctx, out, t, { type: 'bandpass', freq: 6200, q: 1.4, peak: 0.1 * v, attack: 0.012, decay: 0.06, offset: t * 5.7 });
  },
  bass(ctx, out, t, m, d, v = 1) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m);
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = mtof(m);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(240, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.32 * v, t + 0.008);
    g.gain.setTargetAtTime(0.18 * v, t + 0.05, 0.2); g.gain.setTargetAtTime(0.0001, t + d * 0.92, 0.04);
    const g2 = ctx.createGain(); g2.gain.value = 0.5;
    o.connect(f).connect(g).connect(out); o2.connect(g2).connect(g);
    o.start(t); o2.start(t); o.stop(t + d + 0.3); o2.stop(t + d + 0.3);
  },
  // Soft upright-ish piano: triangle body, a quiet octave, a filter that closes as it rings.
  piano(ctx, out, t, m, d, v = 1) {
    const f0 = mtof(m);
    const g = ctx.createGain(); env(g, t, 0.16 * v, 0.004, Math.min(2.6, d + 0.9));
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(9000, f0 * 9), t); lp.frequency.exponentialRampToValueAtTime(Math.max(500, f0 * 2), t + 1.2);
    const a = ctx.createOscillator(); a.type = 'triangle'; a.frequency.value = f0;
    const b = ctx.createOscillator(); b.type = 'sine'; b.frequency.value = f0 * 2.002;
    const bg = ctx.createGain(); bg.gain.value = 0.28;
    a.connect(lp); b.connect(bg).connect(lp); lp.connect(g).connect(out);
    const stop = t + Math.min(2.6, d + 0.9) + 0.1;
    a.start(t); b.start(t); a.stop(stop); b.stop(stop);
  },
  // Electric piano for the hip hop track: sine with a bell partial.
  keys(ctx, out, t, m, d, v = 1) {
    const f0 = mtof(m);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.11 * v, t + 0.01);
    g.gain.setTargetAtTime(0.05 * v, t + 0.05, 0.4); g.gain.setTargetAtTime(0.0001, t + d, 0.12);
    const a = ctx.createOscillator(); a.type = 'sine'; a.frequency.value = f0;
    const b = ctx.createOscillator(); b.type = 'sine'; b.frequency.value = f0 * 3.01;
    const bg = ctx.createGain(); env(bg, t, 0.35, 0.002, 0.3);
    a.connect(g); b.connect(bg).connect(g); g.connect(out);
    a.start(t); b.start(t); a.stop(t + d + 0.8); b.stop(t + d + 0.8);
  },
  pad(ctx, out, t, m, d, v = 1) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.045 * v, t + 0.35); g.gain.setTargetAtTime(0.0001, t + d, 0.3);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    for (const det of [-7, 7]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(t + d + 1.5);
    }
    lp.connect(g).connect(out);
  },
  // The guide melody you hear in your headphones while recording. Never part of the final mix.
  guide(ctx, out, t, m, d) {
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(m);
    const vib = ctx.createOscillator(); vib.frequency.value = 5.2;
    const vg = ctx.createGain(); vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(mtof(m) * 0.006, t + Math.min(0.4, d));
    vib.connect(vg).connect(o.frequency);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.2, t + 0.03);
    g.gain.setValueAtTime(0.2, t + Math.max(0.04, d - 0.06)); g.gain.linearRampToValueAtTime(0.0001, t + d);
    o.connect(lp).connect(g).connect(out);
    o.start(t); vib.start(t); o.stop(t + d + 0.05); vib.stop(t + d + 0.05);
  },
  tick(ctx, out, t, accent) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = accent ? 1760 : 1320;
    const g = ctx.createGain(); env(g, t, accent ? 0.16 : 0.09, 0.001, 0.04);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.06);
  },
};

function room(ctx, seconds = 1.9) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  let seed = 99;
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) {
      seed = (seed * 16807) % 2147483647;
      d[i] = ((seed / 2147483647) * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
  }
  const conv = ctx.createConvolver(); conv.buffer = ir;
  return conv;
}

function bus(ctx, { reverb = 0.2 } = {}) {
  const master = ctx.createDynamicsCompressor();
  master.threshold.value = -14; master.ratio.value = 3; master.attack.value = 0.01; master.release.value = 0.2;
  const out = ctx.createGain(); out.gain.value = 0.9;
  const rv = room(ctx); const rvg = ctx.createGain(); rvg.gain.value = reverb;
  out.connect(master); out.connect(rv).connect(rvg).connect(master);
  master.connect(ctx.destination);
  return out;
}

const chordNotes = (root, kind) => (kind === '7' ? [0, 4, 7, 10] : kind === 'm' ? [0, 3, 7] : [0, 4, 7]).map(i => root + i);

// ---------- song 1: יום הולדת שמח ----------
const BD = (() => {
  const bpm = 104, beat = 60 / bpm;
  const phrases = [
    [[62, .75], [62, .25], [64, 1], [62, 1], [67, 1], [66, 2]],
    [[62, .75], [62, .25], [64, 1], [62, 1], [69, 1], [67, 2]],
    [[62, .75], [62, .25], [74, 1], [71, 1], [67, 1], [66, 1], [64, 1]],
    [[72, .75], [72, .25], [71, 1], [67, 1], [69, 1], [67, 3]],
  ];
  const bars = [['G', 55, ''], ['D', 50, '7'], ['D', 50, '7'], ['G', 55, ''], ['C', 48, ''], ['G', 55, ''], ['D', 50, '7'], ['G', 55, '']];

  function lines(forName) {
    const who = forName ? `ל${forName}` : 'לך';
    const texts = ['יום הולדת שמח', 'יום הולדת שמח', `יום הולדת ${who}`, 'יום הולדת שמח'];
    const out = [];
    for (let r = 0; r < 2; r++) {
      phrases.forEach((ph, k) => {
        const startBeat = 5 + 27 * r + 6 * k;
        let b = startBeat;
        const notes = ph.map(([m, d]) => { const n = { m: m + r, t: b * beat, d: d * beat }; b += d; return n; });
        out.push({
          text: texts[k], t0: startBeat * beat, t1: b * beat, chorus: r === 1, spoken: false, notes,
          register: notes.reduce((a, n) => a + n.m, 0) / notes.length,
        });
      });
    }
    out.push({ text: forName ? `${forName}, זמן למשאלה` : 'זמן למשאלה', t0: 57 * beat, t1: 60 * beat, chorus: false, spoken: true, notes: [], register: null });
    out.push({ text: 'מזל טוב!', t0: 60 * beat, t1: 62.5 * beat, chorus: true, spoken: true, notes: [], register: null });
    return out;
  }

  const duration = 64 * beat + 1.6;

  async function render(forName) {
    const ctx = new OfflineAudioContext(2, Math.ceil(duration * SR), SR);
    const out = bus(ctx, { reverb: 0.28 });

    // two-bar intro: the last two bars of the tune, piano only
    for (const [i, root, kind] of [[0, 50, '7'], [3, 55, '']]) {
      I.bass(ctx, out, i * beat, root - 12, beat * 1.8, 0.8);
      for (const n of chordNotes(root + 12, kind)) I.piano(ctx, out, i * beat + beat, n, beat * 2, 0.7);
    }
    const bar = (start, [, root, kind], r) => {
      const R = root + r;
      I.bass(ctx, out, start, R - 12, beat * 0.95, 0.9);
      I.bass(ctx, out, start + 2 * beat, R - 5 - 12, beat * 0.9, 0.5);
      for (const off of [1, 2]) for (const n of chordNotes(R + 12, kind)) I.piano(ctx, out, start + off * beat, n, beat * 0.9, r ? 0.95 : 0.8);
      for (let k = 0; k < 3; k++) I.shaker(ctx, out, start + k * beat, k === 0 ? 1 : 0.7);
      if (r) { I.kick(ctx, out, start, 0.55); I.hat(ctx, out, start + 1.5 * beat, 0.5); }
    };
    bars.forEach((b, i) => bar((6 + i * 3) * beat, b, 0));
    // turnaround into the key change
    const ta = 30 * beat;
    I.bass(ctx, out, ta, 51 - 12, beat * 2.5, 1);
    for (const n of chordNotes(51 + 12, '7')) I.piano(ctx, out, ta + beat, n, beat * 1.8, 1);
    for (let k = 0; k < 6; k++) I.snare(ctx, out, ta + beat + k * beat / 3, 0.15 + k * 0.08);
    bars.forEach((b, i) => bar((33 + i * 3) * beat, b, 1));
    // wish: hold, then the hit
    const w = 57 * beat;
    for (const n of chordNotes(56, '')) I.pad(ctx, out, w, n + 12, beat * 3, 1.2);
    I.bass(ctx, out, w, 56 - 24, beat * 2.8, 0.6);
    for (let k = 0; k < 12; k++) I.snare(ctx, out, w + 1.5 * beat + k * beat / 8, 0.08 + k * 0.035);
    const hit = 60 * beat;
    I.kick(ctx, out, hit, 1); I.clap(ctx, out, hit, 1); I.hat(ctx, out, hit, 0.8, true);
    I.bass(ctx, out, hit, 56 - 24, beat * 3, 1);
    for (const n of [...chordNotes(56 + 12, ''), 56 + 24]) I.piano(ctx, out, hit, n, beat * 3, 1.1);

    const backing = await ctx.startRendering();

    // the guide: melody in headphones, plus a soft click for spoken lines
    const gctx = new OfflineAudioContext(1, Math.ceil(duration * SR), SR);
    const gout = gctx.createGain(); gout.connect(gctx.destination);
    for (const l of lines(forName)) for (const n of l.notes) I.guide(gctx, gout, n.t, n.m + 12 > 74 ? n.m : n.m + 12, n.d * 0.95);
    for (let b = 0; b < 6; b++) I.tick(gctx, gout, b * beat, b % 3 === 0);
    const guide = await gctx.startRendering();
    return { backing, guide };
  }

  return {
    id: 'birthday', title: 'יום הולדת שמח', needsName: true, bpm, duration,
    blurb: 'הסיבוב הראשון סולו, השני כולם ביחד, חצי טון למעלה. בסוף משאלה.',
    meta: `0:${Math.round(duration)} · ${bpm} BPM · 3/4`,
    root: 55, hasMelody: true, lines, render,
  };
})();

// ---------- song 2: החבר'ה (original) ----------
const CREW = (() => {
  const bpm = 92, beat = 60 / bpm, bar = 4 * beat;
  const texts = [
    ['קמתי בבוקר, אין טעינה בטלפון', false],
    ['אמא צועקת, ואני עוד בפיג׳מה בסלון', false],
    ['שלחתי הודעה לקבוצה, אף אחד לא עונה', false],
    ['ואז כולם עונים לי בשתיים בלילה', false],
    ['זה אנחנו, החבר׳ה, הכי רועשים בשכונה', true],
    ['אין לנו שום תוכנית, אבל יש לנו מנגינה', true],
    ['מבחן בהיסטוריה, למדתי רק כותרת', false],
    ['המורה שאלה, עניתי בביטחון. טעות.', false],
    ['אבל בהפסקה אני מלך המגרש', false],
    ['בעטתי לחלון של המנהל. מתנצל, מתבייש', false],
    ['זה אנחנו, החבר׳ה, הכי רועשים בשכונה', true],
    ['אין לנו שום תוכנית, אבל יש לנו מנגינה', true],
    ['וזהו. נגמר. מישהו מזמין פיצה?', false, true],
  ];
  const lines = () => texts.map(([text, chorus, spoken], i) => ({
    text, chorus, spoken: !!spoken || !chorus, notes: [], register: null,
    t0: (8 + 8 * i) * beat, t1: (8 + 8 * i + 7.6) * beat,
  }));
  const total = 8 + 8 * texts.length;
  const duration = (total + 2) * beat + 1.4;
  const loop = [[45, 'm'], [41, ''], [48, ''], [43, '']]; // Am F C G

  async function render() {
    const ctx = new OfflineAudioContext(2, Math.ceil(duration * SR), SR);
    const out = bus(ctx, { reverb: 0.14 });
    const nBars = total / 4;
    const swing = beat * 0.09;
    for (let b = 0; b < nBars; b++) {
      const t = b * bar;
      const [root, kind] = loop[b % 4];
      const lineIdx = Math.floor((b - 2) / 2);
      const isHook = lineIdx >= 0 && texts[lineIdx]?.[1];
      const intro = b < 2;
      const outro = lineIdx === texts.length - 1;

      for (const n of chordNotes(root + 12, kind === 'm' ? 'm' : '')) {
        I.keys(ctx, out, t, n + 12, beat * 1.6, 0.9);
        I.keys(ctx, out, t + 2.5 * beat, n + 12, beat * 1.2, 0.6);
      }
      if (isHook) for (const n of chordNotes(root + 12, kind === 'm' ? 'm' : '')) I.pad(ctx, out, t, n + 12, bar, 1);
      if (intro) { for (let s = 0; s < 8; s++) I.hat(ctx, out, t + s * beat / 2 + (s % 2 ? swing : 0), 0.35); continue; }

      const kicks = outro ? [0] : [0, 1.5, 2.5];
      for (const k of kicks) I.kick(ctx, out, t + k * beat, 1);
      if (!outro) {
        I.snare(ctx, out, t + beat, 0.9); I.snare(ctx, out, t + 3 * beat, 0.95);
        if (isHook) { I.clap(ctx, out, t + beat, 0.8); I.clap(ctx, out, t + 3 * beat, 0.8); }
        for (let s = 0; s < 8; s++) I.hat(ctx, out, t + s * beat / 2 + (s % 2 ? swing : 0), s % 2 ? 0.55 : 0.85, s === 7 && b % 2 === 1);
        if (isHook) for (let s = 0; s < 16; s++) I.shaker(ctx, out, t + s * beat / 4, s % 4 === 2 ? 1 : 0.5);
      }
      for (const k of kicks) I.bass(ctx, out, t + k * beat, root - 12, k === 0 ? beat * 1.3 : beat * 0.8, 1);
    }
    const end = total * beat;
    I.kick(ctx, out, end, 1); I.clap(ctx, out, end, 1); I.bass(ctx, out, end, 33, beat * 2, 1);
    for (const n of chordNotes(57, 'm')) I.keys(ctx, out, end, n + 12, beat * 2, 1);
    const backing = await ctx.startRendering();

    const gctx = new OfflineAudioContext(1, Math.ceil(duration * SR), SR);
    const gout = gctx.createGain(); gout.connect(gctx.destination);
    for (let b = 0; b < total; b++) I.tick(gctx, gout, b * beat, b % 4 === 0);
    const guide = await gctx.startRendering();
    return { backing, guide };
  }

  return {
    id: 'crew', title: 'החבר׳ה', needsName: false, bpm, duration,
    blurb: 'ביט היפ הופ מקורי של GevaDub. כל אחד מקבל שורה, בפזמון כולם צועקים.',
    meta: `1:${String(Math.round(duration - 60)).padStart(2, '0')} · ${bpm} BPM · ראפ`,
    root: 57, hasMelody: false, lines, render,
  };
})();

export const BUILTIN = [BD, CREW];
export const builtin = id => BUILTIN.find(s => s.id === id) || null;

function normalize(buf, target) {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; } }
  if (!peak) return buf;
  const k = target / peak;
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= k; }
  return buf;
}

const renderCache = new Map();
export function renderBuiltin(id, forName) {
  const key = `${id}|${forName || ''}`;
  if (!renderCache.has(key)) {
    renderCache.set(key, builtin(id).render(forName).then(({ backing, guide }) => ({ backing: normalize(backing, 0.89), guide: normalize(guide, 0.5) })));
  }
  return renderCache.get(key);
}
