import { $, html, mount, toast, api, upload, fmtTime } from '../util.js';
import { audioCtx, ctxNow, openMic, encodeWav, downsample, roundTripLatency } from '../audio.js';
import { songAudio } from '../song-source.js';

const COUNT_IN = 3;
const UPLOAD_RATE = 24000;
const CAMERA_LAG = 0.06;

export function recordView(app, { code, room, info, onUpdate, onExit }) {
  const me = room.you.id;
  const ctx = audioCtx();
  const st = { camera: localStorage.getItem('gevadub:cam') !== '0', mic: null, audio: null, take: null, video: null, videoType: '', videoOffset: 0, sources: [], raf: 0, dead: false };
  let current = room;

  onUpdate(r => {
    current = r;
    if (r.status !== 'recording' && !st.uploading) { toast('כולם כבר הקליטו, אז ההקלטה נסגרה.'); exit(); }
  });

  const stopSources = () => { st.sources.forEach(s => { try { s.stop(); } catch {} }); st.sources = []; };
  const closeMic = () => { st.mic?.close(); st.mic = null; };
  const exit = () => { cleanup(); onExit(); };
  function cleanup() { st.dead = true; cancelAnimationFrame(st.raf); stopSources(); closeMic(); }

  function whoFor(i) {
    const p = current.parts?.[i];
    if (p === 'all') return { label: 'כולם', mine: true };
    if (p === me) return { label: 'אתה', mine: true };
    const m = current.members.find(x => x.id === p);
    return { label: m ? m.name : '', mine: false };
  }

  // ---------- setup ----------
  async function setup() {
    mount(app, html`
      <div class="room-head">
        <div>
          <p class="kicker"><b>הקלטה</b> · ${info.title}</p>
          <h1 class="display" style="font-size:clamp(34px,5.6vw,58px)">אוזניות על הראש?</h1>
        </div>
        <button class="btn ghost" id="x">חזרה לחדר</button>
      </div>
      <div class="rec">
        <div class="cam" id="cam"><div class="off">${st.camera ? 'מדליק מצלמה…' : 'בלי מצלמה'}</div></div>
        <div class="stack">
          <div class="panel stack">
            <p style="margin:0">השיר מתנגן לך באוזניות ואתה שר מעליו. ${info.kind === 'upload' ? 'תשמע את הזמר המקורי, כדי שיהיה לך קל לעקוב. בסרטון הסופי הוא לא יהיה.' : 'יש גם מנגינה עדינה שתעזור לך, והיא לא נכנסת לסרטון.'}</p>
            <p class="muted small" style="margin:0">בלי אוזניות המיקרופון קולט גם את השיר, ואז בסרטון שומעים אותו פעמיים.</p>
            <div class="field">
              <span class="label">מצלמה</span>
              <div class="seg">
                <button type="button" data-cam="1" aria-pressed="${st.camera}">עם הפנים שלי</button>
                <button type="button" data-cam="0" aria-pressed="${!st.camera}">רק קול</button>
              </div>
            </div>
            <div class="field"><span class="label">מיקרופון</span><div class="meter"><i id="lv"></i></div></div>
            <div class="row end"><button class="btn primary big" id="go" disabled><span class="spin"></span> מכין את השיר</button></div>
          </div>
        </div>
      </div>
    `);
    $('#x', app).onclick = exit;
    app.querySelectorAll('[data-cam]').forEach(b => b.onclick = async () => {
      st.camera = b.dataset.cam === '1';
      localStorage.setItem('gevadub:cam', st.camera ? '1' : '0');
      closeMic(); setup();
    });

    try { st.mic = await openMic({ video: st.camera }); }
    catch (e) {
      if (st.camera) { st.camera = false; toast('אין גישה למצלמה. ממשיכים רק עם קול.'); return setup(); }
      $('#cam', app).innerHTML = '<div class="off">אין גישה למיקרופון</div>';
      return toast('צריך לאשר מיקרופון בדפדפן ולנסות שוב.', 5000);
    }
    if (st.dead) return closeMic();
    if (st.camera) {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.autoplay = true;
      v.srcObject = new MediaStream(st.mic.stream.getVideoTracks());
      const cam = $('#cam', app); cam.innerHTML = ''; cam.append(v);
      const live = document.createElement('span'); live.className = 'live'; live.id = 'live'; live.textContent = 'REC'; cam.append(live);
    }
    const lv = $('#lv', app);
    const meter = () => { if (st.dead || !lv.isConnected) return; lv.style.width = `${Math.min(100, st.mic.level * 400)}%`; st.raf = requestAnimationFrame(meter); };
    meter();

    if (!st.audio) {
      st.audio = await songAudio(current.song, code);
      if (!st.audio) { toast('השיר לא נמצא במכשיר הזה'); return exit(); }
    }
    if (st.dead) return;
    const go = $('#go', app);
    go.disabled = false; go.textContent = 'להתחיל להקליט';
    go.onclick = () => { cancelAnimationFrame(st.raf); run(); };
  }

  // ---------- recording ----------
  async function run() {
    const camHtml = $('#cam', app)?.innerHTML;
    const camVideo = $('#cam video', app);
    mount(app, html`
      <div class="room-head">
        <div><p class="kicker"><b>מקליטים</b> · ${info.title}</p>
        <h1 class="display" style="font-size:clamp(28px,4.6vw,46px)" id="hl">מתחילים בעוד רגע</h1></div>
        <button class="btn ghost" id="stop">לעצור</button>
      </div>
      <div class="rec">
        <div class="cam" id="cam"></div>
        <div class="prompter" id="pr">
          <div class="prompter-track" id="track">
            ${info.lines.map((l, i) => { const w = whoFor(i); return html`
              <div class="pline ${w.mine ? 'mine' : ''}" data-i="${i}">
                <span class="who">${w.label}</span>${l.text}<span class="bar"></span>
              </div>`; })}
          </div>
          <div class="countdown" id="cd"></div>
        </div>
      </div>
    `);
    const cam = $('#cam', app);
    if (camVideo) { cam.append(camVideo); camVideo.play().catch(() => {}); const live = document.createElement('span'); live.className = 'live'; live.textContent = 'REC'; cam.append(live); }
    else cam.innerHTML = camHtml || '<div class="off">רק קול</div>';

    const at = ctx.currentTime + COUNT_IN + 0.4;
    const dur = info.duration;

    // what you hear
    const play = (buf, gain) => {
      if (!buf) return;
      const s = ctx.createBufferSource(); s.buffer = buf;
      const g = ctx.createGain(); g.gain.value = gain;
      s.connect(g).connect(ctx.destination); s.start(at);
      st.sources.push(s);
    };
    play(st.audio.listen, info.kind === 'upload' ? 0.85 : 0.9);
    play(st.audio.guide, 0.5);

    // what we keep
    const audioDone = st.mic.record(at, dur);
    let recorder = null, chunks = [], vStart = 0;
    if (st.camera && st.mic.stream.getVideoTracks().length) {
      const types = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
      const mimeType = types.find(t => MediaRecorder.isTypeSupported(t)) || '';
      recorder = new MediaRecorder(new MediaStream(st.mic.stream.getVideoTracks()), { mimeType, videoBitsPerSecond: 1_200_000 });
      recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
      recorder.onstart = () => { vStart = ctxNow(); };
      st.videoType = (mimeType || 'video/webm').split(';')[0];
      setTimeout(() => { if (!st.dead) recorder.start(1000); }, Math.max(0, (at - ctxNow() - 0.25) * 1000));
    }

    let stopped = false;
    $('#stop', app).onclick = () => {
      stopped = true; stopSources(); st.mic.stop(); try { recorder?.stop(); } catch {}
    };

    const track = $('#track', app), pr = $('#pr', app), cd = $('#cd', app), hl = $('#hl', app);
    const els = [...track.children];
    let last = -2;
    const loop = () => {
      if (st.dead) return;
      const t = ctx.currentTime - at;
      if (t < 0) { cd.textContent = String(Math.ceil(-t)); }
      else cd.textContent = '';
      const live = $('#cam .live', app); if (live) live.classList.toggle('on', t >= 0);
      let idx = info.lines.findIndex(l => t < l.t1 + 0.15);
      if (idx < 0) idx = info.lines.length - 1;
      const l = info.lines[idx];
      if (idx !== last) {
        els.forEach((e, k) => e.classList.toggle('now', k === idx));
        const target = els[idx];
        track.style.transform = `translateY(${pr.clientHeight * 0.36 - target.offsetTop}px)`;
        last = idx;
      }
      const w = whoFor(idx);
      const p = Math.max(0, Math.min(1, (t - l.t0) / (l.t1 - l.t0)));
      const bar = els[idx].querySelector('.bar');
      if (bar) bar.style.width = w.mine ? `${p * 100}%` : '0';
      if (t >= 0) hl.textContent = t < l.t0 - 0.2 ? (w.mine ? `עוד ${Math.ceil(l.t0 - t)}… ${w.label === 'כולם' ? 'כולם' : 'אתה'}` : `${w.label} עכשיו. אתה מחכה.`) : (w.mine ? (w.label === 'כולם' ? 'כולם ביחד' : 'עכשיו אתה') : `${w.label}. אתה בשקט.`);
      st.raf = requestAnimationFrame(loop);
    };
    st.raf = requestAnimationFrame(loop);

    const samples = await audioDone;
    cancelAnimationFrame(st.raf);
    if (recorder && recorder.state !== 'inactive') { await new Promise(r => { recorder.onstop = r; recorder.stop(); }); }
    stopSources();
    if (st.dead) return;
    if (stopped) { toast('עצרנו. ההקלטה לא נשמרה.'); return setup(); }

    // Line the take up with the beat: drop the round trip from speaker to ear to mic.
    const lat = roundTripLatency();
    const trimmed = samples.subarray(Math.min(samples.length, Math.round(lat * st.mic.sampleRate)));
    st.take = downsample(trimmed, st.mic.sampleRate, UPLOAD_RATE);
    st.video = chunks.length ? new Blob(chunks, { type: st.videoType }) : null;
    // Video time of the frame where you sing song-time s is s - videoOffset.
    st.videoOffset = st.video ? vStart - at - lat - CAMERA_LAG : 0;
    closeMic();
    review();
  }

  // ---------- listen back ----------
  function review() {
    let peak = 0;
    for (let i = 0; i < st.take.length; i += 16) peak = Math.max(peak, Math.abs(st.take[i]));
    const quiet = peak < 0.05;
    mount(app, html`
      <div class="room-head">
        <div><p class="kicker"><b>זה אתה</b> · ${info.title}</p>
        <h1 class="display" style="font-size:clamp(34px,5.6vw,58px)">רק אתה שומע את זה.</h1></div>
      </div>
      <div class="rec">
        <div class="cam" id="cam">${st.video ? '' : html`<div class="off">רק קול</div>`}</div>
        <div class="panel stack">
          <p style="margin:0">ככה אתה נשמע מעל השיר. אחרי השליחה אף אחד לא שומע עד הפרמיירה.</p>
          ${quiet ? html`<p class="notice">ההקלטה יצאה שקטה מאוד. אולי המיקרופון רחוק, או שנבחר מיקרופון אחר.</p>` : ''}
          <div class="row"><button class="btn" id="listen">להקשיב</button><button class="btn ghost" id="hush">עצור</button><span class="muted small mono" id="tc">0:00</span></div>
          <div class="progress"><i id="up"></i></div>
          <div class="row" style="justify-content:space-between">
            <button class="btn ghost" id="again">עוד פעם</button>
            <button class="btn primary big" id="send">לשלוח</button>
          </div>
        </div>
      </div>
    `);
    let vid = null;
    if (st.video) {
      vid = document.createElement('video');
      vid.src = URL.createObjectURL(st.video); vid.muted = true; vid.playsInline = true;
      $('#cam', app).append(vid);
    }
    const tc = $('#tc', app);
    $('#listen', app).onclick = () => {
      stopSources();
      const at = ctx.currentTime + 0.1;
      const bed = ctx.createBufferSource(); bed.buffer = st.audio.bed;
      const bg = ctx.createGain(); bg.gain.value = 0.6; bed.connect(bg).connect(ctx.destination); bed.start(at);
      const b = new AudioBuffer({ length: st.take.length, numberOfChannels: 1, sampleRate: UPLOAD_RATE });
      b.copyToChannel(st.take, 0);
      const me = ctx.createBufferSource(); me.buffer = b;
      const mg = ctx.createGain(); mg.gain.value = 1.4; me.connect(mg).connect(ctx.destination); me.start(at);
      st.sources.push(bed, me);
      if (vid) { vid.currentTime = Math.max(0, -st.videoOffset); setTimeout(() => vid.play().catch(() => {}), Math.max(0, st.videoOffset) * 1000 + 100); }
      const tick = () => { if (!st.sources.length || st.dead) return; tc.textContent = fmtTime(ctx.currentTime - at); st.raf = requestAnimationFrame(tick); };
      tick();
    };
    $('#hush', app).onclick = () => { stopSources(); vid?.pause(); };
    $('#again', app).onclick = () => { stopSources(); vid?.pause(); st.take = null; st.video = null; setup(); };
    $('#send', app).onclick = send;
  }

  async function send() {
    stopSources();
    const btn = $('#send', app), bar = $('#up', app);
    btn.disabled = true; btn.textContent = 'שולח…';
    st.uploading = true;
    try {
      const wav = encodeWav(st.take, UPLOAD_RATE);
      const total = wav.size + (st.video?.size || 0);
      await upload(`/rooms/${code}/take/audio`, code, wav, p => { bar.style.width = `${(p * wav.size / total) * 100}%`; });
      if (st.video) await upload(`/rooms/${code}/take/video`, code, st.video, p => { bar.style.width = `${((wav.size + p * st.video.size) / total) * 100}%`; });
      await api(`/rooms/${code}/take/done`, { method: 'POST', code, body: { sampleRate: UPLOAD_RATE, video: !!st.video, videoType: st.videoType, videoOffset: st.videoOffset } });
      toast('בפנים. עכשיו מחכים לשאר.');
      exit();
    } catch (e) {
      st.uploading = false;
      toast(e.message, 4000); btn.disabled = false; btn.textContent = 'לנסות שוב';
    }
  }

  setup();
  return cleanup;
}
