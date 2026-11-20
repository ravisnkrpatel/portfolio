/**
 * Invoice Vault — backend (Google Apps Script)
 * ------------------------------------------------------------------
 * Runs inside YOUR Google account. It is the only thing that can touch
 * the private "Invoice Vault" folder in your Drive. The website never
 * sees your Google credentials; it only talks to this script.
 *
 * NOTHING SECRET IS STORED IN THIS FILE. Usernames, password hashes and
 * the token-signing key live in Script Properties (Project Settings →
 * Script Properties), which only you can see.
 *
 * Setup: see 2026-11-20-vault-setup-guide.md in the same folder.
 */

// ===== Settings =====================================================

/** Bill types. Key = code used in file names, value = Drive folder name. */
const CATEGORIES = {
  SALES: 'Sales',
  PURCHASE: 'Purchase',
  DELIVERY: 'Delivery Note',
  URD: 'URD Bill',
  EXPENSE: 'Expense',
  OTHER: 'Other',
};

const ROOT_NAME = 'Invoice Vault';
const INDEX_NAME = '_thumbnails';        // small previews, one JSON per category-month
const TOKEN_TTL_HOURS = 72;              // stay signed in for 3 days
const HASH_ROUNDS = 3000;                // password hashing work factor
const MIN_PASSWORD_LENGTH = 10;
const MAX_FAILS_PER_USER = 5;            // wrong passwords before lockout
const MAX_FAILS_GLOBAL = 20;             // across all usernames
const LOCKOUT_SECONDS = 15 * 60;
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_THUMB_BYTES = 200 * 1024;

// ===== One-time setup (run these from the editor) ===================

/** STEP A — creates the private Drive folder and the signing key. Safe to re-run. */
function SETUP_1_createVault() {
  const props = PropertiesService.getScriptProperties();
  let root = null;
  const id = props.getProperty('ROOT_ID');
  if (id) { try { root = DriveApp.getFolderById(id); } catch (e) { root = null; } }
  if (!root) {
    root = DriveApp.createFolder(ROOT_NAME);
    props.setProperty('ROOT_ID', root.getId());
  }
  Object.keys(CATEGORIES).forEach(function (k) { getOrCreateFolder_(root, CATEGORIES[k]); });
  getOrCreateFolder_(root, INDEX_NAME);
  if (!props.getProperty('SECRET')) props.setProperty('SECRET', newSecret_());
  Logger.log('Vault ready: ' + root.getUrl());
}

/**
 * STEP B — type the two usernames and passwords below, click Run,
 * then PUT THE PLACEHOLDERS BACK and save. Re-run any time to change a password
 * (that also signs that person out everywhere).
 */
function SETUP_2_setUsers() {
  const users = [
    ['USERNAME_1', 'PASSWORD_1'],
    ['USERNAME_2', 'PASSWORD_2'],
  ];

  const props = PropertiesService.getScriptProperties();
  const stored = JSON.parse(props.getProperty('USERS') || '{}');
  users.forEach(function (pair) {
    const u = normUser_(pair[0]);
    const p = String(pair[1]);
    if (/^USERNAME_|^PASSWORD_/.test(pair[0]) || /^PASSWORD_/.test(p)) {
      throw new Error('Replace the USERNAME_/PASSWORD_ placeholders first.');
    }
    if (!/^[a-z0-9._-]{3,32}$/.test(u)) throw new Error('Bad username: ' + pair[0]);
    if (p.length < MIN_PASSWORD_LENGTH) {
      throw new Error('Password for ' + u + ' must be at least ' + MIN_PASSWORD_LENGTH + ' characters.');
    }
    const salt = Utilities.base64Encode(Utilities.newBlob(Utilities.getUuid() + Utilities.getUuid()).getBytes());
    stored[u] = { salt: salt, hash: hashPassword_(p, salt) };
  });
  props.setProperty('USERS', JSON.stringify(stored));
  Logger.log('Saved users: ' + Object.keys(stored).join(', ') +
    '\n>>> NOW put USERNAME_1 / PASSWORD_1 placeholders back in this function and save. <<<');
}

/** Emergency: signs out every device immediately (e.g. a phone was lost). */
function RESET_signOutEveryone() {
  PropertiesService.getScriptProperties().setProperty('SECRET', newSecret_());
  Logger.log('All sessions revoked.');
}

