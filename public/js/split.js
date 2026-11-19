// Who sings what. Chorus lines belong to everyone; the rest get dealt out.

function shuffle(a) {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; }
  return x;
}

export function splitParts(lines, members, mode) {
  const parts = {};
  const solo = [];
  lines.forEach((l, i) => { if (l.chorus) parts[i] = 'all'; else solo.push(i); });
  if (!members.length || !solo.length) return parts;

  if (mode === 'random') {
    const order = shuffle(members.map(m => m.id));
    shuffle(solo).forEach((li, k) => { parts[li] = order[k % order.length]; });
    return parts;
  }

  // Smart: lowest voice first. Unchecked voices go in the middle.
  const known = members.filter(m => m.range).sort((a, b) => a.range.median - b.range.median);
  const unknown = members.filter(m => !m.range);
  const mid = Math.floor(known.length / 2);
  const byVoice = [...known.slice(0, mid), ...unknown, ...known.slice(mid)].map(m => m.id);

  const withRegister = solo.filter(i => Number.isFinite(lines[i].register));
  const rest = solo.filter(i => !Number.isFinite(lines[i].register));
  if (withRegister.length >= 2 && known.length >= 2) {
    // Sung lines: rank low to high and hand them out in matching bands, low voices get low lines.
    const ranked = [...withRegister].sort((a, b) => lines[a].register - lines[b].register);
    const per = ranked.length / byVoice.length;
    const count = new Map(byVoice.map(id => [id, 0]));
    ranked.forEach((li, k) => {
      const id = byVoice[Math.min(byVoice.length - 1, Math.floor(k / per))];
      parts[li] = id; count.set(id, count.get(id) + 1);
    });
    // Spoken lines go to whoever has the least so far, so nobody sits out.
    rest.forEach(li => {
      const id = [...count.entries()].sort((a, b) => a[1] - b[1])[0][0];
      parts[li] = id; count.set(id, count.get(id) + 1);
    });
    // More singers than lines? The extra ones still have every chorus.
    return parts;
  }

  // No pitch info (rap, or a gallery song we couldn't read): alternate voices so
  // low and high take turns, which sounds better than two of the same in a row.
  const order = [];
  for (let i = 0, j = byVoice.length - 1; i <= j; i++, j--) { order.push(byVoice[i]); if (i !== j) order.push(byVoice[j]); }
  solo.forEach((li, k) => { parts[li] = order[k % order.length]; });
  return parts;
}

export function singersFor(lineIdx, parts, members) {
  const p = parts?.[lineIdx];
  if (p === 'all') return members.map(m => m.id);
  return p ? [p] : [];
}
