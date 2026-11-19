// GevaDub server. Plain Node, no dependencies.
// Rooms live in memory and are written to data/rooms.json; takes are files in data/takes.
// Songs uploaded from a gallery never reach this server: each member keeps the song on their own device.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 5180;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const TAKES = path.join(DATA, 'takes');
const ROOMS_FILE = path.join(DATA, 'rooms.json');
const MAX_MEMBERS = 8;
const MAX_UPLOAD = 60 * 1024 * 1024;

fs.mkdirSync(TAKES, { recursive: true });

let rooms = {};
try { rooms = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8')); } catch { rooms = {}; }

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(ROOMS_FILE, JSON.stringify(rooms), () => {});
  }, 200);
}

// Room codes avoid letters that look alike (0/O, 1/I/L).
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newCode() {
  let code;
  do {
    code = Array.from(crypto.randomBytes(5), b => CODE_CHARS[b % CODE_CHARS.length]).join('');
  } while (rooms[code]);
  return code;
}
const newId = () => crypto.randomBytes(6).toString('hex');
const newToken = () => crypto.randomBytes(18).toString('base64url');

// ---------- live updates (server-sent events) ----------
const listeners = new Map(); // code -> Set(res)

function notify(code) {
  const set = listeners.get(code);
  if (!set) return;
  for (const res of set) res.write(`data: ${Date.now()}\n\n`);
}

// ---------- room views ----------
function viewFor(room, member) {
  const reveal = room.status === 'ready' || room.status === 'premiere';
  return {
    code: room.code,
    createdAt: room.createdAt,
    hostId: room.hostId,
    song: room.song,
    split: room.split,
    status: room.status,
    parts: room.parts,
    premiere: room.premiere,
    members: room.members.map(m => ({
      id: m.id,
      name: m.name,
      range: m.range,
      recorded: !!m.take,
      hasVideo: !!(m.take && m.take.video),
      take: reveal || (member && member.id === m.id) ? m.take : null,
    })),
    chaos: {
      used: !!room.chaos.victimId,
      // Only the holder learns they hold it. Nobody learns the victim until every take is in.
      youHold: !!member && room.chaos.holderId === member.id,
      victimId: reveal ? room.chaos.victimId : null,
    },
    you: member ? { id: member.id, name: member.name } : null,
  };
}

function findMember(room, req) {
  const token = req.headers['x-geva-token'];
  if (!token) return null;
  return room.members.find(m => m.token === token) || null;
}

// ---------- helpers ----------
function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req, 512 * 1024);
  try { return JSON.parse(buf.toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('bad json'), { status: 400 }); }
}

const cleanName = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 24);

function cleanSong(song) {
  if (!song || typeof song !== 'object') return null;
  if (song.kind === 'builtin') {
    return {
      kind: 'builtin',
      id: String(song.id || '').slice(0, 40),
      forName: cleanName(song.forName),
    };
  }
  if (song.kind === 'upload') {
    const lines = Array.isArray(song.lines) ? song.lines.slice(0, 80).map(l => ({
      text: String(l.text || '').slice(0, 120),
      t0: Number(l.t0) || 0,
      t1: Number(l.t1) || 0,
      chorus: !!l.chorus,
      spoken: !!l.spoken,
      register: Number.isFinite(l.register) ? l.register : null,
    })) : [];
    return {
      kind: 'upload',
      title: String(song.title || '').slice(0, 60),
      duration: Math.min(Number(song.duration) || 0, 300),
      keepSinger: !!song.keepSinger,
      fingerprint: Array.isArray(song.fingerprint) ? song.fingerprint.slice(0, 400).map(Number) : [],
      lines,
    };
  }
  return null;
}

function takePath(code, memberId, kind) {
  const safe = s => String(s).replace(/[^a-zA-Z0-9]/g, '');
  return path.join(TAKES, `${safe(code)}-${safe(memberId)}.${kind === 'video' ? 'video' : 'wav'}`);
}

