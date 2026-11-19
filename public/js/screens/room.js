import { $, html, mount, toast, api, roomAuth, saveRoom, lastName, setLastName, initial, putSong, getSong } from '../util.js';
import { songInfo } from '../song-source.js';
import { renderBuiltin } from '../songs.js';
import { splitParts } from '../split.js';
import { openMic, audioCtx } from '../audio.js';
import { track, percentile } from '../pitch.js';
import { decodeFile, fingerprint, sameSong } from '../gallery.js';
import { recordView } from './record.js';
import { premiereView } from './premiere.js';

export function roomScreen(app, code) {
  let room = null;
  let es = null;
  let busy = null;        // 'record' | 'premiere' while a full-screen flow owns the page
  let busyUpdate = null;  // the flow's handler for room updates
  let busyCleanup = null;
  let dead = false;
  let hasSong = true;

  const auth = () => roomAuth(code);

  async function load() {
    try {
      room = await api(`/rooms/${code}`, { code });
    } catch (e) {
      mount(app, html`<section class="hero"><p class="kicker">חדר ${code}</p><h1 class="display">${e.message}</h1>
        <div class="row"><a class="btn" href="/" data-link>לדף הבית</a></div></section>`);
      return false;
    }
    if (room.song.kind === 'upload' && room.you) hasSong = !!(await getSong(`room:${code}`));
    return true;
  }

  async function refresh() {
    if (dead) return;
    if (!(await load())) return;
    if (busy) { busyUpdate?.(room); return; }
    if (shouldAutoPremiere()) return startPremiere(songInfo(room.song));
    render();
  }

  // Guests jump straight into the premiere screen once everyone's recorded.
  const shouldAutoPremiere = () =>
    room.you && (room.status === 'ready' || room.status === 'premiere') &&
    room.hostId !== room.you.id && !(room.song.kind === 'upload' && !hasSong);

  function listen() {
    es = new EventSource(`/api/rooms/${code}/events`);
    let t = 0;
    es.onmessage = () => { clearTimeout(t); t = setTimeout(refresh, 120); };
  }

  function render() {
    const info = songInfo(room.song);
    if (!info) return mount(app, html`<p class="empty">השיר של החדר הזה לא קיים בגרסה הזאת.</p>`);
    if (!room.you) return joinView(info);
    if (room.song.kind === 'upload' && !hasSong) return importView(info);

    // Start building our song in the background, so "record" is instant.
    if (room.song.kind === 'builtin' && room.status === 'recording') renderBuiltin(room.song.id, room.song.forName);

    const me = room.members.find(m => m.id === room.you.id);
    const isHost = room.hostId === room.you.id;
    const host = room.members.find(m => m.id === room.hostId);
    const link = `${location.origin}/r/${code}`;
    const recorded = room.members.filter(m => m.recorded).length;

    mount(app, html`
      <div class="room-head">
        <div>
          <p class="kicker"><b>${statusLabel(room.status)}</b> · ${info.title}${info.forName ? ` ל${info.forName}` : ''}</p>
          <h1 class="display" style="font-size:clamp(34px,5.6vw,58px)">${headline(room, isHost, host, recorded)}</h1>
        </div>
        ${room.status === 'lobby' ? html`
          <div class="invite">
            <span class="muted small">קוד החדר</span>
            <span class="code-big">${code}</span>
            <div class="row">
              <button class="btn" id="copy">להעתיק קישור</button>
              ${navigator.share ? html`<button class="btn ghost" id="share">לשלוח</button>` : ''}
            </div>
          </div>` : ''}
      </div>

      <div class="room-grid">
        <div class="stack">${mainPanel(room, info, me, isHost, recorded)}</div>
        <div class="stack">
          <div class="panel">
            <div class="row" style="justify-content:space-between;margin-bottom:6px">
              <h3 style="margin:0">בחדר</h3><span class="muted small mono">${room.members.length}/8</span>
            </div>
            <ul class="members">
              ${room.members.map(m => html`
                <li class="${m.id === room.you.id ? 'you' : ''}">
                  <span class="avatar">${initial(m.name)}</span>
                  <span>${m.name}${m.id === room.hostId ? html` <span class="muted small">· פתח את החדר</span>` : ''}</span>
                  <span class="tag ${memberOk(room, m) ? 'ok' : ''}">${memberTag(room, m)}</span>
                </li>`)}
            </ul>
          </div>
          ${room.chaos.youHold && room.status === 'recording' ? diceCard(room) : ''}
        </div>
      </div>
    `);

    $('#copy', app)?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(link); toast('הקישור הועתק. שולחים לקבוצה.'); } catch { toast(link, 5000); }
    });
    $('#share', app)?.addEventListener('click', () => navigator.share({ title: 'GevaDub', text: `בואו לשיר איתי: ${info.title}`, url: link }).catch(() => {}));
    $('#voice', app)?.addEventListener('click', () => voiceCheck());
    $('#lock', app)?.addEventListener('click', () => lock(info));
    $('#rec', app)?.addEventListener('click', () => startRecord(info));
    $('#dice', app)?.addEventListener('click', throwDice);
    $('#prem', app)?.addEventListener('click', () => startPremiere(info));
  }

  // ---------- panels ----------
  function mainPanel(room, info, me, isHost, recorded) {
    const myLines = room.parts ? info.lines.map((l, i) => ({ ...l, i })).filter(l => room.parts[l.i] === me.id || room.parts[l.i] === 'all') : [];
    if (room.status === 'lobby') {
      const unchecked = room.members.filter(m => !m.range).length;
      return html`
        <div class="panel stack">
          <div>
            <h3>בדיקת קול</h3>
            <p class="muted small" style="margin:0">${room.split === 'smart'
              ? 'שרים "אההה" מהנמוך לגבוה, ארבע שניות. ככה יודעים איזה שורות לתת לך.'
              : 'החדר הזה מחלק באקראי, אז זה רק בשביל לבדוק שהמיקרופון עובד.'}</p>
          </div>
          <div class="row">
            <button class="btn ${me.range ? '' : 'primary'}" id="voice">${me.range ? 'לבדוק שוב' : 'לעשות בדיקת קול'}</button>
            ${me.range ? html`<span class="muted small">נשמעת ב-<span class="mono">${me.range.median} Hz</span></span>` : ''}
          </div>
        </div>
        ${isHost ? html`
          <div class="panel stack">
            <div>
              <h3>כשכולם פה</h3>
              <p class="muted small" style="margin:0">אחרי החלוקה אי אפשר להצטרף. ${room.split === 'smart' && unchecked ? (unchecked === 1 ? 'מישהו אחד עוד לא עשה בדיקת קול, אז הוא יקבל שורות מהאמצע.' : `${unchecked} עוד לא עשו בדיקת קול, אז הם יקבלו שורות מהאמצע.`) : ''}</p>
            </div>
            <div class="row"><button class="btn primary big" id="lock">לחלק את השיר</button></div>
          </div>` : html`
          <div class="panel"><p class="muted" style="margin:0">מחכים ש${room.members.find(m => m.id === room.hostId)?.name} יחלק את השיר.</p></div>`}
        ${songPreview(info)}`;
    }
    if (room.status === 'recording') {
      return html`
        <div class="panel stack">
          <div class="row" style="justify-content:space-between">
            <h3 style="margin:0">${me.recorded ? 'ההקלטה שלך בפנים' : 'החלק שלך'}</h3>
            <span class="muted small mono">${recorded}/${room.members.length}</span>
          </div>
          <div class="progress"><i style="width:${(recorded / room.members.length) * 100}%"></i></div>
          ${me.recorded
            ? html`<p class="muted small" style="margin:0">אף אחד לא שומע את זה עד הפרמיירה. גם את השאר לא תשמע לפני.</p>`
            : html`<p class="muted small" style="margin:0">אוזניות, חדר שקט, ואת כל השיר בהקלטה אחת. מסומן לך מתי אתה שר.</p>`}
          <div class="row">
            <button class="btn ${me.recorded ? '' : 'primary big'}" id="rec">${me.recorded ? 'להקליט מחדש' : 'להקליט'}</button>
          </div>
        </div>
        <div class="panel">
          <h3>השורות שלך</h3>
          <ul class="parts">
            ${myLines.map(l => html`<li class="mine"><span class="txt">${l.text}</span><span class="who">${l.chorus ? 'כולם' : 'סולו'}</span></li>`)}
          </ul>
          ${!myLines.some(l => !l.chorus) ? html`<p class="muted small">היו יותר זמרים משורות, אז יש לך את כל הפזמונים.</p>` : ''}
        </div>`;
    }
    // ready / premiere
    return html`
      <div class="panel stack">
        <h3 style="margin:0">${room.status === 'premiere' ? 'הייתה פרמיירה' : 'כולם הקליטו'}</h3>
        <p class="muted small" style="margin:0">${isHost
          ? 'לוחצים, וכל מי שבחדר רואה את זה באותה שנייה. כדאי להיות ביחד בשיחה.'
          : 'כשהמארגן יתחיל, זה יתנגן אצלך אוטומטית. אל תסגור את הדף.'}</p>
        <div class="row"><button class="btn primary big" id="prem">${isHost ? (room.status === 'premiere' ? 'פרמיירה שוב' : 'להתחיל פרמיירה') : 'לפתוח את המסך'}</button></div>
      </div>`;
  }

  function songPreview(info) {
    return html`
      <div class="panel">
        <div class="row" style="justify-content:space-between;margin-bottom:4px">
          <h3 style="margin:0">השיר</h3>
          <span class="muted small">${info.lines.filter(l => !l.chorus).length} שורות סולו · ${info.lines.filter(l => l.chorus).length} של כולם</span>
        </div>
        <ul class="parts">
          ${info.lines.map(l => html`<li><span class="txt">${l.text}</span><span class="who">${l.chorus ? 'כולם' : ''}</span></li>`)}
        </ul>
      </div>`;
  }

  function diceCard(room) {
    if (room.chaos.used) {
      return html`<div class="panel dice used"><span class="face">⚂</span><h3 style="margin-top:12px">הקובייה הוטלה</h3>
        <p class="muted small" style="margin:0">מישהו בחדר הולך להישמע מוזר מאוד. רק בפרמיירה יגלו מי. ולא, אף אחד לא יודע שזה היית אתה.</p></div>`;
    }
    return html`
      <div class="panel dice">
        <span class="face">⚄</span>
        <h3 style="margin-top:12px">הקובייה אצלך</h3>
        <p class="muted small">רק לך יש אותה. מטילים פעם אחת, והיא בוחרת מישהו אחר בחדר שהקול שלו יעבור אוטו-טיון מוגזם. לא אתה בוחר על מי, והוא לא יודע עד הפרמיירה.</p>
        <button class="btn" id="dice">להטיל</button>
      </div>`;
  }

  // ---------- views ----------
  function joinView(info) {
    const open = room.status === 'lobby';
    mount(app, html`
      <section class="hero">
        <p class="kicker"><b>GevaDub</b> · חדר ${code}</p>
        <h1 class="display">${open ? html`הזמינו אותך<br>ל<span class="underline">${info.title}</span>.` : 'החדר הזה כבר התחיל.'}</h1>
        <p class="lede">${open
          ? `${room.members.map(m => m.name).join(', ')} כבר בפנים. מקבלים כמה שורות, מקליטים מהבית, ושומעים הכל ביחד בפרמיירה.`
          : 'השורות כבר חולקו. אפשר לבקש ממי ששלח את הקישור לפתוח חדר חדש.'}</p>
        ${open ? html`
          <form class="row" id="jf" style="margin-top:28px" autocomplete="off">
            <input type="text" id="jn" maxlength="24" placeholder="השם שלך" value="${lastName()}" style="max-width:260px" required>
            <button class="btn primary big" type="submit">להיכנס</button>
          </form>` : html`<div class="row" style="margin-top:28px"><a class="btn" href="/" data-link>לדף הבית</a></div>`}
      </section>
    `);
    $('#jf', app)?.addEventListener('submit', async e => {
      e.preventDefault();
      const name = $('#jn', app).value.trim();
      if (!name) return;
      try {
        const r = await api(`/rooms/${code}/join`, { method: 'POST', body: { name } });
        setLastName(name);
        saveRoom(code, { token: r.token, memberId: r.memberId, name, title: info.title });
        await refresh();
      } catch (err) { toast(err.message); }
    });
  }

  function importView(info) {
    mount(app, html`
      <section class="hero" style="padding-bottom:24px">
        <p class="kicker"><b>שלב אחד לפני</b> · ${info.title}</p>
        <h1 class="display" style="font-size:clamp(34px,5.6vw,58px)">צריך את אותו שיר<br>גם אצלך.</h1>
        <p class="lede">השיר של החדר הזה הגיע מהגלריה של מישהו, והוא לא עובר דרך השרת. בוחרים את אותו סרטון או קובץ מהגלריה שלך, ואנחנו בודקים שזה אותו שיר.</p>
      </section>
      <label class="drop panel">
        <input type="file" accept="video/*,audio/*" id="file">
        <span style="font-family:var(--font-display);font-size:24px;color:var(--text)">לבחור את "${info.title}"</span>
        <span class="small">אותו סרטון שנשלח בקבוצה. לא חייב להיות אותו שם קובץ.</span>
      </label>
      <p class="muted small" id="msg" style="margin-top:12px"></p>
    `);
    $('#file', app).addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      const msg = $('#msg', app);
      msg.innerHTML = '<span class="spin"></span> בודק…';
      try {
        const { audio, bytes } = await decodeFile(f);
        const res = sameSong(info.fingerprint, fingerprint(audio));
        if (!res.ok) { msg.textContent = 'זה לא נראה כמו אותו שיר. אולי גרסה אחרת או קטע אחר? נסו שוב.'; return; }
        await putSong(`room:${code}`, { bytes });
        hasSong = true;
        toast('זה אותו שיר');
        render();
      } catch (err) { msg.textContent = err.message; }
    });
  }

  // ---------- actions ----------
  async function voiceCheck() {
    const btn = $('#voice', app);
    let mic;
    try { mic = await openMic(); }
    catch { return toast('אין גישה למיקרופון. צריך לאשר בדפדפן.', 4000); }
    const panel = btn.closest('.panel');
    const old = panel.innerHTML;
    panel.innerHTML = `<h3>אההה…</h3><p class="muted small" style="margin:0">מהנמוך שלך לגבוה, לאט.</p><div class="meter"><i id="lv"></i></div><div class="progress"><i id="pg"></i></div>`;
    const lv = $('#lv', panel), pg = $('#pg', panel);
    const ctx = audioCtx();
    const at = ctx.currentTime + 0.1, dur = 4.2;
    const done = mic.record(at, dur);
    const t0 = performance.now();
    const iv = setInterval(() => {
      lv.style.width = `${Math.min(100, mic.level * 400)}%`;
      pg.style.width = `${Math.min(100, (performance.now() - t0) / (dur * 10))}%`;
    }, 50);
    const samples = await done;
    clearInterval(iv); mic.close();
    const voiced = track(samples, mic.sampleRate, { minHz: 70, maxHz: 1000 }).filter(f => f.f0s > 0).map(f => f.f0s);
    if (voiced.length < 20) { render(); return toast('לא שמענו מספיק. עוד פעם, קצת יותר חזק.'); }
    try {
      await api(`/rooms/${code}/range`, { method: 'POST', code, body: { median: percentile(voiced, 50), low: percentile(voiced, 10), high: percentile(voiced, 90) } });
      toast('נשמע מצוין');
    } catch (e) { toast(e.message); }
    await refresh();
  }

  async function lock(info) {
    const parts = splitParts(info.lines, room.members, room.split);
    try { await api(`/rooms/${code}/lock`, { method: 'POST', code, body: { parts } }); }
    catch (e) { toast(e.message); }
  }

  async function throwDice() {
    const b = $('#dice', app); b.disabled = true;
    try { await api(`/rooms/${code}/chaos`, { method: 'POST', code }); toast('הוטלה. סוד בינינו.'); }
    catch (e) { toast(e.message); b.disabled = false; }
  }

  function startRecord(info) {
    busy = 'record';
    busyUpdate = null;
    busyCleanup = recordView(app, {
      code, room, info,
      onUpdate: fn => { busyUpdate = fn; },
      onExit: async () => { busy = null; busyCleanup = null; await refresh(); },
    });
  }

  function startPremiere(info) {
    busy = 'premiere';
    busyCleanup = premiereView(app, {
      code, room, info,
      onUpdate: fn => { busyUpdate = fn; },
      onExit: async () => { busy = null; busyCleanup = null; await refresh(); },
    });
  }

  (async () => {
    mount(app, html`<p class="empty"><span class="spin"></span></p>`);
    if (!(await load())) return;
    listen();
    if (shouldAutoPremiere()) startPremiere(songInfo(room.song));
    else render();
  })();

  return () => { dead = true; es?.close(); busyCleanup?.(); };
}

function statusLabel(s) {
  return { lobby: 'מתאספים', recording: 'מקליטים', ready: 'מוכן', premiere: 'פרמיירה' }[s] || s;
}
function headline(room, isHost, host, recorded) {
  if (room.status === 'lobby') return isHost ? 'שולחים קישור, מחכים לחבר׳ה.' : `החדר של ${host?.name || ''}`;
  if (room.status === 'recording') return recorded === room.members.length - 1 ? 'עוד אחד וזהו.' : 'כל אחד בתורו, כל אחד לבד.';
  if (room.status === 'ready') return 'כולם הקליטו. אף אחד עוד לא שמע.';
  return 'נשמע? ככה זה נשמע.';
}
function memberOk(room, m) {
  if (room.status === 'lobby') return !!m.range;
  return m.recorded;
}
function memberTag(room, m) {
  if (room.status === 'lobby') return m.range ? 'קול נבדק' : 'עוד לא נבדק';
  return m.recorded ? 'הקליט' : 'עוד לא';
}