/** Removes a user. Edit the name, run, done. */
function RESET_removeUser() {
  const username = 'USERNAME_TO_REMOVE';
  const props = PropertiesService.getScriptProperties();
  const stored = JSON.parse(props.getProperty('USERS') || '{}');
  delete stored[normUser_(username)];
  props.setProperty('USERS', JSON.stringify(stored));
  Logger.log('Users now: ' + Object.keys(stored).join(', '));
}

// ===== Web entry points =============================================

function doGet() {
  return ContentService.createTextOutput('Invoice Vault API is running.');
}

function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    out = route_(req);
  } catch (err) {
    if (err && err.isUserError) {
      out = { ok: false, error: err.message, code: err.code || 'ERROR' };
    } else {
      console.error(err && err.stack ? err.stack : err);
      out = { ok: false, error: 'Server error. Try again.', code: 'SERVER' };
    }
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function route_(req) {
  const action = String(req.action || '');
  if (action === 'login') return login_(req);
  const user = verifyToken_(req.token);
  switch (action) {
    case 'me':     return { ok: true, user: user, categories: CATEGORIES };
    case 'upload': return upload_(user, req);
    case 'list':   return list_(req);
    case 'thumbs': return thumbs_(req);
    case 'file':   return file_(req);
    case 'trash':  return trash_(user, req);
    default:       fail_('Unknown action');
  }
}

// ===== Auth =========================================================

function login_(req) {
  const u = normUser_(req.username);
  const p = String(req.password || '');
  const cache = CacheService.getScriptCache();
  const userKey = 'fail_' + Utilities.base64EncodeWebSafe(u).slice(0, 60);
  const userFails = Number(cache.get(userKey) || 0);
  const globalFails = Number(cache.get('fail__all') || 0);
  if (userFails >= MAX_FAILS_PER_USER || globalFails >= MAX_FAILS_GLOBAL) {
    fail_('Too many wrong attempts. Wait 15 minutes and try again.', 'LOCKED');
  }

  const users = getUsers_();
  const rec = users[u];
  // Always hash, even for unknown users, so response time doesn't reveal usernames.
  const hash = hashPassword_(p, rec ? rec.salt : 'AAAAAAAAAAAAAAAAAAAAAA==');
  if (!rec || !safeEqual_(hash, rec.hash)) {
    cache.put(userKey, String(userFails + 1), LOCKOUT_SECONDS);
    cache.put('fail__all', String(globalFails + 1), LOCKOUT_SECONDS);
    fail_('Wrong username or password.', 'BAD_LOGIN');
  }
  cache.remove(userKey);
  const exp = Date.now() + TOKEN_TTL_HOURS * 3600 * 1000;
  return { ok: true, token: makeToken_(u, rec.salt, exp), user: u, expires: exp, categories: CATEGORIES };
}

function makeToken_(u, salt, exp) {
  const payload = Utilities.base64EncodeWebSafe(JSON.stringify({ u: u, v: salt.slice(0, 8), exp: exp }));
  return payload + '.' + sign_(payload);
}

function verifyToken_(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !safeEqual_(sign_(parts[0]), parts[1])) fail_('Please sign in again.', 'AUTH');
  let payload;
  try {
    payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
  } catch (e) { fail_('Please sign in again.', 'AUTH'); }
  const rec = getUsers_()[payload.u];
  // Expired, user removed, or password changed since the token was issued.
  if (!rec || payload.exp < Date.now() || rec.salt.slice(0, 8) !== payload.v) fail_('Please sign in again.', 'AUTH');
  return payload.u;
}

function sign_(text) {
  const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (!secret) fail_('Vault not set up yet (run SETUP_1_createVault).', 'SETUP');
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(text, secret));
}

function hashPassword_(password, saltB64) {
  const salt = Utilities.base64Decode(saltB64);
  let h = Utilities.computeHmacSha256Signature(Utilities.newBlob(password).getBytes(), salt);
  for (let i = 1; i < HASH_ROUNDS; i++) h = Utilities.computeHmacSha256Signature(h, salt);
  return Utilities.base64Encode(h);
}

function getUsers_() {
  return JSON.parse(PropertiesService.getScriptProperties().getProperty('USERS') || '{}');
}

// ===== Files ========================================================

