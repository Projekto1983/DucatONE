'use strict';
// Aggiornamento automatico: legge il Foglio Google "OfficinaONE - Aggiornamenti" (CSV pubblico),
// confronta la versione, scarica il pacchetto di aggiornamento e lo installa.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseCSV } = require('./ricambi');

const DEFAULT_URL = 'https://docs.google.com/spreadsheets/d/1YkXwBzY3QgBu7BY82T8GWnv_XkWf6qBxRbJeUi21oEc/export?format=csv';

function cmp(a, b) {
  const pa = String(a).split(/[.\-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(/[.\-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// link di condivisione -> link di download diretto
function directLink(u) {
  u = String(u || '').trim();
  let m = /drive\.google\.com\/file\/d\/([\w-]+)/.exec(u) || /drive\.google\.com\/(?:open|uc)\?(?:.*&)?id=([\w-]+)/.exec(u);
  if (m) return `https://drive.usercontent.google.com/download?id=${m[1]}&export=download&confirm=t`;
  if (/dropbox\.com/.test(u)) return u.replace(/([?&])dl=0/, '$1dl=1') + (/[?&]dl=/.test(u) ? '' : (u.includes('?') ? '&' : '?') + 'dl=1');
  return u;
}

// Fonte GitHub Releases: url nella forma "github:proprietario/repository"
async function checkGithub(netFetch, current, repo) {
  const r = await netFetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'OfficinaONE' } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('GitHub non raggiungibile (HTTP ' + r.status + ')');
  const rel = await r.json();
  const version = String(rel.tag_name || rel.name || '').replace(/^v/i, '');
  if (!version || cmp(version, current) <= 0) return null;
  const L = process.platform === 'linux';
  const ext = L ? /\.appimage$/i : /\.exe$/i;
  const assets = rel.assets || [];
  const asset = assets.find((a) => /update/i.test(a.name) && ext.test(a.name)) || assets.find((a) => ext.test(a.name));
  if (!asset) return null;
  const m = (L ? /sha256-linux[:\s]+([a-f0-9]{64})/i : /sha256[:\s]+([a-f0-9]{64})/i).exec(rel.body || '');
  // riga «obbligatorio: sì» nelle note: l'aggiornamento non si può rimandare
  // riga «minima: x.y.z»: obbligatorio solo per le versioni più vecchie di x.y.z
  const body = rel.body || '';
  const mMin = /^\s*minima\s*[:=]\s*v?([\d.]+)\s*$/im.exec(body);
  // dalla 3.2.1 ogni aggiornamento è obbligatorio (le righe restano per compatibilità con la 3.2.0)
  const forced = true || /^\s*obbligatorio\s*[:=]\s*(s[iì]|yes|true)\s*$/im.test(body) || (mMin ? cmp(current, mMin[1]) < 0 : false);
  const notes = body.replace(/sha256(-linux)?[:\s]+[a-f0-9]{64}/ig, '').replace(/^\s*(obbligatorio|minima)\s*[:=].*$/img, '').trim();
  return { version, link: asset.browser_download_url, notes, sha256: m ? m[1].toLowerCase() : '', forced };
}

const DEFAULT_SOURCE = 'github:Projekto1983/OfficinaONE';
async function check(netFetch, current, url) {
  url = url || DEFAULT_SOURCE;
  if (/^github:/i.test(url)) return checkGithub(netFetch, current, url.slice(7));
  const u0 = url || DEFAULT_URL;
  const r = await netFetch(u0 + (u0.includes('?') ? '&' : '?') + 't=' + Date.now());
  const type = r.headers.get('content-type') || '';
  if (!r.ok || /text\/html/i.test(type)) throw new Error('Elenco aggiornamenti non raggiungibile');
  const rows = parseCSV(await r.text());
  const head = (rows[0] || []).map((h) => h.toLowerCase());
  const col = (n) => head.findIndex((h) => h.startsWith(n));
  const iv = col('versione'), il = col('link'), inote = col('note'), ish = col('sha');
  let best = null;
  for (const row of rows.slice(1)) {
    const v = (row[iv] || '').trim(), l = (row[il] || '').trim();
    if (!v || !/^https?:\/\//i.test(l)) continue;
    if (cmp(v, current) > 0 && (!best || cmp(v, best.version) > 0))
      best = { version: v, link: directLink(l), notes: (row[inote] || '').trim(), sha256: ish >= 0 ? (row[ish] || '').trim().toLowerCase() : '' };
  }
  return best;
}

async function download(netFetch, info, dir, onProgress) {
  fs.mkdirSync(dir, { recursive: true });
  const L = process.platform === 'linux';
  const dest = path.join(dir, `OfficinaONE-Update-${info.version}${L ? '.AppImage' : '.exe'}`);
  const r = await netFetch(info.link, { redirect: 'follow' });
  const type = r.headers.get('content-type') || '';
  if (!r.ok) throw new Error('Download non riuscito (HTTP ' + r.status + ')');
  if (/text\/html/i.test(type)) throw new Error('Il link di download non è un collegamento diretto al file (controlla la condivisione)');
  const total = +r.headers.get('content-length') || 0;
  const out = fs.createWriteStream(dest);
  const hash = crypto.createHash('sha256');
  let done = 0;
  const reader = r.body.getReader();
  for (;;) {
    const { done: end, value } = await reader.read();
    if (end) break;
    const b = Buffer.from(value);
    hash.update(b);
    if (!out.write(b)) await new Promise((res) => out.once('drain', res));
    done += b.length;
    onProgress && onProgress(done, total);
  }
  await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
  const sum = hash.digest('hex');
  if (info.sha256 && info.sha256 !== sum) { try { fs.unlinkSync(dest); } catch (_) {} throw new Error('File scaricato danneggiato (SHA256 non corrisponde)'); }
  const head = Buffer.alloc(4);
  const fd = fs.openSync(dest, 'r'); fs.readSync(fd, head, 0, 4, 0); fs.closeSync(fd);
  if (L ? head.toString('latin1') !== '\x7fELF' : head.toString('latin1', 0, 2) !== 'MZ') throw new Error('Il file scaricato non è un programma di installazione valido');
  return dest;
}

module.exports = { check, download, cmp, directLink, DEFAULT_URL };
