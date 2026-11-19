import { $, html, mount, toast, api, syncClock, serverNow } from '../util.js';
import { audioCtx, decode, mono } from '../audio.js';
import { songAudio } from '../song-source.js';
import { buildMix } from '../mix.js';
import { analyze } from '../stats.js';
import { Stage, Player, loadFonts, memeFrame, PRE } from '../stage.js';

export function premiereView(app, { code, room, info, onUpdate, onExit }) {
  const ctx = audioCtx();
  const isHost = room.hostId === room.you.id;
  const st = { ready: false, player: null, stage: null, seen: room.premiere?.n || 0, urls: [], dead: false, playing: false, exporting: false, result: null };
  let current = room;

  mount(app, html`
    <div class="room-head">
      <div>
        <p class="kicker"><b>פרמיירה</b> · ${info.title}${info.forName ? ` ל${info.forName}` : ''}</p>
        <h1 class="display" style="font-size:clamp(34px,5.6vw,58px)" id="hl">${isHost ? 'כולם מוכנים?' : 'מחכים למארגן.'}</h1>
      </div>
      <button class="btn ghost" id="x">לחדר</button>
    </div>
    <div class="premiere">
      <div class="stage" id="stage">
        <canvas id="cv"></canvas>
        <div class="over" id="over"><div><span class="spin"></span><p class="muted" id="prep" style="margin:14px 0 0">מוריד את ההקלטות</p></div></div>
      </div>
      <div class="stack" id="side">
        <div class="panel stack">
          <p style="margin:0">${room.members.map(m => m.name).join(' · ')}</p>
          <p class="muted small" style="margin:0">${isHost
            ? 'כשמתחילים, הפרמיירה מתנגנת אצל כל מי שבחדר באותה שנייה. כדאי להיות ביחד בשיחה, ולהשתיק את הרמקול אצל כולם חוץ מאחד.'
            : 'כשהמארגן יתחיל, זה יתנגן פה לבד. אל תסגור את הדף.'}</p>
          <div class="row" id="ctl">
            ${isHost ? html`<button class="btn primary big" id="start" disabled>להתחיל פרמיירה</button>` : ''}
          </div>
        </div>
        <div id="after"></div>
      </div>
    </div>
  `);

  const over = $('#over', app), prep = $('#prep', app), hl = $('#hl', app);
  $('#x', app).onclick = () => { cleanup(); onExit(); };

  onUpdate(r => {
    current = r;
    if (r.premiere && r.premiere.n !== st.seen) { st.seen = r.premiere.n; schedule(r.premiere.startAt); }
  });

  function cleanup() {
    st.dead = true;
    st.player?.stop();
    st.urls.forEach(u => URL.revokeObjectURL(u));
  }

  // ---------- prepare ----------
  async function prepare() {
    await syncClock().catch(() => {});
    const song = await songAudio(current.song, code);
    if (!song) { prep.textContent = 'השיר לא נמצא במכשיר הזה'; return; }
    const members = [];
    const videos = new Map();
    let k = 0;
    for (const m of current.members) {
      if (!m.take) continue;
      prep.textContent = `מוריד את ההקלטות · ${++k}/${current.members.length}`;
      const buf = await api(`/rooms/${code}/take/audio/${m.id}`, { code });
      const audio = await decode(buf);
      members.push({ id: m.id, name: m.name, samples: mono(audio), sampleRate: audio.sampleRate });
      if (m.take.video) {
        const vb = await api(`/rooms/${code}/take/video/${m.id}`, { code });
        const url = URL.createObjectURL(new Blob([vb], { type: m.take.videoType || 'video/webm' }));
        st.urls.push(url);
        const el = document.createElement('video');
        el.src = url; el.muted = true; el.playsInline = true; el.preload = 'auto';
        await new Promise(r => { el.onloadeddata = r; el.onerror = r; setTimeout(r, 4000); });
        videos.set(m.id, { el, offset: m.take.videoOffset || 0 });
      }
      if (st.dead) return;
    }
    const victimId = current.chaos.victimId;
    const mix = await buildMix({ info, bed: song.bed, bedHasSinger: song.bedHasSinger, members, parts: current.parts, victimId, onStep: s => { prep.textContent = s; } });
    prep.textContent = 'סופר מי ניצח';
    await new Promise(r => setTimeout(r, 20));
    const result = analyze({ info, timeline: mix.timeline, takes: mix.takes, members: current.members, victimId });
    await loadFonts();
    if (st.dead) return;

    st.result = result;
    st.stage = new Stage($('#cv', app), { info, timeline: mix.timeline, members: current.members, videos, victimId, awards: result.awards, title: info.forName ? `${info.title} ל${info.forName}` : info.title });
    st.player = new Player(st.stage, mix.buffer);
    st.stage.draw(1.3); // the studio card, fully drawn, as the poster
    st.ready = true;

    over.innerHTML = '';
    over.classList.add('hide');
    if (isHost) {
      const b = $('#start', app);
      b.disabled = false;
      b.onclick = start;
      hl.textContent = current.status === 'premiere' ? 'עוד פעם?' : 'כולם מוכנים?';
    }
    if (current.status === 'premiere') afterControls();
    // Joined late, or opened during a premiere that's still running.
    if (current.premiere && current.premiere.startAt + (st.stage.total * 1000) > serverNow()) schedule(current.premiere.startAt);
  }

  async function start() {
    const b = $('#start', app); b.disabled = true;
    try { await api(`/rooms/${code}/premiere`, { method: 'POST', code }); }
    catch (e) { toast(e.message); b.disabled = false; }
  }

  // ---------- play together ----------
  function schedule(startAt) {
    if (!st.ready) return; // prepare() picks it up when done
    if (st.exporting) return;
    const wait = (startAt - serverNow()) / 1000;
    st.player.stop();
    const at = ctx.currentTime + Math.max(0.05, wait);
    const from = wait < 0 ? -wait : 0;
    if (from > st.stage.total) return;
    hl.textContent = 'פרמיירה';
    $('#start', app)?.setAttribute('disabled', '');
    over.classList.remove('hide');
    const cd = () => {
      const left = at - ctx.currentTime;
      if (st.dead) return;
      if (left > 0) { over.innerHTML = `<span class="n">${Math.ceil(left)}</span>`; requestAnimationFrame(cd); }
      else { over.classList.add('hide'); over.innerHTML = ''; }
    };
    cd();
    st.player.onEnd = () => { hl.textContent = 'נשמע? ככה זה נשמע.'; if (isHost) $('#start', app)?.removeAttribute('disabled'); afterControls(); };
    st.player.play({ at, from });
  }

  // ---------- after ----------
  function afterControls() {
    const el = $('#after', app);
    if (!el || !st.result) return;
    const { awards, moment } = st.result;
    mount(el, html`
      <div class="panel">
        <h3>הפרסים</h3>
        <ul class="awards">
          ${awards.map(a => html`<li class="${a.victim ? 'victim' : ''}"><span><span class="what">${a.what}</span><br><span class="who">${a.who}</span></span><span class="num mono">${a.num}</span></li>`)}
        </ul>
      </div>
      <div class="panel stack">
        <h3 style="margin:0">לשמור</h3>
        <div class="row">
          <button class="btn primary" id="save-v">סרטון אנכי</button>
          ${moment ? html`<button class="btn" id="save-m">מם מהרגע הכי מצחיק</button>` : ''}
          <button class="btn ghost" id="again">לראות שוב, רק אצלי</button>
        </div>
        <div class="progress hide" id="exp"><i></i></div>
        <p class="muted small" style="margin:0">הסרטון בגודל של סטטוס וטיקטוק. הוא נוצר בזמן אמת, אז זה לוקח בדיוק את אורך השיר.</p>
      </div>
    `);
    $('#again', el).onclick = () => { st.player.stop(); st.player.onEnd = () => {}; st.player.play({}); };
    $('#save-v', el).onclick = exportVideo;
    $('#save-m', el) && ($('#save-m', el).onclick = exportMeme);
  }

  async function exportVideo() {
    if (st.exporting) return;
    st.exporting = true;
    const btn = $('#save-v', app), bar = $('#exp', app), fill = bar.firstElementChild;
    btn.disabled = true; btn.textContent = 'מקליט…'; bar.classList.remove('hide');
    st.player.stop();
    try {
      const blob = await st.player.record(p => { fill.style.width = `${Math.min(100, p * 100)}%`; });
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      download(blob, `GevaDub-${code}.${ext}`);
      toast(ext === 'webm' ? 'נשמר כ-WebM. וואטסאפ וטיקטוק מקבלים את זה, ואם לא, כל ממיר חינמי יהפוך ל-MP4.' : 'נשמר', 5000);
    } catch (e) { toast('השמירה נכשלה בדפדפן הזה'); }
    st.exporting = false;
    btn.disabled = false; btn.textContent = 'סרטון אנכי'; bar.classList.add('hide');
    st.player.onEnd = () => {};
  }

  async function exportMeme() {
    const { moment } = st.result;
    const victim = current.chaos.victimId;
    const name = current.members.find(m => m.id === moment.id)?.name || '';
    const caption = moment.id === victim ? 'כשהקובייה נפלה עליך' : `${name} בשיא הקריירה`;
    st.player.stop();
    const blob = await memeFrame(st.stage, moment.t, caption);
    const file = new File([blob], `GevaDub-${code}.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch {} }
    download(blob, file.name);
    st.stage.draw(PRE + moment.t);
  }

  prepare().catch(e => { console.error(e); prep.textContent = 'משהו נשבר בהכנה. לרענן את הדף?'; });
  return cleanup;
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