// ---------- api ----------
async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

  if (parts[1] === 'time') return send(res, 200, { now: Date.now() });

  if (parts[1] === 'rooms' && parts.length === 2 && req.method === 'POST') {
    const body = await readJson(req);
    const song = cleanSong(body.song);
    const name = cleanName(body.name);
    if (!song || !name) return send(res, 400, { error: 'חסר שם או שיר' });
    const code = newCode();
    const host = { id: newId(), token: newToken(), name, range: null, take: null };
    rooms[code] = {
      code,
      createdAt: Date.now(),
      hostId: host.id,
      song,
      split: body.split === 'random' ? 'random' : 'smart',
      status: 'lobby',
      parts: null,
      premiere: null,
      members: [host],
      chaos: { holderId: null, victimId: null },
    };
    save();
    return send(res, 200, { code, token: host.token, memberId: host.id });
  }

  if (parts[1] !== 'rooms' || !parts[2]) return send(res, 404, { error: 'לא נמצא' });

  const code = parts[2].toUpperCase();
  const room = rooms[code];
  if (!room) return send(res, 404, { error: 'אין חדר עם הקוד הזה' });
  const me = findMember(room, req);
  const action = parts[3];

  if (!action && req.method === 'GET') return send(res, 200, viewFor(room, me));

  if (action === 'events' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    if (!listeners.has(code)) listeners.set(code, new Set());
    listeners.get(code).add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); listeners.get(code)?.delete(res); });
    return;
  }

  if (action === 'join' && req.method === 'POST') {
    const body = await readJson(req);
    const name = cleanName(body.name);
    if (!name) return send(res, 400, { error: 'צריך שם' });
    if (room.status !== 'lobby') return send(res, 409, { error: 'החלוקה כבר נעשתה. בקשו מהמארגן חדר חדש.' });
    if (room.members.length >= MAX_MEMBERS) return send(res, 409, { error: `מקסימום ${MAX_MEMBERS} זמרים בחדר` });
    if (room.members.some(m => m.name === name)) return send(res, 409, { error: 'כבר יש מישהו עם השם הזה בחדר' });
    const m = { id: newId(), token: newToken(), name, range: null, take: null };
    room.members.push(m);
    save(); notify(code);
    return send(res, 200, { code, token: m.token, memberId: m.id });
  }

  if (!me) return send(res, 401, { error: 'אתה לא בחדר הזה' });

  if (action === 'range' && req.method === 'POST') {
    const body = await readJson(req);
    const median = Number(body.median);
    if (!Number.isFinite(median) || median < 50 || median > 1200) return send(res, 400, { error: 'לא שמענו קול' });
    me.range = { median: Math.round(median), low: Math.round(Number(body.low) || median), high: Math.round(Number(body.high) || median) };
    save(); notify(code);
    return send(res, 200, { ok: true });
  }

  if (action === 'lock' && req.method === 'POST') {
    if (me.id !== room.hostId) return send(res, 403, { error: 'רק מי שפתח את החדר מחלק' });
    if (room.status !== 'lobby') return send(res, 409, { error: 'כבר חולק' });
    const body = await readJson(req);
    const ids = new Set(room.members.map(m => m.id));
    const assigned = body.parts && typeof body.parts === 'object' ? body.parts : {};
    const clean = {};
    for (const [k, v] of Object.entries(assigned)) if (ids.has(v) || v === 'all') clean[Number(k)] = v;
    room.parts = clean;
    room.status = 'recording';
    // The dice goes to one member at random. The server picks, so the host can't rig it.
    if (room.members.length >= 2) {
      room.chaos.holderId = room.members[crypto.randomInt(room.members.length)].id;
    }
    save(); notify(code);
    return send(res, 200, { ok: true });
  }

  if (action === 'chaos' && req.method === 'POST') {
    if (room.chaos.holderId !== me.id) return send(res, 403, { error: 'הקובייה לא אצלך' });
    if (room.chaos.victimId) return send(res, 409, { error: 'הקובייה כבר הוטלה' });
    const others = room.members.filter(m => m.id !== me.id);
    if (!others.length) return send(res, 409, { error: 'אין על מי' });
    room.chaos.victimId = others[crypto.randomInt(others.length)].id;
    save(); notify(code);
    return send(res, 200, { ok: true });
  }

  if (action === 'take') {
    const kind = parts[4]; // audio | video | done
    const targetId = parts[5] || me.id;

    if (req.method === 'GET') {
      const target = room.members.find(m => m.id === targetId);
      const reveal = room.status === 'ready' || room.status === 'premiere';
      if (!target || !target.take) return send(res, 404, { error: 'אין הקלטה' });
      if (!reveal && target.id !== me.id) return send(res, 403, { error: 'סבלנות. עד הפרמיירה.' });
      const file = takePath(code, target.id, kind);
      if (!fs.existsSync(file)) return send(res, 404, { error: 'אין קובץ' });
      const type = kind === 'video' ? (target.take.videoType || 'video/webm') : 'audio/wav';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
      return;
    }

    if (req.method === 'POST') {
      if (room.status !== 'recording') return send(res, 409, { error: 'עכשיו לא מקליטים' });
      if (kind === 'audio' || kind === 'video') {
        const buf = await readBody(req, MAX_UPLOAD);
        fs.writeFileSync(takePath(code, me.id, kind), buf);
        return send(res, 200, { ok: true, bytes: buf.length });
      }
      if (kind === 'done') {
        const body = await readJson(req);
        if (!fs.existsSync(takePath(code, me.id, 'audio'))) return send(res, 400, { error: 'ההקלטה לא עלתה' });
        const hasVideo = !!body.video && fs.existsSync(takePath(code, me.id, 'video'));
        me.take = {
          at: Date.now(),
          sampleRate: Number(body.sampleRate) || 48000,
          video: hasVideo,
          videoType: hasVideo ? String(body.videoType || 'video/webm').slice(0, 60) : null,
          videoOffset: Number(body.videoOffset) || 0,
        };
        if (room.members.every(m => m.take)) room.status = 'ready';
        save(); notify(code);
        return send(res, 200, { ok: true, status: room.status });
      }
    }
  }

  if (action === 'premiere' && req.method === 'POST') {
    if (me.id !== room.hostId) return send(res, 403, { error: 'רק המארגן מתחיל את הפרמיירה' });
    if (room.status !== 'ready' && room.status !== 'premiere') return send(res, 409, { error: 'עוד לא כולם הקליטו' });
    // Everyone's screen starts together, a few seconds from now.
    room.premiere = { startAt: Date.now() + 6000, n: (room.premiere?.n || 0) + 1 };
    room.status = 'premiere';
    save(); notify(code);
    return send(res, 200, { ok: true, startAt: room.premiere.startAt });
  }

  return send(res, 404, { error: 'לא נמצא' });
}

// ---------- static ----------
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/' || p.startsWith('/r/') || p === '/new') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else serveStatic(req, res, url);
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'משהו נשבר בשרת' });
    if (!e.status) console.error(e);
  }
}).listen(PORT, () => console.log(`GevaDub on http://localhost:${PORT}`));
