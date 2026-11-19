import { $, html, mount, myRooms, toast } from './util.js';
import { BUILTIN } from './songs.js';
import { createScreen } from './screens/create.js';
import { roomScreen } from './screens/room.js';

// ---------- studio card ----------
function intro() {
  const word = $('#intro-word');
  const letters = [...'Geva'].map(c => [c, false]).concat([...'Dub'].map(c => [c, true]));
  word.innerHTML = letters.map(([c, soft], i) => `<span class="studio-letter${soft ? ' soft' : ''}" style="animation-delay:${120 + i * 42}ms">${c}</span>`).join('');
  const el = $('#intro');
  const end = () => {
    if (!document.documentElement.hasAttribute('data-intro')) return;
    el.classList.add('out');
    setTimeout(() => document.documentElement.removeAttribute('data-intro'), 450);
    removeEventListener('keydown', end);
  };
  el.addEventListener('click', end);
  addEventListener('keydown', end, { once: true });
  setTimeout(end, 1800);
}

// ---------- routing ----------
let cleanup = null;
export function go(path, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', path); else history.pushState(null, '', path);
  route();
}

function route() {
  cleanup?.(); cleanup = null;
  const app = $('#app');
  const p = location.pathname;
  window.scrollTo(0, 0);
  const m = p.match(/^\/r\/([A-Za-z0-9]{4,8})\/?$/);
  if (m) cleanup = roomScreen(app, m[1].toUpperCase());
  else if (p === '/new') cleanup = createScreen(app);
  else cleanup = home(app);
}

document.addEventListener('click', e => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  go(a.getAttribute('href'));
});
addEventListener('popstate', route);

// ---------- home ----------
const STATUS = { lobby: 'מתאספים', recording: 'מקליטים', ready: 'מוכן לפרמיירה', premiere: 'הייתה פרמיירה' };

function home(app) {
  const rooms = Object.entries(myRooms()).sort((a, b) => b[1].at - a[1].at).slice(0, 8);
  mount(app, html`
    <section class="hero">
      <p class="kicker"><b>GevaDub</b> · שיר אחד, כל החבר׳ה</p>
      <h1 class="display">כולם שרים.<br>אף אחד לא שומע.<br>עד ה<span class="underline">פרמיירה</span>.</h1>
      <p class="lede">בוחרים שיר, והאפליקציה מחלקת אותו: לכל אחד השורות שלו, ובפזמון כולם. כל אחד מקליט מהבית, ובסוף יוצא קליפ אחד עם המילים. רק בפרמיירה שומעים איך זה נשמע ביחד.</p>
      <div class="row">
        <a class="btn primary big" href="/new" data-link>דאב חדש</a>
        <form class="join-inline" id="join">
          <input type="text" name="code" placeholder="קוד חדר" maxlength="8" autocomplete="off" aria-label="קוד חדר" spellcheck="false">
          <button class="btn big" type="submit">הצטרפות</button>
        </form>
      </div>
    </section>

    <div class="how">
      <div><span class="n">01</span><p>פותחים חדר ושולחים קישור לקבוצה.</p></div>
      <div><span class="n">02</span><p>כל אחד שר "אההה" לבדיקת קול, וככה מקבל שורות שמתאימות לו.</p></div>
      <div><span class="n">03</span><p>מקליטים לבד, באוזניות. את השאר לא שומעים.</p></div>
      <div><span class="n">04</span><p>פרמיירה לכולם באותה שנייה, ואחר כך שומרים את הסרטון.</p></div>
    </div>

    <section class="section">
      <div class="section-head">
        <h2 class="display">השירים שלנו</h2>
        <span class="muted small">או שיר שלכם מהגלריה</span>
      </div>
      <div class="songs">
        ${BUILTIN.map(s => html`
          <a class="song" href="/new?song=${s.id}" data-link>
            <span class="t">${s.title}</span>
            <span class="d">${s.blurb}</span>
            <span class="meta mono">${s.meta}</span>
          </a>`)}
        <a class="song dashed" href="/new?song=gallery" data-link>
          <span class="t">מהגלריה</span>
          <span class="d">סרטון מטיקטוק או קובץ שמע שיש לך בטלפון. הוא לא עולה לשום מקום, הכל קורה אצלך.</span>
          <span class="meta mono">MP4 · MP3 · M4A · עד 3:00</span>
        </a>
      </div>
    </section>

    ${rooms.length ? html`
      <section class="section">
        <div class="section-head"><h2 class="display">החדרים שלך</h2></div>
        <ul class="rooms">
          ${rooms.map(([code, r]) => html`
            <li><a href="/r/${code}" data-link>
              <span class="code">${code}</span>
              <span>${r.title || 'דאב'}</span>
              <span class="st">${r.name}</span>
            </a></li>`)}
        </ul>
      </section>` : ''}
  `);

  $('#join', app).addEventListener('submit', e => {
    e.preventDefault();
    const code = new FormData(e.target).get('code').toString().trim().toUpperCase();
    if (!/^[A-Z0-9]{4,8}$/.test(code)) return toast('הקוד לא נראה נכון');
    go(`/r/${code}`);
  });
}

intro();
route();