/** Saves a photo as <CAT>_<YYYY-MM-DD>_<NNN>.jpg in <Category>/<YYYY-MM>/, numbered per day. */
function upload_(user, req) {
  const cat = String(req.category || '');
  if (!CATEGORIES.hasOwnProperty(cat)) fail_('Pick a bill type.');
  const date = checkDate_(req.date);
  const mime = req.mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
  const ext = mime === 'image/png' ? '.png' : '.jpg';
  const bytes = Utilities.base64Decode(String(req.data || ''));
  if (!bytes.length) fail_('No photo received.');
  if (bytes.length > MAX_UPLOAD_BYTES) fail_('Photo is too large.');
  const note = String(req.note || '').slice(0, 200);

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) fail_('Busy, try again in a moment.');
  try {
    const root = getRoot_();
    const month = getOrCreateFolder_(getOrCreateFolder_(root, CATEGORIES[cat]), date.slice(0, 7));
    const prefix = cat + '_' + date + '_';
    let max = 0;
    const it = month.getFiles();
    while (it.hasNext()) {
      const n = it.next().getName();
      if (n.indexOf(prefix) === 0) {
        const s = parseInt(n.slice(prefix.length), 10);
        if (s > max) max = s;
      }
    }
    const seq = max + 1;
    const name = prefix + ('00' + seq).slice(-3) + ext;
    const file = month.createFile(Utilities.newBlob(bytes, mime, name));
    file.setDescription(JSON.stringify({ category: cat, date: date, seq: seq, by: user, note: note }));

    if (req.thumb) {
      const thumbBytes = Utilities.base64Decode(String(req.thumb));
      if (thumbBytes.length <= MAX_THUMB_BYTES) {
        updateIndex_(root, cat, date.slice(0, 7), function (idx) { idx[file.getId()] = String(req.thumb); });
      }
    }
    return { ok: true, file: describe_(file, cat) };
  } finally {
    lock.releaseLock();
  }
}

/** Lists files for one month (and optionally one category), oldest first. */
function list_(req) {
  const root = getRoot_();
  const month = req.month ? checkMonth_(req.month) : null;
  const only = req.category && CATEGORIES.hasOwnProperty(req.category) ? req.category : null;
  const files = [];
  const months = {};
  Object.keys(CATEGORIES).forEach(function (cat) {
    const catFolder = findFolder_(root, CATEGORIES[cat]);
    if (!catFolder) return;
    const subs = catFolder.getFolders();
    while (subs.hasNext()) {
      const m = subs.next();
      const mName = m.getName();
      if (!/^\d{4}-\d{2}$/.test(mName)) continue;
      months[mName] = true;
      if ((month && mName !== month) || (only && cat !== only)) continue;
      const it = m.getFiles();
      while (it.hasNext()) {
        const f = it.next();
        if (!f.isTrashed()) files.push(describe_(f, cat));
      }
    }
  });
  files.sort(function (a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 :
      a.category < b.category ? -1 : a.category > b.category ? 1 : a.seq - b.seq;
  });
  return { ok: true, files: files, months: Object.keys(months).sort().reverse() };
}

/** Returns preview images for the given file ids (grouped by category-month). */
function thumbs_(req) {
  const root = getRoot_();
  const groups = req.groups || {}; // { "SALES|2026-11": [id, id], ... }
  const out = {};
  Object.keys(groups).slice(0, 50).forEach(function (key) {
    const parts = key.split('|');
    if (!CATEGORIES.hasOwnProperty(parts[0]) || !/^\d{4}-\d{2}$/.test(parts[1] || '')) return;
    const idx = readIndex_(root, parts[0], parts[1]);
    (groups[key] || []).forEach(function (id) { if (idx[id]) out[id] = idx[id]; });
  });
  return { ok: true, thumbs: out };
}

/** Returns one full-size image. */
function file_(req) {
  const f = getVaultFile_(req.id);
  const blob = f.file.getBlob();
  return {
    ok: true,
    name: f.file.getName(),
    mimeType: blob.getContentType(),
    data: Utilities.base64Encode(blob.getBytes()),
    meta: describe_(f.file, f.cat),
  };
}

