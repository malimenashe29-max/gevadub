// One shape for every song, whether it's ours or came from someone's gallery.

import { builtin, renderBuiltin } from './songs.js';
import { loadImported } from './gallery.js';

export function songInfo(roomSong) {
  if (roomSong.kind === 'builtin') {
    const s = builtin(roomSong.id);
    if (!s) return null;
    return {
      kind: 'builtin', title: s.title, duration: s.duration, root: s.root, hasMelody: s.hasMelody,
      lines: s.lines(roomSong.forName), forName: roomSong.forName,
    };
  }
  return {
    kind: 'upload', title: roomSong.title || 'שיר מהגלריה', duration: roomSong.duration, root: 57, hasMelody: false,
    lines: roomSong.lines, fingerprint: roomSong.fingerprint,
  };
}

// Audio for recording (what you hear) and for the mix (what's under everyone).
export async function songAudio(roomSong, code) {
  if (roomSong.kind === 'builtin') {
    const { backing, guide } = await renderBuiltin(roomSong.id, roomSong.forName);
    return { listen: backing, guide, bed: backing };
  }
  const imp = await loadImported(code, roomSong.keepSinger);
  if (!imp) return null;
  // While recording you hear the original singer so you can follow; the final video uses the instrumental.
  return { listen: imp.full, guide: null, bed: imp.instrumental };
}
