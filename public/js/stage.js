// The video. 1080x1920, drawn frame by frame, so the premiere and the exported file are the same picture.

import { audioCtx } from './audio.js';
import { initial } from './util.js';

export const W = 1080, H = 1920;
export const PRE = 1.9;   // studio card
export const POST = 5.5;  // end card

const C = {
  bg: '#161718', bg2: '#1c1d1f', raised: '#232427', line: '#2b2c2f', lineStrong: '#3a3b3f',
  text: '#ecece9', text2: '#b0b2b6', muted: '#8b8d92', accent: '#ec4f86', accentText: '#f27aa3',
};
const DISPLAY = '"Suez One", Georgia, serif';
const BODY = '"Instrument Sans", "Noto Sans Hebrew", system-ui, sans-serif';
const MONO = '"IBM Plex Mono", "Noto Sans Hebrew", ui-monospace, monospace';

const easeOut = t => 1 - Math.pow(1 - t, 3);      // close to cubic-bezier(.2,.8,.2,1)
const easeDraw = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = t => Math.max(0, Math.min(1, t));

export async function loadFonts() {
  await Promise.all([
    document.fonts.load(`100px ${DISPLAY}`, 'GevaDub אבג'),
    document.fonts.load(`40px ${BODY}`, 'abc אבג'),
    document.fonts.load(`30px ${MONO}`, '0:12'),
  ]).catch(() => {});
}

function grainTile() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const img = g.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 10;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function rrect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

function wrap(g, text, maxW) {
  const words = text.split(' ');
  const rows = [];
  let row = '';
  for (const w of words) {
    const test = row ? `${row} ${w}` : w;
    if (g.measureText(test).width > maxW && row) { rows.push(row); row = w; } else row = test;
  }
  if (row) rows.push(row);
  return rows;
}

export class Stage {
  constructor(canvas, { info, timeline, members, videos, victimId, awards, title }) {
    this.canvas = canvas;
    canvas.width = W; canvas.height = H;
    this.g = canvas.getContext('2d');
    this.info = info; this.timeline = timeline; this.members = members;
    this.videos = videos || new Map(); // id -> {el, offset}
    this.victimId = victimId; this.awards = awards || [];
    this.title = title || info.title;
    this.grain = grainTile();
    this.total = PRE + info.duration + POST;
  }

  name(id) { return this.members.find(m => m.id === id)?.name || ''; }

  lineAt(t) {
    const tl = this.timeline;
    for (let i = 0; i < tl.length; i++) if (t >= tl[i].t0 - 0.25 && t <= tl[i].t1 + 0.25) return { cur: tl[i], next: tl[i + 1] || null };
    const next = tl.find(l => l.t0 > t) || null;
    return { cur: null, next };
  }

  // keep each visible person's video on the same moment as the song
  syncVideos(t, playing) {
    const { cur, next } = this.lineAt(t);
    const active = new Set(cur ? cur.singers : next && next.t0 - t < 1.2 ? next.singers : []);
    for (const [id, v] of this.videos) {
      const target = t - v.offset;
      if (active.has(id) && playing && target >= 0 && target < (v.el.duration || 1e9)) {
        if (Math.abs(v.el.currentTime - target) > 0.25) v.el.currentTime = target;
        if (v.el.paused) v.el.play().catch(() => {});
      } else {
        if (!v.el.paused) v.el.pause();
        if (!playing && target >= 0 && Math.abs(v.el.currentTime - target) > 0.08) v.el.currentTime = target;
      }
    }
  }

  draw(tv) {
    const g = this.g;
    g.save();
    g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
    if (tv < PRE) this.drawCard(tv);
    else if (tv < PRE + this.info.duration) this.drawSong(tv - PRE);
    else this.drawEnd(tv - PRE - this.info.duration);
    g.globalAlpha = 1;
    g.fillStyle = g.createPattern(this.grain, 'repeat'); g.fillRect(0, 0, W, H);
    g.restore();
  }

