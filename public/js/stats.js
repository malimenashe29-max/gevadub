// After the song: who did what. Measured from the takes, not made up.

import { track, hzToMidi } from './pitch.js';

export function analyze({ info, timeline, takes, members, victimId }) {
  const name = id => members.find(m => m.id === id)?.name || '?';
  const per = new Map();

  for (const m of members) {
    const t = takes.get(m.id);
    if (!t) continue;
    const frames = track(t.samples, t.sampleRate, { minHz: 75, maxHz: 900 });
    const mine = timeline.filter(l => l.singers.includes(m.id));
    let voiced = 0, total = 0, levelSum = 0, levelN = 0, hit = 0, judged = 0;
    const levels = [];
    let loudest = { level: 0, t: 0 };
    for (const f of frames) {
      const line = mine.find(l => f.t >= l.t0 && f.t <= l.t1);
      if (!line) continue;
      total++;
      if (f.level > 0.015) { levelSum += f.level; levelN++; levels.push(f.level); }
      if (f.level > loudest.level && !line.chorus) loudest = { level: f.level, t: f.t };
      if (f.f0s > 0) {
        voiced++;
        if (info.hasMelody && line.notes?.length && !line.chorus) {
          const note = line.notes.find(n => f.t >= n.t && f.t <= n.t + n.d);
          if (note) {
            judged++;
            // octave doesn't matter: a deep voice singing the tune an octave down is still in tune
            let cents = ((hzToMidi(f.f0s) - note.m) * 100) % 1200;
            if (cents < 0) cents += 1200;
            const off = Math.min(cents, 1200 - cents);
            if (off <= 60) hit++;
          }
        }
      }
    }
    const mean = levelN ? levelSum / levelN : 0;
    const spread = levels.length ? Math.sqrt(levels.reduce((a, v) => a + (v - mean) ** 2, 0) / levels.length) / (mean || 1) : 0;
    per.set(m.id, {
      loud: mean,
      presence: total ? voiced / total : 0,
      accuracy: judged >= 15 ? hit / judged : null,
      drama: spread,
      loudest,
    });
  }

  const best = (key, min = -Infinity) => {
    let id = null, v = min;
    for (const [k, s] of per) if (s[key] !== null && s[key] > v) { v = s[key]; id = k; }
    return id ? { id, v } : null;
  };

  const awards = [];
  const acc = best('accuracy', 0);
  if (acc) awards.push({ what: 'פרס הדיוק', who: name(acc.id), num: `${Math.round(acc.v * 100)}% בתווים` });
  const loud = best('loud', 0);
  if (loud) awards.push({ what: 'פרס העוצמה', who: name(loud.id), num: `${Math.round(20 * Math.log10(loud.v))} dB` });
  const pres = best('presence', 0);
  if (pres && pres.id !== loud?.id) awards.push({ what: 'פרס הנוכחות', who: name(pres.id), num: `${Math.round(pres.v * 100)}% מהזמן` });
  const drama = best('drama', 0);
  if (drama && awards.length < 3) awards.push({ what: 'פרס הדרמה', who: name(drama.id), num: '' });
  if (victimId) awards.push({ what: 'הקובייה נפלה על', who: name(victimId), num: 'אוטו-טיון', victim: true });

  // The meme frame: the dice victim at their loudest, or whoever peaked hardest.
  let moment = null;
  if (victimId && per.get(victimId)?.loudest.level) moment = { id: victimId, t: per.get(victimId).loudest.t };
  else {
    for (const [id, s] of per) if (!moment || s.loudest.level > moment.level) moment = { id, t: s.loudest.t, level: s.loudest.level };
  }
  return { awards, moment };
}
