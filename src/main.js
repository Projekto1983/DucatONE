'use strict';
const { app, BaseWindow, BrowserWindow, WebContentsView, protocol, ipcMain, dialog, Menu, shell, net } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');
const { openLang, availableLangs, dropLang } = require('./lib/db');
const { storeFor, dropStore } = require('./lib/store');
const pages = require('./lib/pages');

const WEB = path.join(__dirname, 'web');
const ICON = path.join(__dirname, process.platform === 'win32' ? 'build_icon.ico' : 'build_icon.png');
const TOOLBAR_H = 26;
const FOOTER_H = 24;
const VERSION = require('./lib/version');
const LOG = require('./lib/log');
const REPORT_EMAIL = 'tecnologo83@gmail.com';
// versione portatile: se accanto al programma c'è portable.txt, dati e impostazioni restano nella stessa cartella (es. chiavetta USB)
const PORTABLE = (() => { try { return app.isPackaged && fs.existsSync(path.join(path.dirname(process.execPath), 'portable.txt')); } catch (_) { return false; } })();
const PORTABLE_DIR = PORTABLE ? path.join(path.dirname(process.execPath), 'DucatONE-dati') : null;
if (PORTABLE) { try { fs.mkdirSync(PORTABLE_DIR, { recursive: true }); app.setPath('userData', path.join(PORTABLE_DIR, 'impostazioni')); } catch (_) {} }
const IS_LINUX = process.platform === 'linux';
const LOCAL_DIR = PORTABLE ? PORTABLE_DIR : process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'DucatONE')
  : IS_LINUX ? path.join(process.env.XDG_DATA_HOME || path.join(require('os').homedir(), '.local', 'share'), 'DucatONE') : null;
// Linux (AppImage): i dati inclusi sono in sola lettura; vengono copiati una volta nella cartella locale
function movePak(src, dst) {
  if (IS_LINUX) {
    try { if (fs.statSync(dst).size === fs.statSync(src).size) return false; } catch (_) {}
    const tmp = dst + '.copy';
    fs.copyFileSync(src, tmp);
    fs.renameSync(tmp, dst);
    return true;
  }
  try { if (fs.existsSync(dst)) fs.unlinkSync(dst); } catch (_) {}
  try { fs.renameSync(src, dst); } catch (_) { fs.copyFileSync(src, dst); try { fs.unlinkSync(src); } catch (_) {} }
  return true;
}
let currentDbSync = null;