  // Same card as every GevaStudio app: letters rise, then the line draws underneath.
  drawCard(t) {
    const g = this.g;
    const letters = [...'Geva'].map(ch => [ch, false]).concat([...'Dub'].map(ch => [ch, true]));
    g.font = `150px ${DISPLAY}`;
    g.textBaseline = 'alphabetic';
    g.direction = 'ltr';
    const widths = letters.map(([ch]) => g.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0);
    let x = (W - total) / 2;
    const base = H / 2 + 40;
    const fadeOut = clamp01((t - (PRE - 0.42)) / 0.42);
    g.save();
    g.globalAlpha = 1 - fadeOut;
    g.translate(W / 2, H / 2); g.scale(1 + fadeOut * 0.04, 1 + fadeOut * 0.04); g.translate(-W / 2, -H / 2);
    g.save();
    g.beginPath(); g.rect(0, base - 170, W, 210); g.clip();
    letters.forEach(([ch, soft], i) => {
      const p = easeOut(clamp01((t - 0.12 - i * 0.042) / 0.52));
      g.globalAlpha = (1 - fadeOut) * p;
      g.fillStyle = soft ? C.text2 : C.text;
      g.fillText(ch, x, base + (1 - p) * 180);
      x += widths[i];
    });
    g.restore();
    const rp = easeDraw(clamp01((t - 0.6) / 0.56));
    const rw = total * 0.72;
    g.globalAlpha = 1 - fadeOut;
    g.fillStyle = C.accent;
    g.fillRect((W - rw) / 2, base + 46, rw * rp, 5);
    g.restore();
  }