/** Moves a file to Drive's bin (recoverable there for 30 days). */
function trash_(user, req) {
  const f = getVaultFile_(req.id);
  const meta = describe_(f.file, f.cat);
  f.file.setTrashed(true);
  console.log(user + ' moved ' + meta.name + ' to bin');
  const lock = LockService.getScriptLock();
  if (lock.tryLock(30000)) {
    try {
      updateIndex_(getRoot_(), f.cat, meta.date.slice(0, 7), function (idx) { delete idx[req.id]; });
    } finally { lock.releaseLock(); }
  }
  return { ok: true };
}

// ===== Helpers ======================================================

function describe_(file, cat) {
  let meta = {};
  try { meta = JSON.parse(file.getDescription() || '{}'); } catch (e) { meta = {}; }
  const name = file.getName();
  const m = /_(\d{4}-\d{2}-\d{2})_(\d+)/.exec(name);
  return {
    id: file.getId(),
    name: name,
    category: cat,
    date: meta.date || (m ? m[1] : Utilities.formatDate(file.getDateCreated(), 'Asia/Kolkata', 'yyyy-MM-dd')),
    seq: meta.seq || (m ? parseInt(m[2], 10) : 0),
    by: meta.by || '',
    note: meta.note || '',
    size: file.getSize(),
    uploaded: file.getDateCreated().getTime(),
  };
}

/** Loads a file by id and confirms it lives in Invoice Vault/<Category>/<YYYY-MM>/. */
function getVaultFile_(id) {
  let file;
  try { file = DriveApp.getFileById(String(id || '')); } catch (e) { fail_('File not found.'); }
  if (file.isTrashed()) fail_('File not found.');
  const rootId = getRoot_().getId();
  const months = file.getParents();
  while (months.hasNext()) {
    const month = months.next();
    const cats = month.getParents();
    while (cats.hasNext()) {
      const catFolder = cats.next();
      const roots = catFolder.getParents();
      while (roots.hasNext()) {
        if (roots.next().getId() === rootId) {
          const cat = Object.keys(CATEGORIES).filter(function (k) { return CATEGORIES[k] === catFolder.getName(); })[0];
          if (cat) return { file: file, cat: cat };
        }
      }
    }
  }
  fail_('File not found.');
}

function getRoot_() {
  const id = PropertiesService.getScriptProperties().getProperty('ROOT_ID');
  if (!id) fail_('Vault not set up yet (run SETUP_1_createVault).', 'SETUP');
  return DriveApp.getFolderById(id);
}

function findFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : null;
}

function getOrCreateFolder_(parent, name) {
  return findFolder_(parent, name) || parent.createFolder(name);
}

function indexFileName_(cat, month) { return cat + '_' + month + '.json'; }

function readIndex_(root, cat, month) {
  const folder = findFolder_(root, INDEX_NAME);
  if (!folder) return {};
  const it = folder.getFilesByName(indexFileName_(cat, month));
  if (!it.hasNext()) return {};
  try { return JSON.parse(it.next().getBlob().getDataAsString()); } catch (e) { return {}; }
}

/** Caller must hold the script lock. */
function updateIndex_(root, cat, month, mutate) {
  const folder = getOrCreateFolder_(root, INDEX_NAME);
  const name = indexFileName_(cat, month);
  const it = folder.getFilesByName(name);
  const existing = it.hasNext() ? it.next() : null;
  let idx = {};
  if (existing) { try { idx = JSON.parse(existing.getBlob().getDataAsString()); } catch (e) { idx = {}; } }
  mutate(idx);
  const body = JSON.stringify(idx);
  if (existing) existing.setContent(body);
  else folder.createFile(name, body, 'application/json');
}

function checkDate_(d) {
  const s = String(d || '');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) fail_('Bad date.');
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (dt.getUTCMonth() !== +m[2] - 1 || dt.getUTCDate() !== +m[3] || +m[1] < 2000 || +m[1] > 2100) fail_('Bad date.');
  return s;
}

function checkMonth_(mo) {
  const s = String(mo || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) fail_('Bad month.');
  return s;
}

function normUser_(u) { return String(u || '').trim().toLowerCase(); }

function newSecret_() { return Utilities.getUuid() + Utilities.getUuid(); }

function safeEqual_(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  return diff === 0;
}

function fail_(message, code) {
  const err = new Error(message);
  err.isUserError = true;
  err.code = code || 'ERROR';
  throw err;
}
