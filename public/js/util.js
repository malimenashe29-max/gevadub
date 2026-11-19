// Small helpers shared by every screen.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Tagged template that escapes interpolated values. Use raw() to pass trusted markup through.
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
export const raw = s => ({ __raw: String(s) });
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => {
    if (Array.isArray(v)) out += v.map(x => (x && x.__raw !== undefined ? x.__raw : esc(x))).join('');
    else out += v && v.__raw !== undefined ? v.__raw : esc(v);
    out += strings[i + 1];
  });
  return raw(out);
}
export function mount(el, view) { el.innerHTML = view.__raw; return el; }

let toastTimer;
export function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const initial = name => (String(name || '?').trim()[0] || '?').toUpperCase();
export function fmtTime(s) {
  s = Math.max(0, s);
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

// ---------- identity per room (kept on this device) ----------
const KEY = 'gevadub:rooms';
export const myRooms = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
export function saveRoom(code, data) {
  const all = myRooms();
  all[code] = { ...all[code], ...data, at: Date.now() };
  localStorage.setItem(KEY, JSON.stringify(all));
}
export const roomAuth = code => myRooms()[code] || null;
export const lastName = () => localStorage.getItem('gevadub:name') || '';
export const setLastName = n => localStorage.setItem('gevadub:name', n);

// ---------- api ----------
export async function api(path, { method = 'GET', body, code, raw: rawBody, type } = {}) {
  const headers = {};
  const auth = code && roomAuth(code);
  if (auth) headers['x-geva-token'] = auth.token;
  let payload;
  if (rawBody !== undefined) { payload = rawBody; headers['Content-Type'] = type || 'application/octet-stream'; }
  else if (body !== undefined) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  const ct = res.headers.get('content-type') || '';
  if (!res.ok) {
    let msg = 'משהו השתבש';
    if (ct.includes('json')) { try { msg = (await res.json()).error || msg; } catch {} }
    throw Object.assign(new Error(msg), { status: res.status });
  }
  if (ct.includes('json')) return res.json();
  return res.arrayBuffer();
}

// Upload with progress, which fetch can't report.
export function upload(path, code, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${path}`);
    const auth = roomAuth(code);
    if (auth) xhr.setRequestHeader('x-geva-token', auth.token);
    xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
    xhr.upload.onprogress = e => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(safeErr(xhr.responseText))));
    xhr.onerror = () => reject(new Error('אין חיבור לשרת'));
    xhr.send(blob);
  });
}
const safeErr = t => { try { return JSON.parse(t).error; } catch { return 'ההעלאה נכשלה'; } };

// Server clock, so every screen starts the premiere on the same beat.
let clockOffset = 0;
export async function syncClock() {
  const samples = [];
  for (let i = 0; i < 4; i++) {
    const t0 = Date.now();
    const { now } = await api('/time');
    const t1 = Date.now();
    samples.push({ rtt: t1 - t0, off: now - (t0 + t1) / 2 });
  }
  samples.sort((a, b) => a.rtt - b.rtt);
  clockOffset = samples[0].off;
  return clockOffset;
}
export const serverNow = () => Date.now() + clockOffset;

// ---------- IndexedDB: imported songs stay on this device ----------
function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('gevadub', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('songs');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function putSong(key, value) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('songs', 'readwrite');
    tx.objectStore('songs').put(value, key);
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
}
export async function getSong(key) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = d.transaction('songs').objectStore('songs').get(key);
    req.onsuccess = () => resolve(req.result || null); req.onerror = () => reject(req.error);
  });
}