  drawFace(id, x, y, w, h, r, { dim = false, glitch = false } = {}) {
    const g = this.g;
    g.save();
    rrect(g, x, y, w, h, r); g.clip();
    g.fillStyle = C.bg2; g.fillRect(x, y, w, h);
    const v = this.videos.get(id);
    if (v && v.el.readyState >= 2 && v.el.videoWidth) {
      const vw = v.el.videoWidth, vh = v.el.videoHeight;
      const s = Math.max(w / vw, h / vh);
      const dw = vw * s, dh = vh * s;
      g.translate(x + w, y); g.scale(-1, 1); // mirror, the way people saw themselves while recording
      g.drawImage(v.el, (w - dw) / 2, (h - dh) / 2, dw, dh);
      g.setTransform(1, 0, 0, 1, 0, 0);
      if (glitch) {
        for (let k = 0; k < 5; k++) {
          const sy = y + Math.random() * h, sh = 8 + Math.random() * 46, dx = (Math.random() - 0.5) * 70;
          g.drawImage(this.canvas, x, sy, w, sh, x + dx, sy, w, sh);
        }
        g.globalCompositeOperation = 'screen';
        g.fillStyle = '#ec4f8622'; g.fillRect(x, y, w, h);
        g.globalCompositeOperation = 'source-over';
      }
    } else {
      g.fillStyle = C.raised; g.fillRect(x, y, w, h);
      g.fillStyle = glitch ? C.accentText : C.text2;
      g.font = `${Math.round(Math.min(w, h) * 0.42)}px ${DISPLAY}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const jx = glitch ? (Math.random() - 0.5) * 24 : 0;
      g.fillText(initial(this.name(id)), x + w / 2 + jx, y + h / 2 + 8);
    }
    if (dim) { g.fillStyle = '#161718b0'; g.fillRect(x, y, w, h); }
    g.restore();
    g.save();
    rrect(g, x + 0.5, y + 0.5, w - 1, h - 1, r);
    g.strokeStyle = C.lineStrong; g.lineWidth = 2; g.stroke();
    g.restore();
  }

  drawSong(t) {
    const g = this.g;
    const { cur, next } = this.lineAt(t);
    g.textAlign = 'right'; g.direction = 'rtl';

    // header
    g.fillStyle = C.muted; g.font = `500 28px ${MONO}`; g.textBaseline = 'alphabetic';
    g.direction = 'ltr'; g.textAlign = 'right';
    g.fillText('GEVADUB', W - 90, 130);
    g.textAlign = 'left';
    const tc = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    g.fillText(tc, 90, 130);
    g.direction = 'rtl'; g.textAlign = 'right';
    g.fillStyle = C.text2; g.font = `40px ${DISPLAY}`;
    g.fillText(this.title, W - 90, 185);

    // faces
    const px = 90, py = 240, pw = 900, ph = 900;
    const showing = cur ? cur.singers : next ? next.singers : [];
    const upcoming = !cur;
    const glitch = !!cur && cur.victim && Math.random() < 0.35;
    if (showing.length <= 1) {
      if (showing[0]) this.drawFace(showing[0], px, py, pw, ph, 40, { dim: upcoming, glitch });
      else { g.fillStyle = C.bg2; rrect(g, px, py, pw, ph, 40); g.fill(); }
    } else {
      const n = showing.length;
      const cols = n <= 4 ? 2 : n <= 6 ? 3 : 4;
      const rows = Math.ceil(n / cols);
      const gap = 16;
      const cw = (pw - gap * (cols - 1)) / cols, ch = (ph - gap * (rows - 1)) / rows;
      showing.forEach((id, k) => {
        const col = k % cols, row = Math.floor(k / cols);
        const inRow = Math.min(cols, n - row * cols);
        const offset = ((cols - inRow) * (cw + gap)) / 2;
        const x = px + pw - (col + 1) * cw - col * gap - offset; // fill right to left
        this.drawFace(id, x, py + row * (ch + gap), cw, ch, 24, { dim: upcoming, glitch: glitch && id === this.victimId });
      });
    }

    if (cur?.victim && !this.noTag) {
      g.save();
      g.direction = 'ltr'; g.textAlign = 'left'; g.font = `500 26px ${MONO}`;
      const label = 'AUTO-TUNE';
      const lw = g.measureText(label).width + 36;
      g.fillStyle = C.accent; rrect(g, px + 24, py + 24, lw, 50, 8); g.fill();
      g.fillStyle = '#1c0710'; g.fillText(label, px + 42, py + 58);
      g.restore();
    }

    // who
    g.direction = 'rtl'; g.textAlign = 'right';
    const who = !showing.length ? '' : showing.length > 1 ? 'כולם' : this.name(showing[0]);
    if (upcoming && next) {
      g.fillStyle = C.muted; g.font = `500 34px ${BODY}`;
      g.fillText('עוד רגע', W - 90, 1230);
      g.fillStyle = C.text2; g.font = `64px ${DISPLAY}`;
      g.fillText(who, W - 90, 1310);
    } else if (cur) {
      g.fillStyle = C.text; g.font = `72px ${DISPLAY}`;
      g.fillText(who, W - 90, 1250);
    }

    // lyrics, wiped right-to-left like the studio line
    if (cur) {
      g.font = `82px ${DISPLAY}`;
      const rows = wrap(g, cur.text, 900);
      const lh = 104;
      const top = 1400;
      const p = clamp01((t - cur.t0) / Math.max(0.3, cur.t1 - cur.t0));
      const widths = rows.map(r => g.measureText(r).width);
      const totalW = widths.reduce((a, b) => a + b, 0);
      let filled = p * totalW;
      rows.forEach((r, i) => {
        const y = top + i * lh;
        g.fillStyle = '#ecece945';
        g.fillText(r, W - 90, y);
        const fw = Math.max(0, Math.min(widths[i], filled));
        filled -= widths[i];
        if (fw > 0) {
          g.save();
          g.beginPath(); g.rect(W - 90 - fw, y - 90, fw, 120); g.clip();
          g.fillStyle = C.text; g.fillText(r, W - 90, y);
          g.restore();
        }
      });
      const ry = top + (rows.length - 1) * lh + 34;
      g.fillStyle = C.accent;
      const lineW = Math.max(...widths);
      g.fillRect(W - 90 - lineW * easeDraw(p), ry, lineW * easeDraw(p), 6);
      if (next) {
        g.fillStyle = C.muted; g.font = `42px ${DISPLAY}`;
        const nr = wrap(g, next.text, 900)[0];
        g.fillText(nr, W - 90, ry + 120);
      }
    } else if (next) {
      g.fillStyle = '#ecece930'; g.font = `82px ${DISPLAY}`;
      wrap(g, next.text, 900).slice(0, 2).forEach((r, i) => g.fillText(r, W - 90, 1460 + i * 104));
    }

    // progress hairline + footer
    g.fillStyle = C.line; g.fillRect(90, 1800, 900, 3);
    g.fillStyle = C.text2; g.fillRect(90 + 900 * (1 - t / this.info.duration), 1800, 900 * (t / this.info.duration), 3);
    g.fillStyle = C.muted; g.font = `500 26px ${MONO}`; g.direction = 'ltr'; g.textAlign = 'center';
    g.fillText('gevastudio.com', W / 2, 1866);
  }

  drawEnd(t) {
    const g = this.g;
    const fade = clamp01(t / 0.4);
    g.globalAlpha = fade;
    g.direction = 'ltr'; g.textAlign = 'right';
    g.fillStyle = C.muted; g.font = `500 28px ${MONO}`;
    g.fillText('GEVADUB · PREMIERE', W - 90, 200);
    g.direction = 'rtl';
    g.fillStyle = C.text; g.font = `96px ${DISPLAY}`;
    g.fillText(this.title, W - 90, 330);
    g.fillStyle = C.accent; g.fillRect(W - 90 - 420 * easeDraw(clamp01((t - 0.2) / 0.6)), 368, 420 * easeDraw(clamp01((t - 0.2) / 0.6)), 6);

    g.font = `500 38px ${BODY}`; g.fillStyle = C.text2;
    g.fillText(this.members.map(m => m.name).join(' · '), W - 90, 460);

    let y = 620;
    this.awards.forEach((a, i) => {
      const p = easeOut(clamp01((t - 0.5 - i * 0.25) / 0.5));
      g.globalAlpha = fade * p;
      g.fillStyle = C.line; g.fillRect(90, y - 70, 900, 2);
      g.fillStyle = C.muted; g.font = `500 36px ${BODY}`; g.textAlign = 'right';
      g.fillText(a.what, W - 90, y);
      g.fillStyle = a.victim ? C.accentText : C.text; g.font = `76px ${DISPLAY}`;
      g.fillText(a.who, W - 90, y + 92);
      if (a.num) { g.fillStyle = C.muted; g.font = `500 30px ${MONO}`; g.textAlign = 'left'; g.direction = 'ltr'; g.fillText(a.num, 90, y + 80); g.direction = 'rtl'; }
      y += 230;
    });
    g.globalAlpha = fade;
    g.textAlign = 'center'; g.direction = 'ltr';
    g.fillStyle = C.text2; g.font = `56px ${DISPLAY}`;
    g.fillText('Geva', W / 2 - g.measureText('Dub').width / 2, 1760);
    g.fillStyle = C.muted;
    g.fillText('Dub', W / 2 + g.measureText('Geva').width / 2, 1760);
    g.fillStyle = C.muted; g.font = `500 26px ${MONO}`;
    g.fillText('gevastudio.com', W / 2, 1830);
  }
}

// Plays the mix and draws the stage against the audio clock, so picture and sound can't drift.
export class Player {
  constructor(stage, buffer) {
    this.stage = stage; this.buffer = buffer;
    this.src = null; this.raf = 0; this.startCtx = 0; this.playing = false; this.onEnd = null; this.onFrame = null;
  }

  // `at` is an AudioContext time; `from` is how far into the video to begin (for late joiners).
  play({ at, from = 0, dest } = {}) {
    const ctx = audioCtx();
    this.stop();
    at = at ?? ctx.currentTime + 0.1;
    this.startCtx = at - from;
    const audioAt = this.startCtx + PRE;
    const src = ctx.createBufferSource(); src.buffer = this.buffer;
    src.connect(dest || ctx.destination);
    if (dest) src.connect(ctx.destination);
    const offset = Math.max(0, from - PRE);
    src.start(Math.max(ctx.currentTime, audioAt + offset), offset);
    this.src = src; this.playing = true;
    const loop = () => {
      const tv = ctx.currentTime - this.startCtx;
      if (tv >= 0) {
        this.stage.syncVideos(tv - PRE, true);
        this.stage.draw(tv);
        this.onFrame?.(tv);
      }
      if (tv >= this.stage.total) { this.playing = false; this.stage.syncVideos(-10, false); this.onEnd?.(); return; }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    try { this.src?.stop(); } catch {}
    this.src = null; this.playing = false;
    this.stage.syncVideos(-10, false);
  }

  // Real-time recording of the same picture and sound into a file.
  async record(onProgress) {
    const ctx = audioCtx();
    const dest = ctx.createMediaStreamDestination();
    const vs = this.stage.canvas.captureStream(30);
    const stream = new MediaStream([...vs.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const types = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const mimeType = types.find(t => MediaRecorder.isTypeSupported(t)) || '';
    const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 192_000 });
    const chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    const done = new Promise(r => { rec.onstop = r; });
    return new Promise((resolve, reject) => {
      this.onFrame = tv => onProgress?.(tv / this.stage.total);
      this.onEnd = async () => {
        setTimeout(() => rec.state !== 'inactive' && rec.stop(), 250);
        await done;
        this.onFrame = null;
        const type = (mimeType || 'video/webm').split(';')[0];
        resolve(new Blob(chunks, { type }));
      };
      try {
        rec.start(500);
        this.play({ at: ctx.currentTime + 0.15, dest });
      } catch (e) { reject(e); }
    });
  }
}

// A still from the funniest moment, with a caption, as a PNG.
export async function memeFrame(stage, t, caption) {
  stage.syncVideos(t, false);
  await new Promise(r => setTimeout(r, 350)); // let the seeked video frames land
  stage.noTag = true;
  stage.draw(PRE + t);
  stage.noTag = false;
  const c = document.createElement('canvas'); c.width = W; c.height = W;
  const g = c.getContext('2d');
  g.drawImage(stage.canvas, 90, 240, 900, 900, 0, 0, W, W);
  g.font = `110px ${DISPLAY}`; g.textAlign = 'center'; g.direction = 'rtl'; g.lineJoin = 'round';
  const rows = wrap(g, caption, W - 120);
  rows.forEach((r, i) => {
    const y = 150 + i * 120;
    g.lineWidth = 16; g.strokeStyle = '#000'; g.strokeText(r, W / 2, y);
    g.fillStyle = '#fff'; g.fillText(r, W / 2, y);
  });
  g.font = `500 26px ${MONO}`; g.direction = 'ltr'; g.fillStyle = '#ffffffb0';
  g.fillText('GevaDub', W / 2, W - 40);
  return new Promise(r => c.toBlob(r, 'image/png'));
}
