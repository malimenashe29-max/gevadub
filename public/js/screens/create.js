import { $, $$, html, mount, toast, api, saveRoom, lastName, setLastName, putSong, fmtTime } from '../util.js';
import { BUILTIN, builtin } from '../songs.js';
import { audioCtx, mono, downsample, encodeWav } from '../audio.js';
import { decodeFile, sideRatio, removeVocals, trimmed, fingerprint, lineRegisters, MAX_SECONDS } from '../gallery.js';
import { go } from '../app.js';

export function createScreen(app) {
  const q = new URLSearchParams(location.search);
  const state = {
    song: q.get('song') || null,  // builtin id | 'gallery'
    forName: '',
    split: 'smart',
    gallery: null,                 // { meta, bytes, keepSinger }
    stop: null,
  };

  function render() {
    state.stop?.(); state.stop = null;
    const s = state.song && state.song !== 'gallery' ? builtin(state.song) : null;
    mount(app, html`
      <div class="steps">
        <span class="${!state.song ? 'on' : ''}">01 שיר</span>
        <span class="${state.song && !(state.song === 'gallery' && !state.gallery) ? 'on' : ''}">02 פרטים</span>
        <span>03 חדר</span>
      </div>
      <h1 class="display" style="font-size:clamp(34px,5.5vw,56px)">איזה שיר הערב?</h1>

      <div class="songs" style="margin-top:26px">
        ${BUILTIN.map(b => html`
          <button class="song" data-song="${b.id}" aria-pressed="${state.song === b.id}">
            <span class="t">${b.title}</span><span class="d">${b.blurb}</span><span class="meta mono">${b.meta}</span>
          </button>`)}
        <button class="song dashed" data-song="gallery" aria-pressed="${state.song === 'gallery'}">
          <span class="t">מהגלריה</span>
          <span class="d">סרטון או שיר מהטלפון. את המילים אנחנו מזהים לבד.</span>
          <span class="meta mono">MP4 · MP3 · M4A</span>
        </button>
      </div>

      <div id="detail" style="margin-top:22px"></div>
    `);

    $$('[data-song]', app).forEach(b => b.addEventListener('click', () => {
      if (state.song === b.dataset.song) return;
      state.song = b.dataset.song;
      if (state.song !== 'gallery') state.gallery = null;
      history.replaceState(null, '', `/new?song=${state.song}`);
      render();
      $('#detail', app).scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));

    const detail = $('#detail', app);
    if (!state.song) return;
    if (state.song === 'gallery' && !state.gallery) { state.stop = importer(detail, g => { state.gallery = g; render(); }); return; }
    details(detail, s);
  }

  function details(el, s) {
    mount(el, html`
      <form class="panel stack" id="f" autocomplete="off">
        ${state.gallery ? html`
          <div class="row" style="justify-content:space-between">
            <div><span class="label">השיר</span><div style="font-family:var(--font-display);font-size:22px">${state.gallery.meta.title}</div>
            <span class="muted small">${state.gallery.meta.lines.length} שורות · ${fmtTime(state.gallery.meta.duration)}</span></div>
            <button type="button" class="link-btn" id="redo">לבחור קובץ אחר</button>
          </div>` : ''}
        ${s?.needsName ? html`
          <div class="field">
            <label for="forName">למי שרים?</label>
            <input type="text" id="forName" maxlength="24" placeholder="השם של מי שיש לו יום הולדת" value="${state.forName}">
            <span class="hint">נכנס לשיר: "יום הולדת ל…". אפשר להשאיר ריק.</span>
          </div>` : ''}
        <div class="field">
          <label for="name">ואיך קוראים לך?</label>
          <input type="text" id="name" maxlength="24" required value="${lastName()}" placeholder="השם שיופיע בסרטון">
        </div>
        <div class="field">
          <span class="label">איך לחלק את השורות</span>
          <div class="seg" role="group">
            <button type="button" data-split="smart" aria-pressed="${state.split === 'smart'}">חכם, לפי הקול</button>
            <button type="button" data-split="random" aria-pressed="${state.split === 'random'}">אקראי</button>
          </div>
          <span class="hint">${state.split === 'smart'
            ? 'כל אחד עושה בדיקת קול קצרה, והשורות הגבוהות הולכות לקולות הגבוהים.'
            : 'מגרילים. כל אחד מקבל בערך אותה כמות שורות.'}</span>
        </div>
        <div class="row end"><button class="btn primary big" type="submit" id="go">לפתוח חדר</button></div>
      </form>
    `);
    $('#redo', el)?.addEventListener('click', () => { state.gallery = null; render(); });
    $$('[data-split]', el).forEach(b => b.addEventListener('click', () => {
      state.split = b.dataset.split;
      state.forName = $('#forName', el)?.value || state.forName;
      details(el, s);
    }));
    $('#f', el).addEventListener('submit', async e => {
      e.preventDefault();
      const name = $('#name', el).value.trim();
      if (!name) return toast('צריך שם');
      setLastName(name);
      const btn = $('#go', el); btn.disabled = true; btn.textContent = 'פותח…';
      try {
        const song = state.gallery
          ? { kind: 'upload', ...state.gallery.meta, keepSinger: state.gallery.keepSinger }
          : { kind: 'builtin', id: s.id, forName: ($('#forName', el)?.value || '').trim() };
        const r = await api('/rooms', { method: 'POST', body: { name, song, split: state.split } });
        saveRoom(r.code, { token: r.token, memberId: r.memberId, name, title: state.gallery ? state.gallery.meta.title : s.title });
        if (state.gallery) await putSong(`room:${r.code}`, { bytes: state.gallery.bytes });
        go(`/r/${r.code}`, { replace: true });
      } catch (err) {
        toast(err.message); btn.disabled = false; btn.textContent = 'לפתוח חדר';
      }
    });
  }

  render();
  return () => state.stop?.();
}

// ---------- gallery import: file -> preview -> lyrics -> tap to sync -> review ----------
function importer(el, onDone) {
  const st = { audio: null, inst: null, bytes: null, title: '', keepSinger: false, canRemove: true, lyrics: '', lines: [], src: null, stt: { state: 'idle', lang: 'he', error: '' } };
  const ctx = audioCtx();
  const stopAudio = () => { try { st.src?.stop(); } catch {} st.src = null; };
  const playBuf = (buf, from = 0) => {
    stopAudio();
    const s = ctx.createBufferSource(); s.buffer = buf; s.connect(ctx.destination);
    const at = ctx.currentTime + 0.05;
    s.start(at, from);
    st.src = s;
    return at - from;
  };

  function pick() {
    mount(el, html`
      <label class="drop panel">
        <input type="file" accept="video/*,audio/*" id="file">
        <span style="font-family:var(--font-display);font-size:24px;color:var(--text)">לבחור סרטון או שיר</span>
        <span class="small">שמרת סרטון מטיקטוק? הוא בגלריה. אנחנו מוציאים ממנו את השיר, ממש כאן במכשיר.</span>
      </label>
      <p class="notice" style="margin-top:14px">את המילים מזהים לבד. בשביל זה השמע נשלח פעם אחת לזיהוי, ולא נשמר אצלנו. כל מי שבחדר יבחר את אותו קובץ אצלו, ואנחנו נבדוק שזה אותו שיר.</p>
    `);
    $('#file', el).addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      mount(el, html`<div class="panel"><span class="spin"></span> <span class="muted">קורא את הקובץ…</span></div>`);
      try {
        const { audio, bytes } = await decodeFile(file);
        st.audio = trimmed(audio); st.bytes = bytes;
        st.title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 60);
        st.stt = { state: 'idle', lang: st.stt.lang, error: '' };
        st.lines = []; st.lyrics = '';
        st.canRemove = sideRatio(audio) > 0.08;
        st.keepSinger = !st.canRemove;
        if (st.canRemove) st.inst = await removeVocals(audio);
        preview();
      } catch (err) { toast(err.message, 4000); pick(); }
    });
  }

  function preview() {
    mount(el, html`
      <div class="panel stack">
        <div class="field">
          <label for="title">שם השיר</label>
          <input type="text" id="title" maxlength="60" value="${st.title}">
        </div>
        <canvas class="wave" id="wave" width="1200" height="168"></canvas>
        <div class="row" style="justify-content:space-between">
          <span class="muted small">${fmtTime(st.audio.duration)}${st.audio.duration >= MAX_SECONDS - 0.5 ? ' (חתכנו ל-3 דקות)' : ''}</span>
          <div class="row">
            <button class="btn ghost" id="p-orig" type="button">להשמיע מקור</button>
            ${st.canRemove ? html`<button class="btn ghost" id="p-inst" type="button">להשמיע בלי הזמר</button>` : ''}
            <button class="btn ghost" id="p-stop" type="button">עצור</button>
          </div>
        </div>
        ${st.canRemove ? html`
          <div class="field">
            <span class="label">בסרטון הסופי</span>
            <div class="seg">
              <button type="button" data-keep="0" aria-pressed="${!st.keepSinger}">בלי הזמר המקורי</button>
              <button type="button" data-keep="1" aria-pressed="${st.keepSinger}">הזמר נשאר מתחת</button>
            </div>
            <span class="hint">ההורדה עובדת הכי טוב כשהזמר באמצע והכלים בצדדים. תקשיבו ותחליטו.</span>
          </div>`
        : html`<p class="notice">הקובץ במונו, אז אי אפשר להוריד ממנו את הזמר. הוא יישאר מתחת לקולות שלכם.</p>`}
        <div id="ly"></div>
      </div>
    `);
    lyricsArea();
    drawWave($('#wave', el), st.audio);
    $('#p-orig', el).onclick = () => playBuf(st.audio);
    $('#p-inst', el) && ($('#p-inst', el).onclick = () => playBuf(st.inst));
    $('#p-stop', el).onclick = stopAudio;
    $$('[data-keep]', el).forEach(b => b.onclick = () => {
      st.keepSinger = b.dataset.keep === '1';
      $$('[data-keep]', el).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    });
    $('#title', el).oninput = e => { st.title = e.target.value; };
    if (st.stt.state === 'idle') detect();
  }

  // ---------- automatic lyrics ----------
  async function detect() {
    st.stt = { ...st.stt, state: 'busy', error: '' };
    lyricsArea();
    try {
      // Send the middle of the mix in mono at 16 kHz: that's where the singer is, and it keeps the upload small.
      const voice = downsample(mono(st.audio), st.audio.sampleRate, 16000);
      const r = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'x-geva-lang': st.stt.lang }, body: encodeWav(voice, 16000) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'זיהוי המילים נכשל');
      if (!data.lines?.length) throw new Error('לא שמענו מילים בשיר. אפשר לכתוב אותן ידנית.');
      st.lines = guessChorus(data.lines.map(l => ({ ...l, chorus: false })));
      st.stt = { ...st.stt, state: 'done' };
    } catch (e) {
      st.stt = { ...st.stt, state: 'fail', error: e.message };
    }
    if (el.isConnected && $('#ly', el)) lyricsArea();
  }

  function lyricsArea() {
    const box = $('#ly', el);
    if (!box) return;
    const s = st.stt;
    const langSeg = html`
      <div class="seg" style="margin-top:4px">
        <button type="button" data-lang="he" aria-pressed="${s.lang === 'he'}">עברית</button>
        <button type="button" data-lang="en" aria-pressed="${s.lang === 'en'}">English</button>
      </div>`;
    if (s.state === 'busy' || s.state === 'idle') {
      mount(box, html`<div class="field"><span class="label">המילים</span><p class="muted" style="margin:0"><span class="spin"></span> מקשיב לשיר ומזהה את המילים…</p></div>`);
      return;
    }
    if (s.state === 'done') {
      mount(box, html`
        <div class="field">
          <span class="label">המילים</span>
          <p style="margin:0">זיהינו ${st.lines.length} שורות, עם תזמון.${st.lines.some(l => l.chorus) ? ' שורות שחוזרות סימנו כפזמון.' : ''}</p>
          <div class="row" style="justify-content:space-between">${langSeg}<span class="muted small">השיר בשפה אחרת? בוחרים ומזהים שוב.</span></div>
        </div>
        <div class="row end"><button class="btn primary" id="next" type="button">לראות את השורות</button></div>`);
      $('#next', el).onclick = () => { stopAudio(); review(); };
    } else {
      mount(box, html`
        <div class="field">
          <label for="lyrics">המילים</label>
          <p class="notice" style="margin:0 0 6px">${s.error}</p>
          <div class="row">${langSeg}<button class="btn ghost" id="retry" type="button">לנסות לזהות שוב</button></div>
          <textarea id="lyrics" placeholder="או לכתוב לבד, שורה בכל שורה">${st.lyrics}</textarea>
        </div>
        <div class="row end"><button class="btn primary" id="next" type="button">לתזמן את השורות</button></div>`);
      $('#retry', el).onclick = detect;
      $('#next', el).onclick = () => {
        st.lyrics = $('#lyrics', el).value;
        const rows = st.lyrics.split('\n').map(x => x.trim()).filter(Boolean);
        if (rows.length < 2) return toast('צריך לפחות שתי שורות');
        if (rows.length > 80) return toast('יותר מדי שורות. עד 80.');
        st.lines = rows.map(text => ({ text, t0: 0, t1: 0, chorus: false }));
        stopAudio();
        tap();
      };
    }
    $$('[data-lang]', box).forEach(b => b.onclick = () => {
      if (st.stt.lang === b.dataset.lang && st.stt.state !== 'fail') return;
      st.stt.lang = b.dataset.lang;
      detect();
    });
  }

  function tap() {
    let i = -1, origin = 0, running = false;
    mount(el, html`
      <div class="panel stack" style="text-align:center">
        <p class="muted small" style="margin:0">השיר יתנגן. כל פעם שמתחילה שורה, לוחצים על הכפתור או על רווח.</p>
        <div class="tap-now" id="now">מוכנים?</div>
        <div class="tap-next" id="nx">${st.lines[0].text}</div>
        <div class="progress"><i id="bar"></i></div>
        <div class="row" style="justify-content:center">
          <button class="btn primary big" id="hit" type="button" style="min-width:220px">להתחיל</button>
        </div>
        <div class="row" style="justify-content:center"><button class="link-btn" id="back" type="button">חזרה למילים</button></div>
      </div>
    `);
    const now = $('#now', el), nx = $('#nx', el), hitBtn = $('#hit', el), bar = $('#bar', el);
    let raf = 0;
    const tick = () => {
      const t = ctx.currentTime - origin;
      bar.style.width = `${Math.min(100, (t / st.audio.duration) * 100)}%`;
      if (t >= st.audio.duration) return finish();
      raf = requestAnimationFrame(tick);
    };
    const hit = () => {
      if (!running) { running = true; origin = playBuf(st.audio); hitBtn.textContent = 'עכשיו'; now.textContent = '…'; raf = requestAnimationFrame(tick); return; }
      i++;
      if (i < st.lines.length) {
        st.lines[i].t0 = Math.max(0, ctx.currentTime - origin - 0.08); // people tap a little late
        now.textContent = st.lines[i].text;
        nx.textContent = st.lines[i + 1]?.text || 'לחיצה אחרונה כשהשורה נגמרת';
        if (i === st.lines.length - 1) hitBtn.textContent = 'סוף';
      } else finish(ctx.currentTime - origin);
    };
    const finish = endAt => {
      cancelAnimationFrame(raf); stopAudio();
      removeEventListener('keydown', onKey);
      if (i < 1) { toast('צריך לתזמן את השורות. ננסה שוב.'); return tap(); }
      const tapped = st.lines.slice(0, Math.min(i + 1, st.lines.length));
      const lens = tapped.slice(1).map((l, k) => l.t0 - tapped[k].t0);
      const avg = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 3;
      st.lines = tapped.map((l, k) => {
        const nextT0 = tapped[k + 1]?.t0;
        let t1 = nextT0 !== undefined ? nextT0 - 0.06 : Math.min(endAt ?? l.t0 + avg, st.audio.duration);
        t1 = Math.min(t1, l.t0 + Math.max(avg * 1.7, 3.5)); // a long instrumental gap isn't part of the line
        return { ...l, t1: Math.max(l.t0 + 0.6, t1) };
      });
      review();
    };
    const onKey = e => { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); hit(); } };
    addEventListener('keydown', onKey);
    hitBtn.onclick = hit;
    $('#back', el).onclick = () => { cancelAnimationFrame(raf); stopAudio(); removeEventListener('keydown', onKey); preview(); };
  }

  function review() {
    mount(el, html`
      <div class="panel stack">
        <div class="row" style="justify-content:space-between">
          <h3 style="margin:0">השורות</h3>
          <span class="muted small">מסמנים "כולם" על הפזמון</span>
        </div>
        <ul class="lines-edit">
          ${st.lines.map((l, k) => html`
            <li>
              <span class="t mono">${fmtTime(l.t0)}.${String(Math.floor((l.t0 % 1) * 10))}</span>
              <textarea class="line-text" data-text="${k}" rows="1" maxlength="120" aria-label="שורה ${k + 1}">${l.text}</textarea>
              <span class="row" style="gap:6px;flex-wrap:nowrap">
                <button class="chip" type="button" data-play="${k}" aria-label="להשמיע">▶</button>
                <button class="chip" type="button" data-chorus="${k}" aria-pressed="${l.chorus}">כולם</button>
                <button class="chip" type="button" data-del="${k}" aria-label="למחוק שורה">✕</button>
              </span>
            </li>`)}
        </ul>
        <p class="muted small" style="margin:0">טעות במילה? לוחצים עליה ומתקנים.</p>
        <div class="row" style="justify-content:space-between">
          <button class="btn ghost" type="button" id="again">לתזמן ידנית</button>
          <button class="btn primary" type="button" id="ok">זה טוב</button>
        </div>
      </div>
    `);
    const fit = t => { t.style.height = 'auto'; t.style.height = `${t.scrollHeight + 2}px`; };
    $$('[data-text]', el).forEach(t => {
      fit(t);
      t.oninput = () => { st.lines[+t.dataset.text].text = t.value.replace(/\n/g, ' '); fit(t); };
    });
    $$('[data-del]', el).forEach(b => b.onclick = () => {
      if (st.lines.length <= 2) return toast('צריך לפחות שתי שורות');
      st.lines.splice(+b.dataset.del, 1); review();
    });
    $$('[data-chorus]', el).forEach(b => b.onclick = () => {
      const l = st.lines[+b.dataset.chorus]; l.chorus = !l.chorus; b.setAttribute('aria-pressed', String(l.chorus));
    });
    $$('[data-play]', el).forEach(b => b.onclick = () => {
      const l = st.lines[+b.dataset.play];
      playBuf(st.audio, l.t0);
      setTimeout(stopAudio, (l.t1 - l.t0 + 0.2) * 1000);
    });
    $('#again', el).onclick = () => { stopAudio(); st.lines = st.lines.map(l => ({ ...l, t0: 0, t1: 0 })); tap(); };
    $('#ok', el).onclick = () => {
      stopAudio();
      st.lines = st.lines.map(l => ({ ...l, text: l.text.trim() })).filter(l => l.text);
      if (st.lines.length < 2) return toast('צריך לפחות שתי שורות');
      if (st.lines.every(l => l.chorus)) return toast('לפחות שורה אחת צריכה להיות סולו');
      const regs = lineRegisters(st.audio, st.lines);
      const lines = st.lines.map((l, k) => ({ ...l, spoken: false, register: regs[k] }));
      onDone({
        meta: { title: st.title, duration: st.audio.duration, fingerprint: fingerprint(st.audio), lines },
        bytes: st.bytes, keepSinger: st.keepSinger,
      });
    };
  }

  pick();
  return stopAudio;
}

// Lines that come back more than once are almost always the chorus.
function guessChorus(lines) {
  const norm = s => s.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();
  const count = new Map();
  lines.forEach(l => { const k = norm(l.text); if (k.length > 3) count.set(k, (count.get(k) || 0) + 1); });
  const out = lines.map(l => ({ ...l, chorus: (count.get(norm(l.text)) || 0) >= 2 }));
  return out.every(l => l.chorus) || !out.some(l => !l.chorus) ? lines : out;
}

function drawWave(canvas, audio) {
  const g = canvas.getContext('2d');
  const d = audio.getChannelData(0);
  const W = canvas.width, H = canvas.height, step = Math.floor(d.length / W);
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#8b8d92';
  for (let x = 0; x < W; x += 3) {
    let m = 0;
    for (let i = x * step; i < (x + 1) * step; i += 8) m = Math.max(m, Math.abs(d[i]));
    const h = Math.max(2, m * H * 0.9);
    g.fillRect(W - x - 2, (H - h) / 2, 2, h);
  }
}