protocol.registerSchemesAsPrivileged([
  { scheme: 'elearn', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// ------------------------------------------------------------ impostazioni / cartella dati
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = {};
function loadSettings() {
  try {
    settings = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch (_) {
    settings = {};
  }
}
function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch (_) {}
}

function appBaseDir() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  return app.isPackaged ? path.dirname(process.execPath) : __dirname;
}
const isDataDir = (d) => d && availableLangs(d).length > 0;

function localDataDir() {
  return path.join(LOCAL_DIR || app.getPath('userData'), 'data');
}
// I dati del CD vengono tenuti fuori dalla cartella del programma: così gli aggiornamenti
// installano solo il programma (pochi MB) senza toccare i dati.
function migrateBundledData() {
  const src = path.join(process.resourcesPath || '', 'data', 'data.pak');
  if (PORTABLE || !app.isPackaged || !fs.existsSync(src)) return;
  const dstDir = localDataDir();
  const dst = path.join(dstDir, 'data.pak');
  try {
    fs.mkdirSync(dstDir, { recursive: true });
    if (movePak(src, dst)) LOG.info('dati spostati in', dst);
  } catch (e) {
    LOG.error('spostamento dati non riuscito:', e.message);
  }
}
function migrateD86() {
  const src = path.join(process.resourcesPath || '', 'data', 'ducato86.pak');
  if (PORTABLE || !app.isPackaged || !fs.existsSync(src)) return;
  const dst = path.join(localDataDir(), 'ducato86.pak');
  try {
    fs.mkdirSync(localDataDir(), { recursive: true });
    if (movePak(src, dst)) LOG.info('Ducato 1986 spostato in', dst);
  } catch (e) { LOG.error('spostamento ducato86.pak non riuscito:', e.message); }
}
// ------------------------------------------------------------ Nuovo Ducato X250 (pacchetto aggiuntivo, stesso formato del CD 244)
const X250_URL = process.env.ELEARN_X250_URL || 'https://github.com/Projekto1983/DucatONE/releases/latest/download/x250.pak';
const is250 = (id) => Math.floor((+id || 0) / 1e6) === 250;
function x250File() {
  const c = [process.env.ELEARN_X250, path.join(localDataDir(), 'x250.pak'), path.join(process.resourcesPath || '', 'data', 'x250.pak'), path.join(appBaseDir(), 'data', 'x250.pak'), path.join(app.getPath('userData'), 'data', 'x250.pak')];
  return c.find((f) => { try { return f && fs.statSync(f).size > 1e6; } catch (_) { return false; } }) || null;
}
function migrateX250() {
  const src = path.join(process.resourcesPath || '', 'data', 'x250.pak');
  if (PORTABLE || !app.isPackaged || !fs.existsSync(src)) return;
  const dst = path.join(localDataDir(), 'x250.pak');
  try {
    fs.mkdirSync(localDataDir(), { recursive: true });
    if (movePak(src, dst)) LOG.info('Ducato X250 spostato in', dst);
  } catch (e) { LOG.error('spostamento x250.pak non riuscito:', e.message); }
}
async function x250Db(lang) {
  const f = x250File();
  if (!f) return null;
  try { return (await openLang(f, lang)) || (await openLang(f, availableLangs(f)[0])); } catch (e) { LOG.error('x250.pak non leggibile:', e.message); return null; }
}
const x250dl = { running: false, got: 0, total: 0, error: null, done: false };
async function x250Download() {
  if (x250dl.running) return;
  Object.assign(x250dl, { running: true, got: 0, total: 0, error: null, done: false });
  const dst = path.join(localDataDir(), 'x250.pak'), tmp = dst + '.part';
  try {
    fs.mkdirSync(localDataDir(), { recursive: true });
    const r = await net.fetch(X250_URL, { headers: { 'User-Agent': 'DucatONE' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    x250dl.total = +r.headers.get('content-length') || 0;
    const out = fs.createWriteStream(tmp);
    const rd = r.body.getReader();
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      x250dl.got += value.length;
      if (!out.write(Buffer.from(value))) await new Promise((res) => out.once('drain', res));
    }
    await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
    const v = await D86.verify(tmp);
    if (!v.entries || v.bad) throw new Error('file danneggiato, riprova');
    const old = x250File();
    if (old) { dropLang(old); dropStore(old); }
    try { fs.unlinkSync(dst); } catch (_) {}
    fs.renameSync(tmp, dst);
    x250dl.done = true;
    LOG.info('Ducato X250 scaricato', x250dl.got, 'byte');
  } catch (e) {
    x250dl.error = String(e.message || e);
    LOG.error('download Ducato X250:', x250dl.error);
    try { fs.unlinkSync(tmp); } catch (_) {}
  } finally { x250dl.running = false; }
}
function storeAny(file) { // immagini e file del CD: prima 244, poi X250
  const a = storeFor(dataDir);
  if (a && a.exists(file)) return a;
  const f = x250File();
  return f ? storeFor(f) : a;
}

// ------------------------------------------------------------ Ducato gamma 1986 (pacchetto aggiuntivo)
const D86 = require('./lib/d86');
const UEM = require('./lib/uem');
const D86_URL = process.env.ELEARN_D86_URL || 'https://github.com/Projekto1983/DucatONE/releases/latest/download/ducato86.pak';
function d86File() {
  const c = [process.env.ELEARN_D86, path.join(localDataDir(), 'ducato86.pak'), path.join(process.resourcesPath || '', 'data', 'ducato86.pak'), path.join(appBaseDir(), 'data', 'ducato86.pak'), path.join(app.getPath('userData'), 'data', 'ducato86.pak')];
  return c.find((f) => { try { return f && fs.statSync(f).size > 1e6; } catch (_) { return false; } }) || null;
}
function d86() { const f = d86File(); if (!f) return null; try { return D86.open(f); } catch (e) { LOG.error('ducato86.pak non leggibile:', e.message); return null; } }
let d86old = false;
const D86_MIN = 3; // versione minima del pacchetto (indice) richiesta da questa versione del programma
const d86dl = { running: false, got: 0, total: 0, error: null, done: false };
async function d86Download() {
  if (d86dl.running) return;
  Object.assign(d86dl, { running: true, got: 0, total: 0, error: null, done: false });
  const dst = path.join(localDataDir(), 'ducato86.pak'), tmp = dst + '.part';
  try {
    fs.mkdirSync(localDataDir(), { recursive: true });
    const r = await net.fetch(D86_URL, { headers: { 'User-Agent': 'DucatONE' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    d86dl.total = +r.headers.get('content-length') || 0;
    const out = fs.createWriteStream(tmp);
    const rd = r.body.getReader();
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      d86dl.got += value.length;
      if (!out.write(Buffer.from(value))) await new Promise((res) => out.once('drain', res));
    }
    await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
    const v = await D86.verify(tmp);
    if (!v.entries || v.bad) throw new Error('file danneggiato, riprova');
    D86.close();
    try { fs.unlinkSync(dst); } catch (_) {}
    fs.renameSync(tmp, dst);
    d86dl.done = true;
    LOG.info('Ducato 1986 scaricato', d86dl.got, 'byte');
  } catch (e) {
    d86dl.error = String(e.message || e);
    LOG.error('download Ducato 1986:', d86dl.error);
    try { fs.unlinkSync(tmp); } catch (_) {}
  } finally { d86dl.running = false; }
}
async function handleD86(p, q, req) {
  const s86 = (settings.d86 = settings.d86 || { eng: '', favs: [], hist: [] });
  if (p === 'd86get') {
    if (q.get('start')) { d86Download(); return new Response('ok'); }
    return new Response(JSON.stringify(d86dl), { headers: { 'content-type': 'application/json' } });
  }
  const d = d86();
  if (!d) return p === 'd86get.html' ? html(D86.getPage(d86dl)) : redirect('d86get.html');
  // pacchetto vecchio: proponi l'aggiornamento una volta per sessione
  if (p === 'd86skip') { d86old = true; return redirect('d86main.html?p=1'); }
  const old = (d.idx.v || 1) < D86_MIN;
  if (p === 'd86get.html') return old && !d86dl.done ? html(D86.getPage(d86dl, true)) : redirect('d86main.html?p=1');
  if (old && !d86old && p === 'd86main.html') return redirect('d86get.html');
  const pg = Math.min(d.count, Math.max(1, +q.get('p') || 1));
  const db = await curDb();
  switch (p) {
    case 'd86img': {
      const b = D86.img(d, pg, q.get('t') === '1');
      return b ? new Response(b, { headers: { 'content-type': b[0] === 0x89 ? 'image/png' : 'image/jpeg', 'cache-control': 'max-age=86400' } }) : notFound();
    }
    case 'd86main.html': {
      s86.hist = [pg, ...(s86.hist || []).filter((x) => x !== pg)].slice(0, 40);
      settings.lastModel = 'd86';
      saveSettings();
      const hl = q.get('hl'), sq = q.get('s');
      return html(D86.mainPage(db, st, d, pg, { eng: s86.eng, favs: s86.favs || [], frame: sq ? `d86search.html?q=${encodeURIComponent(sq)}` : hl ? `d86page.html?p=${pg}&hl=${encodeURIComponent(hl)}` : '', other: 'selmodel?model=' + ((db.models[0] || {}).ID || '') }));
    }
    case 'd86page.html':
      st.notes = settings.notes || {};
      return html(D86.pagePage(db, st, d, pg, { photos: userPhotos(D86.BASE + pg), hl: q.get('hl') || '' }));
    case 'd86set':
      s86.eng = /^(b|d19|d25|crd)$/.test(q.get('eng') || '') ? q.get('eng') : '';
      saveSettings();
      return redirect('d86main.html?p=' + pg);
    case 'd86fav': {
      const f = (s86.favs = s86.favs || []);
      const i = f.indexOf(pg);
      if (i >= 0) f.splice(i, 1); else f.push(pg);
      saveSettings();
      return redirect('d86main.html?p=' + pg);
    }
    case 'd86favs.html':
      return html(D86.listPage(db, st, d, '♥ Preferiti — Ducato 1986', s86.favs || [], 'Nessuna pagina nei preferiti: usa «☆ Aggiungi ai preferiti» nella colonna a sinistra.'));
    case 'd86hist.html':
      return html(D86.listPage(db, st, d, '🕘 Cronologia — Ducato 1986', s86.hist || [], 'Nessuna pagina consultata.'));
    case 'd86index.html':
      return html(D86.indexPage(db, st, d, s86.eng));
    case 'd86quick.html':
      return html(D86.quickPage(db, st, d));
    case 'd86tools.html':
      return html(D86.toolsPage(db, st, d));
    case 'd86search.html':
      return html(D86.searchPage(db, st, d, q.get('q') || ''));
  }
  return notFound();
}
function resolveDataDir() {
  const cands = [process.env.ELEARN_DATA, localDataDir(), path.join(process.resourcesPath || '', 'data'), settings.dataDir, path.join(appBaseDir(), 'data'), path.join(app.getPath('userData'), 'data')];
  return cands.find(isDataDir) || null;
}
let dataDir = null;

function writableDir(d) {
  try {
    fs.mkdirSync(d, { recursive: true });
    const t = path.join(d, '.wtest');
    fs.writeFileSync(t, '1');
    fs.unlinkSync(t);
    return true;
  } catch (_) {
    return false;
  }
}

// ------------------------------------------------------------ stato di navigazione (come le variabili globali di eLearn.exe)
const st = { lang: 1, mark: 1, model: 0, val: 0, prod: 0 };
async function curDb() {
  const dir = is250(st.model) && x250File() ? x250File() : dataDir;
  let db = await openLang(dir, st.lang);
  if (!db) {
    const l = availableLangs(dir)[0];
    if (dir === dataDir) st.lang = l;
    db = await openLang(dir, l);
  }
  if (!db.models.find((m) => m.ID === st.model)) st.model = (db.models.find((m) => m.MARK_ID === st.mark) || db.models[0] || {}).ID;
  if (!db.validities.find((v) => v.ID === st.val)) st.val = (db.validities[0] || {}).ID;
  const prods = db.productionsFor(st.val);
  if (!prods.find((p) => p.ID === st.prod)) st.prod = (prods[0] || {}).ID;
  currentDbSync = db;
  if (!db._indexing) { db._indexing = true; setTimeout(() => { try { db.buildIndex(); } catch (_) {} }, 1500); }
  return db;
}

// ------------------------------------------------------------ immagini (.image = JPEG oppure SVG compresso gzip)
function fixSvg(buf) {
  let s = buf.toString(/encoding="(iso-8859-1|windows-1252)"/i.test(buf.subarray(0, 200).toString('latin1')) ? 'latin1' : 'utf8');
  const ents = {};
  const dt = /<!DOCTYPE[\s\S]*?(\[[\s\S]*?\])?\s*>/i.exec(s);
  if (dt) {
    for (const m of (dt[1] || '').matchAll(/<!ENTITY\s+([\w.-]+)\s+(["'])([\s\S]*?)\2\s*>/g)) ents[m[1]] = m[3];
    s = s.slice(0, dt.index) + s.slice(dt.index + dt[0].length);
  }
  const XML_ENT = { amp: 1, lt: 1, gt: 1, quot: 1, apos: 1 };
  const ADOBE_NS = { ns_graphs: 'http://ns.adobe.com/Graphs/1.0/', ns_vars: 'http://ns.adobe.com/Variables/1.0/', ns_imrep: 'http://ns.adobe.com/ImageReplacement/1.0/', ns_sfw: 'http://ns.adobe.com/SaveForWeb/1.0/', ns_custom: 'http://ns.adobe.com/GenericCustomNamespace/1.0/', ns_adobe_xpath: 'http://ns.adobe.com/XPath/1.0/', ns_flows: 'http://ns.adobe.com/Flows/1.0/', ns_extend: 'http://ns.adobe.com/Extensibility/1.0/', ns_ai: 'http://ns.adobe.com/AdobeIllustrator/10.0/', ns_svg: 'http://www.w3.org/2000/svg', ns_xlink: 'http://www.w3.org/1999/xlink' };
  s = s.replace(/&([A-Za-z_][\w.-]*);/g, (a, n) => (n in ents ? ents[n] : XML_ENT[n] ? a : n in ADOBE_NS ? ADOBE_NS[n] : 'urn:x-undefined:' + n));
  s = s.replace(/<\?xml[^>]*\?>/, '<?xml version="1.0" encoding="utf-8"?>');
  s = s.replace(/font-family:\s*'Arial Narrow'/g, "font-family:'Arial Narrow',Arial,Helvetica,sans-serif");
  s = s.replace(/<svg\b([^>]*)>/, (all, attrs) => {
    let a = attrs;
    if (!/\sxmlns=/.test(a)) a += ' xmlns="http://www.w3.org/2000/svg"';
    if (!/xmlns:xlink=/.test(a)) a += ' xmlns:xlink="http://www.w3.org/1999/xlink"';
    const w = /\swidth="([\d.]+)/.exec(a), h = /\sheight="([\d.]+)/.exec(a);
    if (!/viewBox=/.test(a) && w && h) a += ` viewBox="0 0 ${w[1]} ${h[1]}"`;
    a = a.replace(/\swidth="[^"]*"/, ' width="100%"').replace(/\sheight="[^"]*"/, ' height="100%"');
    return `<svg${a}>`;
  });
  return Buffer.from(s, 'utf8');
}

const imgCache = new Map();
async function serveImage(file) {
  if (imgCache.has(file)) return imgCache.get(file);
  let buf = storeAny(file).read(file);
  if (!buf) return null;
  let type = 'image/jpeg';
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    buf = fixSvg(zlib.gunzipSync(buf));
    type = 'image/svg+xml';
  } else if (buf.subarray(0, 4).toString() === 'GIF8') type = 'image/gif';
  else if (buf[0] === 0x89 && buf[1] === 0x50) type = 'image/png';
  else if (/^\s*<(\?xml|svg)/.test(buf.subarray(0, 100).toString('latin1'))) {
    buf = fixSvg(buf);
    type = 'image/svg+xml';
  }
  const r = { buf, type };
  if (imgCache.size > 300) imgCache.delete(imgCache.keys().next().value);
  imgCache.set(file, r);
  return r;
}

// percorso case-insensitive dentro una cartella
function ciJoin(base, rel) {
  let cur = base;
  for (const part of rel.split(/[\\/]+/).filter(Boolean)) {
    if (part === '..') return null;
    const p = path.join(cur, part);
    if (fs.existsSync(p)) {
      cur = p;
      continue;
    }
    let hit = null;
    try {
      hit = fs.readdirSync(cur).find((n) => n.toLowerCase() === part.toLowerCase());
    } catch (_) {}
    if (!hit) return null;
    cur = path.join(cur, hit);
  }
  return cur;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.json': 'application/json', '.ico': 'image/x-icon',
};
const html = (s) => new Response(s, { headers: { 'content-type': 'text/html; charset=utf-8' } });
const redirect = (u) => new Response(null, { status: 302, headers: { location: /^[a-z]+:/i.test(u) ? u : 'elearn://app/' + u } });
const notFound = () => new Response('Not found', { status: 404 });

async function serveFile(file) {
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return notFound();
  const ext = path.extname(file).toLowerCase();
  let body = await fsp.readFile(file);
  let type = MIME[ext] || 'application/octet-stream';
  if (ext === '.css') {
    body = /[\\/]app[\\/][^\\/]+\.css$/.test(file) ? body.toString('utf8') : body.toString('latin1'); // i css originali sono in windows-1252
    type = 'text/css; charset=utf-8';
  }
  return new Response(body, { headers: { 'content-type': type } });
}

async function handle(req) {
  const u = new URL(req.url);
  let p = decodeURIComponent(u.pathname).replace(/^\/+/, '');
  let host = u.host;
  if (host === 'app' && /^data\//i.test(p)) {
    host = 'data';
    p = p.slice(5);
  }
  const q = u.searchParams;

  if (host === 'data') {
    if (!dataDir) return notFound();
    const m = /^images?[\\/](.+)$/i.exec(p);
    if (m) {
      const r = await serveImage('Image/' + m[1]);
      if (!r) return notFound();
      return new Response(r.buf, { headers: { 'content-type': r.type } });
    }
    const hm = /^system\/help\/help_(\d+)\//i.exec(p);
    if (hm && /\.html?$/i.test(p)) {
      const b = storeFor(dataDir).read(p);
      if (!b) return notFound();
      const db = await curDb();
      const l = db.languages.find((x) => x.ID === +hm[1]);
      const cs = /charset=/i.test(b.subarray(0, 2000).toString('latin1')) ? '' : '; charset=' + ((l && l.SET_CODE) || 'windows-1252');
      return new Response(b, { headers: { 'content-type': 'text/html' + cs } });
    }
    const b = storeAny(p).read(p);
    if (!b) return notFound();
    return new Response(b, { headers: { 'content-type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' } });
  }

  // host "app": pagine generate + risorse web originali
  if (/^d86/.test(p) && dataDir) return handleD86(p, q, req);
  if (!dataDir && !/^(app\/|css\/|images\/)/.test(p)) return redirect('elearn://app/app/setup.html');
  { // pagina di un altro modello (cronologia, preferiti, schede): passa al modello giusto
    const nd = +q.get('node');
    if (nd && p !== 'selmodel' && /^\d{9}$/.test(String(nd)) && is250(nd) !== is250(st.model)) {
      if (is250(nd) && !x250File()) return redirect('x250get.html');
      st.model = is250(nd) ? 250000000 : 244000000; st.val = 0; st.prod = 0;
    }
  }
  switch (p) {
    case '':
    case 'home.html':
      st.mark = 1;
      return redirect('models.html');
    case 'models.html':
      st.recent = (settings.history || []).slice(0, 5);
      st.user = settings.user || {};
      st.favs = settings.favs || [];
      st.d86 = !!d86File();
      st.x250 = !!x250File(); {
      st.mark = 1; // unica marca con dati: Fiat (Ducato = Peugeot Boxer = Citroën Jumper)
      if (is250(st.model)) st.model = 244000000;
      const db = await curDb();
      st.dbs = [db, await x250Db(st.lang)].filter(Boolean);
      return html(pages.modelsPage(db, st, availableLangs(dataDir)));
    }
    case 'setlang': {
      st.lang = +q.get('lang') || 1;
      settings.lang = st.lang;
      settings.last = null;
      saveSettings();
      await curDb();
      setTimeout(() => { try { toolbar.webContents.reload(); footer.webContents.reload(); } catch (_) {} }, 300);
      return redirect('models.html');
    }
    case 'x250get':
      if (q.get('start')) { x250Download(); return new Response('ok'); }
      return new Response(JSON.stringify(x250dl), { headers: { 'content-type': 'application/json' } });
    case 'x250get.html':
      if (x250File() && !q.get('upd')) return redirect('selmodel?model=250000000');
      return html(pages.x250GetPage(x250dl));
    case 'selmodel': {
      if (is250(q.get('model')) && !x250File()) return redirect('x250get.html');
      if (is250(q.get('model')) !== is250(st.model)) { st.val = 0; st.prod = 0; }
      st.model = +q.get('model');
      const db = await curDb();
      const sec = db.sections[0];
      return redirect('main.html?node=' + (+q.get('node') || (sec ? sec.ROOT_ELEM_ID : '')) + (q.get('open') ? '&open=' + encodeURIComponent(q.get('open')) : ''));
    }
    case 'split.html':
      return html(pages.splitPage(q.get('l') || '', q.get('r') || ''));
    case 'setval':
    case 'setprod': {
      if (q.get('val')) { const v = +q.get('val'); if (is250(v) !== is250(st.model)) { if (is250(v) && !x250File()) return redirect('x250get.html'); st.model = is250(v) ? 250000000 : 244000000; } st.val = v; }
      if (q.get('prod')) st.prod = +q.get('prod');
      await curDb();
      return redirect('main.html?node=' + (q.get('node') || ''));
    }
    case 'main.html': {
      const db = await curDb();
      let node = +q.get('node') || (db.sections[0] || {}).ROOT_ELEM_ID;
      const r = pages.resolveNode(db, st, node);
      if (r !== node) return redirect(`main.html?node=${r}${q.get('from') ? '&from=' + q.get('from') : ''}`);
      settings.last = { lang: st.lang, mark: st.mark, model: st.model, val: st.val, prod: st.prod, node };
      settings.history = [node, ...(settings.history || []).filter((x) => x !== node)].slice(0, 30);
      saveSettings();
      st.notes = settings.notes || {};
      st.newCounts = newCounts();
      st.openFrame = /^(garage|quick|tools|ricambi|video|guida)\.html$/.test(q.get('open') || '') ? q.get('open') : '';
      return html(pages.mainPage(db, st, node, +q.get('from') || 0));
    }
    case 'note': {
      const id = +q.get('node');
      if (req.method === 'POST' && id) {
        const text = (await req.text()).slice(0, 5000);
        settings.notes = settings.notes || {};
        if (text.trim()) settings.notes[id] = { text, date: new Date().toISOString() };
        else delete settings.notes[id];
        saveSettings();
      }
      return new Response('ok');
    }
    case 'history.html':
      return html(pages.historyPage(await curDb(), st, settings.history || []));
    case 'tree': {
      const db = await curDb();
      return html(pages.treeHtml(db, st, +q.get('node'), +q.get('cur') || 0));
    }
    case 'favtoggle': {
      const id = +q.get('node');
      const f = (settings.favs = settings.favs || []);
      const i = f.indexOf(id);
      if (i >= 0) f.splice(i, 1);
      else if (id) f.push(id);
      st.favs = f;
      saveSettings();
      return redirect('main.html?node=' + id);
    }
    case 'favdel': {
      settings.favs = (settings.favs || []).filter((x) => x !== +q.get('node'));
      st.favs = settings.favs;
      saveSettings();
      return redirect('favorites.html');
    }
    case 'video.html': {
      const data = await require('./lib/video').load((u, o) => net.fetch(u, o), app.getPath('userData'), settings.videoUrl);
      markSeen('seenVid', data.items.map((x) => x.id));
      st.mezzo = q.get('m') === '86' ? '86' : q.get('m') === '250' || (!q.get('m') && is250(st.model)) ? '250' : '';
      return html(pages.videoPage(await curDb(), st, { ...data, items: forMezzo(data.items, st.mezzo) }));
    }
    case 'ricambi.html': {

      const data = await require('./lib/ricambi').load((u, o) => net.fetch(u, o), app.getPath('userData'), settings.ricambiUrl);
      markSeen('seenRic', data.items.map((x) => x.link || x.name));
      st.mezzo = q.get('m') === '86' ? '86' : q.get('m') === '250' || (!q.get('m') && is250(st.model)) ? '250' : '';
      return html(pages.ricambiPage(await curDb(), st, { ...data, items: forMezzo(data.items, st.mezzo) }));
    }
    case 'garage.html':
      st.user = settings.user || {};
      { const db0 = await curDb(); st.dbs = [await openLang(dataDir, st.lang) || db0, await x250Db(st.lang)].filter(Boolean); return html(pages.garagePage(db0, st)); }
    case 'chapter.html':
      return html(pages.chapterPage(await curDb(), st, +q.get('node')));
    case 'userfoto': {
      const rel = decodeURIComponent(q.get('f') || '');
      if (!/^\d+\/[\w.-]+$/.test(rel)) return new Response('', { status: 404 });
      const fp = path.join(app.getPath('userData'), 'foto', rel);
      if (!fs.existsSync(fp)) return new Response('', { status: 404 });
      const ext = path.extname(fp).toLowerCase();
      return new Response(fs.readFileSync(fp), { headers: { 'content-type': ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg' } });
    }
    case 'quick.html':
      return html(pages.quickPage(await curDb(), st));
    case 'tools.html':
      return html(pages.toolsPage(await curDb(), st, q.get('t') || ''));
    case 'worksheet.html': {
      st.notes = settings.notes || {};
      st.user = settings.user || {};
      return html(pages.worksheetPage(await curDb(), st, +q.get('node')));
    }
    case 'guida.html':
      return html(pages.guidePage(await curDb(), st, VERSION));
    case 'favorites.html':
      return html(pages.favoritesPage(await curDb(), st));
    case 'content.html': {
      const db = await curDb();
      st.notes = settings.notes || {};
      st.user = settings.user || {};
      st.linked = linkedLists();
      st.photos = userPhotos(+q.get('node'));
      return html(pages.contentPage(db, st, +q.get('node'), +q.get('from') || 0));
    }
    case 'zoom.html':
      return html(pages.zoomPage(await curDb(), st, +q.get('xml')));
    case 'zoomcomp.html':
      return html(pages.zoomCompPage(await curDb(), st, +q.get('xml')));
    case 'print.html':
      return html(pages.printPage(await curDb(), st, +q.get('node')));
    case 'ac.html':
      return html(UEM.acPage(await curDb(), st, !!q.get('all')));
    case 'uem.html':
      return html(UEM.viewPage(await curDb(), st, q.get('d'), q.get('p'), q.get('q') || ''));
    case 'uemsave': {
      const dd = UEM.doc(q.get('d'));
      const src = path.join(WEB, 'app', dd.dir || 'uem', dd.file);
      const r = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow() || undefined, { title: 'Salva il libretto', defaultPath: path.join(app.getPath('downloads'), dd.file), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (r.canceled || !r.filePath) return new Response('{}', { headers: { 'content-type': 'application/json' } });
      await fsp.copyFile(src, r.filePath);
      shell.showItemInFolder(r.filePath);
      return new Response(JSON.stringify({ file: r.filePath }), { headers: { 'content-type': 'application/json' } });
    }
    case 'search.html': {
      let out = pages.searchPage(await curDb(), st, q);
      const qq = (q.get('q') || '').trim(), d = qq ? d86() : null;
      if (qq) {
        const uh = UEM.searchHits(is250(st.model) ? '250' : '244', qq);
        if (uh.length) out = out.replace(/(<p class="scount">[\s\S]*?<\/p><\/div>)|<\/body>/i, (m0, m1) => (m1 || '') + `<div class="d86also uemalso">📕 <b>Nel libretto di uso e manutenzione e nei manuali A/C:</b> ${uh.length} pagine con «${qq.replace(/[&<>"]/g, '')}» — ${uh.slice(0, 5).map((r) => `<a href="uem.html?d=${r.d.id}&p=${r.p}&q=${encodeURIComponent(qq)}">${r.d.short}, pag. ${r.p}</a>`).join(' · ')} · <a href="uem.html?d=${uh[0].d.id}&q=${encodeURIComponent(qq)}"><b>vedi tutti →</b></a></div>` + (m1 ? '' : '</body>'));
      }
      if (d) {
        const hits = D86.searchHits(d, qq);
        if (hits.length) out = out.replace(/(<p class="scount">[\s\S]*?<\/p><\/div>)|<\/body>/i, (m0, m1) => (m1 || '') + `<div class="d86also">🚐 <b>Anche nel Ducato 1986:</b> ${hits.length} pagine con «${qq.replace(/[&<>"]/g, '')}» — ${hits.slice(0, 4).map((r) => `<a href="d86main.html?p=${r.p}&hl=${encodeURIComponent(qq)}" target="_parent">${(r.leaf ? r.leaf.t : 'pag. ' + r.p).replace(/[&<>"]/g, '')}</a>`).join(' · ')} · <a href="d86main.html?p=1&s=${encodeURIComponent(qq)}" target="_parent"><b>vedi tutti →</b></a></div>` + (m1 ? '' : '</body>'));
      }
      return html(out);
    }
    case 'help.html': {
      const f = storeFor(dataDir).exists(`system/help/help_${st.lang}/help_fiat.html`) ? `help_${st.lang}` : 'help_1';
      return redirect(`elearn://app/data/system/help/${f}/help_fiat.html`);
    }
  }
  return serveFile(ciJoin(WEB, p));
}

// ------------------------------------------------------------ importazione dati dal CD
function scanSources() {
  const out = [];
  const cands = [];
  if (process.platform === 'win32') for (const l of 'DEFGHIJKLMNOPQRSTUVWXYZ') cands.push(l + ':\\');
  else {
    // CD e chiavette montati: /media/utente/*, /run/media/utente/*, /mnt/*
    const user = require('os').userInfo().username;
    for (const b of [path.join('/media', user), path.join('/run/media', user), '/media', '/mnt']) {
      try { for (const e of fs.readdirSync(b, { withFileTypes: true })) if (e.isDirectory()) cands.push(path.join(b, e.name)); } catch (_) {}
    }
  }
  cands.push(appBaseDir(), path.join(appBaseDir(), '..'));
  for (const c of cands) {
    try {
      if (isDataDir(c) && ciJoin(c, 'Image')) out.push({ path: path.resolve(c), langs: availableLangs(c).length });
    } catch (_) {}
  }
  return out.filter((v, i, a) => a.findIndex((x) => x.path === v.path) === i);
}

async function listFiles(dir, base = dir, out = []) {
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) await listFiles(f, base, out);
    else out.push(path.relative(base, f));
  }
  return out;
}

async function importData(src, copy, sender) {
  if (!isDataDir(src)) return { error: 'La cartella scelta non contiene i dati eLearn (database\\elearn_N.dat).' };
  if (!copy) {
    settings.dataDir = src;
    saveSettings();
    dataDir = src;
    sender.loadURL('elearn://app/home.html');
    return { ok: true };
  }
  let dest = path.join(appBaseDir(), 'data');
  if (!writableDir(dest)) dest = path.join(app.getPath('userData'), 'data');
  try {
    const files = [];
    for (const d of ['database', 'Image', 'system', 'pdf']) {
      const real = ciJoin(src, d);
      if (real) for (const f of await listFiles(real)) files.push([path.join(real, f), path.join(dest, d, f)]);
    }
    let done = 0;
    for (const [a, b] of files) {
      await fsp.mkdir(path.dirname(b), { recursive: true });
      await fsp.copyFile(a, b);
      try {
        await fsp.chmod(b, 0o666);
      } catch (_) {}
      if (++done % 25 === 0 || done === files.length) sender.send('progress', { done, total: files.length });
    }
    settings.dataDir = dest;
    saveSettings();
    dataDir = dest;
    sender.loadURL('elearn://app/home.html');
    return { ok: true };
  } catch (e) {
    return { error: 'Errore durante la copia: ' + e.message };
  }
}

// ------------------------------------------------------------ finestre e schede
let win, toolbar, footer;
const tabs = []; // { view }
let active = null;
function popupOptions() {
  return {
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, plugins: true },
  };
}
function setupContents(wc) {
  wc.setWindowOpenHandler(({ url, disposition }) => {
    if (/^https?:/i.test(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow', overrideBrowserWindowOptions: popupOptions() };
  });
  wc.on('did-create-window', (w) => {
    w.setMenu(null);
    setupContents(w.webContents);
  });
  wc.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 3) LOG.warn('pagina:', e.message, e.sourceId || '');
  });
  wc.on('render-process-gone', (e, d) => LOG.error('render-process-gone', d && d.reason));
}

function contentBounds() {
  const b = win.getContentBounds();
  return { x: 0, y: TOOLBAR_H, width: b.width, height: b.height - TOOLBAR_H - FOOTER_H };
}
function tabTitle(t) {
  const u = t.view.webContents.getURL();
  const m = /[?&]node=(\d+)/.exec(u);
  const db = currentDbSync;
  if (m && db && db.elements.get(+m[1])) {
    const e = db.elements.get(+m[1]);
    return (e.CODE ? e.CODE + ' ' : '') + e.NAME;
  }
  if (/models\.html/.test(u)) return 'Home page';
  return 'DucatONE';
}
function sendTabs() {
  if (!toolbar || toolbar.webContents.isDestroyed() || !active) return;
  const h = active.view.webContents.navigationHistory;
  toolbar.webContents.send('nav', {
    back: h.canGoBack(),
    forward: h.canGoForward(),
    tabs: tabs.map((t, i) => ({ id: i, title: tabTitle(t), active: t === active })),
  });
}
function selectTab(t) {
  active = t;
  for (const x of tabs) x.view.setVisible(x === t);
  t.view.setBounds(contentBounds());
  t.view.webContents.focus();
  sendTabs();
}
function newTab(url, activate = true) {
  const view = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload.js'), plugins: true } });
  const t = { view };
  tabs.push(t);
  win.contentView.addChildView(view);
  view.setBounds(contentBounds());
  setupContents(view.webContents);
  if (process.env.ELEARN_DEBUG) view.webContents.on('console-message', (e) => fs.appendFileSync('/tmp/pagelog.txt', e.message + '\n'));
  view.webContents.on('did-navigate', sendTabs);
  view.webContents.on('did-navigate-in-page', sendTabs);
  view.webContents.on('page-title-updated', (e) => { e.preventDefault(); sendTabs(); });
  view.webContents.loadURL(url);
  if (activate || !active) selectTab(t);
  else { view.setVisible(false); sendTabs(); }
  return t;
}
function closeTab(i) {
  const t = tabs[i];
  if (!t) return;
  if (tabs.length === 1) return; // l'ultima scheda resta aperta
  tabs.splice(i, 1);
  win.contentView.removeChildView(t.view);
  t.view.webContents.close();
  if (active === t) selectTab(tabs[Math.min(i, tabs.length - 1)]);
  else sendTabs();
}

function createWindow() {
  // dimensioni e posizione della finestra: quelle dell'ultima chiusura, se ancora visibili su uno schermo
  const { screen } = require('electron');
  let ws = settings.win && !process.env.ELEARN_W ? settings.win : null;
  if (ws && ws.bounds) {
    const d = screen.getDisplayMatching(ws.bounds).workArea;
    const vis = ws.bounds.x < d.x + d.width - 80 && ws.bounds.x + ws.bounds.width > d.x + 80 && ws.bounds.y >= d.y - 20 && ws.bounds.y < d.y + d.height - 80;
    if (!vis) ws = { max: ws.max, bounds: { width: Math.min(ws.bounds.width, d.width), height: Math.min(ws.bounds.height, d.height) } };
  }
  const wb = (ws && ws.bounds) || { width: +process.env.ELEARN_W || 1280, height: +process.env.ELEARN_H || 800 };
  win = new BaseWindow({ ...wb, minWidth: 640, minHeight: 480, title: 'DucatONE', icon: ICON, show: false });
  let wsTimer = null;
  const saveWin = () => {
    clearTimeout(wsTimer);
    wsTimer = setTimeout(() => {
      if (!win || win.isDestroyed() || win.isMinimized()) return;
      settings.win = { max: win.isMaximized() || win.isFullScreen(), bounds: win.isMaximized() || win.isFullScreen() ? (settings.win && settings.win.bounds) || wb : win.getBounds() };
      saveSettings();
    }, 400);
  };
  win.on('resize', saveWin);
  win.on('move', saveWin);
  win.on('maximize', saveWin);
  win.on('unmaximize', saveWin);
  win.setMenu(null);
  toolbar = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload.js') } });
  footer = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload.js') } });
  win.contentView.addChildView(toolbar);
  win.contentView.addChildView(footer);
  const layout = () => {
    const b = win.getContentBounds();
    toolbar.setBounds({ x: 0, y: 0, width: b.width, height: TOOLBAR_H });
    for (const t of tabs) t.view.setBounds(contentBounds());
    footer.setBounds({ x: 0, y: b.height - FOOTER_H, width: b.width, height: FOOTER_H });
  };
  win.on('resize', layout);
  layout();
  toolbar.webContents.loadURL('elearn://app/app/toolbar.html');
  footer.webContents.loadURL('elearn://app/app/footer.html');
  toolbar.webContents.on('did-finish-load', sendTabs);
  const startUrl = 'elearn://app/models.html'; // si riparte sempre dalla home
  newTab(dataDir ? process.env.ELEARN_START || startUrl : 'elearn://app/app/setup.html');
  layout();
  if (!ws || ws.max) win.maximize();
  win.show();
  win.on('closed', () => app.quit());
  let updChecked = false;
  const firstCheck = () => { if (updChecked) return; updChecked = true; checkUpdates(false); };
  try { tabs[0] && tabs[0].view.webContents.once('did-finish-load', () => setTimeout(firstCheck, 1200)); } catch (_) {}
  setTimeout(firstCheck, 5000);
  setInterval(() => checkUpdates(false), 6 * 3600 * 1000);
}

// ------------------------------------------------------------ aggiornamento automatico
let updInfo = null, updWin = null, updBusy = false, sessionSkip = null;
async function checkUpdates(manual) {
  if (process.env.ELEARN_UPD_FAKE) { updInfo = { version: '9.9.9', notes: 'Prova', size: 1 }; showUpdateWindow(); return { found: '9.9.9' }; }
  if (updBusy || !app.isPackaged && !process.env.ELEARN_UPD_TEST) return manual ? { none: true, dev: true } : null;
  try {
    const { net } = require('electron');
    const info = await require('./lib/updater').check((u, o) => net.fetch(u, o), VERSION.version, settings.updateUrl);
    if (!info) { LOG.info('nessun aggiornamento (versione ' + VERSION.version + ')'); return { none: true }; }
    if (!manual && sessionSkip === info.version) return { later: true }; // «Più tardi»: non ripropone fino al prossimo avvio
    updInfo = info;
    LOG.info('aggiornamento disponibile', info.version, '- mostro la finestra');
    showUpdateWindow();
    return { found: info.version };
  } catch (e) {
    LOG.warn('verifica aggiornamenti:', e.message);
    return { error: e.message };
  }
}
function showUpdateWindow() {
  if (updWin && !updWin.isDestroyed()) return updWin.focus();
  const W = 520, H = 380;
  let pos = {};
  try {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      const b = win.getBounds();
      pos = { x: Math.round(b.x + (b.width - W) / 2), y: Math.round(b.y + (b.height - H) / 2) };
    }
  } catch (_) {}
  // finestra figlia della principale: resta sopra al programma, centrata, e lo blocca finché non si sceglie
  updWin = new BrowserWindow({ parent: win && !win.isDestroyed() ? win : undefined, show: false, ...pos, width: W, height: H, resizable: false, minimizable: false, maximizable: false, title: 'Aggiornamento DucatONE', icon: ICON, autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.js') } });
  updWin.setMenu(null);
  updWin.loadURL('elearn://app/app/update.html');
  // sempre davanti: mostrata in primo piano appena pronta, anche se la finestra principale sta ancora caricando
  const bringFront = () => {
    if (!updWin || updWin.isDestroyed()) return;
    updWin.setAlwaysOnTop(true, 'floating');
    updWin.show();
    updWin.moveTop();
    updWin.focus();
    setTimeout(() => { try { if (updWin && !updWin.isDestroyed()) updWin.setAlwaysOnTop(false); } catch (_) {} }, 4000);
  };
  updWin.once('ready-to-show', bringFront);
  updWin.webContents.once('did-finish-load', () => setTimeout(bringFront, 300));
  if (win && !win.isDestroyed()) win.flashFrame(true);
  updWin.on('closed', () => {
    if (!updBusy && updInfo) sessionSkip = updInfo.version;
    updWin = null;
  });
}
ipcMain.on('upd-info', (e) => { e.returnValue = { ...(updInfo || {}), current: VERSION.version }; });
ipcMain.handle('upd-check', () => checkUpdates(true));
ipcMain.on('upd-start', async (e) => {
  if (!updInfo || updBusy) return;
  if (PORTABLE || (IS_LINUX && !process.env.APPIMAGE)) { shell.openExternal('https://github.com/Projekto1983/DucatONE/releases/latest'); try { updWin && updWin.close(); } catch (_) {} return; }
  updBusy = true;
  const send = (p) => { try { e.sender.send('upd', p); } catch (_) {} };
  try {
    const { net } = require('electron');
    const dir = path.join(app.getPath('temp'), 'DucatONE-update');
    let last = 0;
    const file = await require('./lib/updater').download((u, o) => net.fetch(u, o), updInfo, dir, (done, total) => {
      if (Date.now() - last > 150) { last = Date.now(); send({ done, total }); }
    });
    send({ installing: true });
    LOG.info('installazione aggiornamento', updInfo.version, file);
    await new Promise((r) => setTimeout(r, 900));
    let exe = file, args = ['/S', '--updated', '--force-run'];
    if (IS_LINUX) { // sostituisce il file AppImage e lo riavvia
      const target = process.env.APPIMAGE, tmp = target + '.new';
      fs.copyFileSync(file, tmp);
      fs.chmodSync(tmp, 0o755);
      fs.renameSync(tmp, target);
      try { fs.unlinkSync(file); } catch (_) {}
      exe = target; args = [];
    }
    await new Promise((res, rej) => {
      const ch = require('child_process').spawn(exe, args, { detached: true, stdio: 'ignore' });
      ch.once('error', rej);
      ch.once('spawn', () => { ch.unref(); res(); });
    });
    setTimeout(() => app.exit(0), 300);
  } catch (err) {
    updBusy = false;
    LOG.error('aggiornamento:', err.message);
    send({ error: err.message });
  }
});

// ------------------------------------------------------------ segnalazioni
ipcMain.on('report', async () => {
  let page = '';
  try { page = active ? tabTitle(active) + '\n' + active.view.webContents.getURL() : ''; } catch (_) {}
  const os = require('os');
  const body = [
    'Descrivi qui il problema:', '', '', '',
    '--- informazioni tecniche (non modificare) ---',
    `DucatONE ${VERSION.version} (${VERSION.updated}) · ${process.platform === 'win32' ? 'Windows' : os.type()} ${os.release()} · ${os.arch()}`,
    `Pagina: ${page}`,
    `Motorizzazione/periodo: ${st.val}/${st.prod} · lingua ${st.lang}`,
    '', 'Ultime righe del registro:', LOG.tail(25),
  ].join('\n');
  const to = settings.reportEmail || REPORT_EMAIL;
  const url = `mailto:${to}?subject=${encodeURIComponent('DucatONE ' + VERSION.version + ' - segnalazione')}&body=${encodeURIComponent(body).slice(0, 1800)}`;
  shell.openExternal(url);
});
// popup video YouTube
let videoWin = null;
ipcMain.on('video-open', (e, id, title) => {
  if (!/^[\w-]{11}$/.test(String(id))) return;
  if (!videoWin || videoWin.isDestroyed()) {
    videoWin = new BrowserWindow({
      width: 1024, height: 620, minWidth: 480, minHeight: 300, autoHideMenuBar: true, backgroundColor: '#000',
      icon: ICON,
      webPreferences: { contextIsolation: true, sandbox: true },
    });
    videoWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    videoWin.webContents.on('will-navigate', (ev, url) => { if (!/youtube(-nocookie)?\.com\/embed\//.test(url)) { ev.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  }
  videoWin.setTitle((title || 'Video') + ' - DucatONE');
  videoWin.webContents.once('page-title-updated', (ev) => ev.preventDefault());
  const offline = `<html><body style="margin:0;background:#111;color:#eee;font:15px Arial;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center"><div><p style="font-size:40px;margin:0">▶</p><p>Impossibile caricare il video: controlla la connessione a Internet.</p><p><a style="color:#ff6b5e" href="https://www.youtube.com/watch?v=${id}">Apri su YouTube ↗</a></p></div></body></html>`;
  videoWin.loadURL(`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1`, { httpReferrer: 'https://ducatone.app/' }).catch(() => {
    if (videoWin && !videoWin.isDestroyed()) videoWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(offline)).catch(() => {});
  });
  videoWin.show();
  videoWin.focus();
});

ipcMain.on('stats-get', (e) => { e.returnValue = { on: settings.stats !== false, id: settings.statsId || '' }; });
ipcMain.on('stats-set', (e, on) => { settings.stats = !!on; saveSettings(); });
// elenchi ricambi/video salvati (per collegarli alle procedure senza attendere la rete)
function linkedLists() {
  const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), f), 'utf8')).items || []; } catch (_) { return []; } };
  return { ricambi: rd('ricambi-cache.json'), video: rd('video-cache.json') };
}
// foto personali allegate alle pagine
function userPhotos(node) {
  try { return fs.readdirSync(path.join(app.getPath('userData'), 'foto', String(node))).filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f)).sort(); } catch (_) { return []; }
}
ipcMain.handle('photo-add', async (e, node) => {
  if (!/^\d+$/.test(String(node))) return { error: 'pagina non valida' };
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender) || undefined, { title: 'Aggiungi foto alla pagina', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Immagini', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }] });
  if (r.canceled) return { canceled: true };
  const dir = path.join(app.getPath('userData'), 'foto', String(node));
  fs.mkdirSync(dir, { recursive: true });
  for (const f of r.filePaths) {
    const base = path.basename(f).replace(/[^\w.-]+/g, '_').slice(-60);
    fs.copyFileSync(f, path.join(dir, Date.now() + '_' + base));
  }
  return { ok: true, n: r.filePaths.length };
});
ipcMain.handle('photo-del', (e, node, file) => {
  if (!/^\d+$/.test(String(node)) || !/^[\w.-]+$/.test(file)) return { error: 'non valido' };
  try { fs.unlinkSync(path.join(app.getPath('userData'), 'foto', String(node), file)); return { ok: true }; } catch (err) { return { error: err.message }; }
});
// novità in Ricambi/Video rispetto all'ultima visita
// colonna "Mezzo" dei fogli: vuota/tutti = entrambi; 1986/290/prima serie = solo Ducato 1986; 244 = solo 244
const IS86 = /86|290|prima|1\s*[ªa°]?\s*serie/i;
function forMezzo(items, m) {
  return items.filter((x) => {
    const v = String(x.mezzo || '').trim();
    if (!v || /tutt|entramb|all/i.test(v)) return true;
    const is86 = IS86.test(v), is250m = /250|x\s*250|nuovo|2014/i.test(v), is244 = /244|2002/.test(v) || (!is86 && !is250m);
    return m === '86' ? is86 : m === '250' ? is250m : is244;
  });
}
function markSeen(key, ids) { settings.user = settings.user || {}; settings.user[key] = ids; saveSettings(); }
function newCounts() {
  const u = settings.user || {}, l = linkedLists();
  const cnt = (items, key, f) => { if (!Array.isArray(u[key])) { markSeen(key, items.map(f)); return 0; } const seen = new Set(u[key]); return items.filter((x) => !seen.has(f(x))).length; };
  return { ric: cnt(l.ricambi, 'seenRic', (x) => x.link || x.name), vid: cnt(l.video, 'seenVid', (x) => x.id) };
}
// controllo integrità del pacchetto dati (una volta per versione)
async function checkPak() {
  try {
    const file = path.join(dataDir || '', 'data.pak');
    if (!fs.existsSync(file)) return;
    const stt = fs.statSync(file);
    const tag = VERSION.version + ':' + stt.size + ':' + Math.round(stt.mtimeMs);
    if (settings.pakChecked === tag) return;
    let ok = false;
    const sx = storeFor(dataDir);
    if (!sx || !sx.verify) return;
    try { const r = await sx.verify(); ok = r.bad === 0 && r.entries > 100; LOG.info('verifica dati:', JSON.stringify(r)); } catch (e) { ok = false; }
    if (ok) { settings.pakChecked = tag; saveSettings(); LOG.info('dati verificati'); return; }
    LOG.error('data.pak danneggiato');
    const r = await dialog.showMessageBox(win, { type: 'warning', title: 'DucatONE', message: 'I dati del manuale risultano danneggiati o incompleti.', detail: 'Alcune pagine o immagini potrebbero non aprirsi. Per ripararli scarica di nuovo il programma completo (DucatONE-Setup) e installalo sopra: note, preferiti e impostazioni vengono conservati.', buttons: ['Scarica il programma completo', 'Più tardi'], defaultId: 0 });
    if (r.response === 0) shell.openExternal('https://github.com/Projekto1983/DucatONE/releases/latest');
  } catch (e) { LOG.warn('controllo dati:', e.message); }
}

// dati utente generici (checklist, preferiti ricambi, ecc.)
ipcMain.on('ui-lang', (e) => { e.returnValue = st.lang || 1; });
ipcMain.on('kv-get', (e, k) => { e.returnValue = (settings.user || {})[k] ?? null; });
ipcMain.on('kv-set', (e, k, v) => { settings.user = settings.user || {}; if (v === null || v === undefined) delete settings.user[k]; else settings.user[k] = v; saveSettings(); });
// segnalazione di un errore su una pagina del manuale
ipcMain.on('report-page', (e, info) => {
  const body = ['Pagina del manuale: ' + (info.title || ''), 'Codice nodo: ' + (info.node || ''), 'Motorizzazione/periodo: ' + st.val + '/' + st.prod, '', "Descrivi l'errore che hai trovato:", '', ''].join('\n');
  shell.openExternal(`mailto:${settings.reportEmail || REPORT_EMAIL}?subject=${encodeURIComponent('DucatONE - errore nel manuale: ' + (info.title || '').slice(0, 80))}&body=${encodeURIComponent(body)}`);
});
// backup di note, preferiti, cronologia e dati personali
ipcMain.handle('backup-export', async (e) => {
  const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender) || undefined, {
    title: 'Salva backup DucatONE', defaultPath: path.join(app.getPath('documents'), 'DucatONE-backup-' + new Date().toISOString().slice(0, 10) + '.json'), filters: [{ name: 'Backup DucatONE', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePath) return { canceled: true };
  const keep = ['notes', 'favs', 'history', 'user', 'lang', 'last'];
  const data = { app: 'DucatONE', version: VERSION.version, date: new Date().toISOString(), settings: Object.fromEntries(keep.filter((k) => settings[k] !== undefined).map((k) => [k, settings[k]])), files: {} };
  const photos = path.join(app.getPath('userData'), 'foto');
  const walk = (d) => { try { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const fp = path.join(d, f.name); if (f.isDirectory()) walk(fp); else data.files[path.relative(app.getPath('userData'), fp).replace(/\\/g, '/')] = fs.readFileSync(fp).toString('base64'); } } catch (_) {} };
  walk(photos);
  fs.writeFileSync(r.filePath, JSON.stringify(data));
  return { ok: true, file: r.filePath };
});
ipcMain.handle('backup-import', async (e) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender) || undefined, { title: 'Ripristina backup DucatONE', properties: ['openFile'], filters: [{ name: 'Backup DucatONE', extensions: ['json'] }] });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  try {
    const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    if (data.app !== 'DucatONE' || !data.settings) throw new Error('Il file scelto non è un backup di DucatONE.');
    Object.assign(settings, data.settings);
    for (const [rel, b64] of Object.entries(data.files || {})) {
      if (!/^foto\//.test(rel) || rel.includes('..')) continue;
      const fp = path.join(app.getPath('userData'), rel);
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, Buffer.from(b64, 'base64'));
    }
    saveSettings();
    st.favs = settings.favs || [];
    return { ok: true, date: data.date };
  } catch (err) {
    return { error: String(err.message || err) };
  }
});

ipcMain.on('open-log', () => LOG.file && shell.showItemInFolder(LOG.file));

ipcMain.on('back', () => active && active.view.webContents.navigationHistory.canGoBack() && active.view.webContents.navigationHistory.goBack());
ipcMain.on('forward', () => active && active.view.webContents.navigationHistory.canGoForward() && active.view.webContents.navigationHistory.goForward());
ipcMain.on('tab-new', (e, url) => newTab(url || (active ? active.view.webContents.getURL() : 'elearn://app/models.html'), true));
ipcMain.on('tab-open', (e, url) => newTab(url, false));
ipcMain.on('tab-select', (e, i) => tabs[i] && selectTab(tabs[i]));
ipcMain.on('tab-close', (e, i) => closeTab(i === undefined ? tabs.indexOf(active) : i));
ipcMain.on('tab-cycle', (e, d) => { const i = tabs.indexOf(active); selectTab(tabs[(i + d + tabs.length) % tabs.length]); });
ipcMain.on('reload-all', () => tabs.forEach((t) => t.view.webContents.reload()));
ipcMain.on('exit', () => app.quit());
ipcMain.on('info', (e) => { e.returnValue = { version: VERSION.version, updated: VERSION.updated }; });
ipcMain.on('focusMain', () => win && (win.isMinimized() && win.restore(), win.focus()));
ipcMain.handle('scanSources', () => scanSources());
ipcMain.handle('pickSource', async () => {
  const r = await dialog.showOpenDialog({ title: 'Cartella o unità del CD eLearn (dati Ducato)', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  if (!isDataDir(p)) return { error: 'La cartella scelta non contiene i dati eLearn (database\\elearn_N.dat).' };
  return { path: p, langs: availableLangs(p).length };
});
ipcMain.handle('exportPdf', async (e, url) => {
  const src = BrowserWindow.fromWebContents(e.sender) || undefined;
  const w = new BrowserWindow({ show: false, webPreferences: { plugins: true } });
  try {
    await w.loadURL(url);
    await new Promise((r) => setTimeout(r, 1200)); // tempo per gli schemi SVG
    const title = (w.webContents.getTitle() || 'eLearn').replace(/^(eLearn|DucatONE)\s*-\s*/, '');
    const landscape = /print\.html|zoom\.html/.test(url);
    let name = title && !/contents/i.test(title) ? title : 'DucatONE';
    try {
      const db = await curDb();
      const mn = /[?&]node=(\d+)/.exec(url), mx = /[?&]xml=(\d+)/.exec(url);
      const el = mn ? db.elements.get(+mn[1]) : mx && db.xmlById.get(+mx[1]) ? db.elements.get(db.xmlById.get(+mx[1]).ELEMENT_ID) : null;
      if (el) name = ((el.CODE ? el.CODE + ' ' : '') + el.NAME);
    } catch (_) {}
    const he = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const pdf = await w.webContents.printToPDF({
      printBackground: true, pageSize: 'A4', landscape, margins: { marginType: 'default' },
      displayHeaderFooter: true,
      headerTemplate: `<div style="font:7px Verdana,Arial;width:100%;padding:0 10mm;color:#004594;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">DucatONE — ${he(name)}</div>`,
      footerTemplate: '<div style="font:7px Verdana,Arial;width:100%;padding:0 10mm;text-align:right;color:#666"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    });
    name = name.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80);
    const r = process.env.ELEARN_PDF_OUT ? { filePath: process.env.ELEARN_PDF_OUT } : await dialog.showSaveDialog(src, {
      title: 'Esporta PDF',
      defaultPath: path.join(app.getPath('documents'), name + '.pdf'),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (r.canceled || !r.filePath) return { canceled: true };
    await fsp.writeFile(r.filePath, pdf);
    shell.openPath(r.filePath);
    return { ok: true, file: r.filePath };
  } catch (err) {
    dialog.showErrorBox('Esporta PDF', String(err.message || err));
    return { error: String(err) };
  } finally {
    w.destroy();
  }
});
ipcMain.handle('importData', (e, src, copy) => importData(src, copy, e.sender));

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => win && (win.isMinimized() && win.restore(), win.focus()));
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    LOG.init(path.join(LOCAL_DIR || app.getPath('userData'), 'logs'));
    LOG.info('avvio DucatONE', VERSION.version);
    process.on('uncaughtException', (e) => LOG.error('eccezione:', e));
    process.on('unhandledRejection', (e) => LOG.error('promise:', e));
    loadSettings();
    migrateBundledData();
    migrateD86();
    migrateX250();
    if (settings.lang) st.lang = settings.lang;
    if (settings.last) Object.assign(st, { lang: settings.last.lang, mark: settings.last.mark, model: settings.last.model, val: settings.last.val, prod: settings.last.prod });
    st.favs = settings.favs || [];
    dataDir = resolveDataDir();
    protocol.handle('elearn', (req) =>
      handle(req).catch((e) => (LOG.error('pagina', req.url, e), new Response(`<pre>${String(e.stack || e)}</pre>`, { status: 500, headers: { 'content-type': 'text/html' } })))
    );
    if (process.env.ELEARN_COLLECT) {
      require('./lib/collect')(JSON.parse(fs.readFileSync(process.env.ELEARN_COLLECT, 'utf8')), process.env.ELEARN_COLLECT + '.out.json').then(() => app.quit());
      return;
    }
    if (process.env.ELEARN_SELFTEST) {
      const list = JSON.parse(fs.readFileSync(process.env.ELEARN_SELFTEST, 'utf8'));
      if (list.state) Object.assign(st, list.state);
      require('./lib/selftest')(list.urls, process.env.ELEARN_SELFTEST + '.out.json').then(() => app.quit());
      return;
    }
    createWindow();
    // avvio rapido: prepara in background lingua, indice di ricerca e vocabolario
    setTimeout(async () => { try { const db = await curDb(); if (db) { db.buildIndex(); pages.warmSearch(db); } } catch (_) {} }, 2500);
    setTimeout(() => { checkPak(); }, 20000);
    setTimeout(async () => {
      try {
        await require('./lib/ricambi').load((u, o) => net.fetch(u, o), app.getPath('userData'), settings.ricambiUrl);
        await require('./lib/video').load((u, o) => net.fetch(u, o), app.getPath('userData'), settings.videoUrl);
      } catch (_) {}
    }, 12000);
    // statistiche anonime d'uso (disattivabili dalla guida)
    setTimeout(async () => {
      let lang = String(st.lang || '');
      try { const l = (await curDb()).languages.find((x) => x.ID === st.lang); if (l) lang = l.NAME; } catch (_) {}
      require('./lib/stats').send((u, o) => net.fetch(u, o), settings, saveSettings, VERSION.version, `${lang} (sistema ${app.getLocale()})`, (...a) => LOG.info(...a)).catch(() => {});
    }, 15000);
  });
  app.on('window-all-closed', () => app.quit());
}
