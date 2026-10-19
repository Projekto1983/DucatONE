'use strict';
// Lettura di un elenco online da Google Drive: Foglio Google (CSV) oppure file Excel .xlsx caricato su Drive.
const zlib = require('zlib');

function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}

// ---- lettore .xlsx minimo (zip + XML), primo foglio
function unzip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('xlsx non valido');
  const n = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const files = {};
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    const lnl = buf.readUInt16LE(off + 26), lxl = buf.readUInt16LE(off + 28);
    const data = buf.subarray(off + 30 + lnl + lxl, off + 30 + lnl + lxl + csize);
    files[name] = () => (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
    p += 46 + nl + xl + cl;
  }
  return files;
}
const xmlText = (s) =>
  s.replace(/<rPh[\s\S]*?<\/rPh>/g, '').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
const colIdx = (ref) => {
  let n = 0;
  for (const ch of /^[A-Z]+/.exec(ref)[0]) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
};

function parseXLSX(buf) {
  const f = unzip(buf);
  const shared = f['xl/sharedStrings.xml'] ? [...f['xl/sharedStrings.xml']().matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText(m[1])) : [];
  // primo foglio secondo l'ordine del workbook
  let sheetPath = 'xl/worksheets/sheet1.xml';
  try {
    const wb = f['xl/workbook.xml']();
    const rels = f['xl/_rels/workbook.xml.rels']();
    const rid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(wb)[1];
    const tgt = new RegExp('<Relationship\\b[^>]*Id="' + rid + '"[^>]*Target="([^"]+)"').exec(rels) || new RegExp('<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="' + rid + '"').exec(rels);
    if (tgt) sheetPath = tgt[1].startsWith('/') ? tgt[1].slice(1) : 'xl/' + tgt[1].replace(/^\.\//, '');
  } catch (_) {}
  if (!f[sheetPath]) sheetPath = Object.keys(f).find((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k));
  const xml = f[sheetPath]();
  const rows = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], body = cm[2] || '';
      const r = /\br="([A-Z]+)\d+"/.exec(attrs);
      const t = (/\bt="([^"]+)"/.exec(attrs) || [])[1];
      let v = '';
      if (t === 'inlineStr') v = xmlText((/<is>([\s\S]*?)<\/is>/.exec(body) || [, ''])[1]);
      else {
        const vm = /<v>([\s\S]*?)<\/v>/.exec(body);
        v = vm ? xmlText(vm[1]) : '';
        if (t === 's') v = shared[+v] || '';
      }
      row[r ? colIdx(r[1]) : row.length] = v;
    }
    rows.push(Array.from(row, (x) => (x == null ? '' : String(x))));
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

// indirizzi da provare per un link di Drive / Fogli
function candidates(url) {
  if (/[?&]format=csv/.test(url) || /\/pub\?/.test(url)) return [url];
  const m = /\/d\/([\w-]{20,})/.exec(url) || /[?&]id=([\w-]{20,})/.exec(url);
  if (!m) return [url];
  const id = m[1];
  const sheet = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`;
  const file = `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
  return /rtpof=true|\.xlsx/i.test(url) || id.length < 40 ? [file, sheet] : [sheet, file];
}

async function fetchRows(netFetch, url) {
  let lastErr = null;
  for (const u of candidates(url)) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 10000);
      const r = await netFetch(u + (u.includes('?') ? '&' : '?') + 't=' + Date.now(), { signal: ctl.signal, redirect: 'follow' });
      const buf = Buffer.from(await r.arrayBuffer());
      clearTimeout(t);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      if (buf[0] === 0x50 && buf[1] === 0x4b) return parseXLSX(buf);
      const type = r.headers.get('content-type') || '';
      const txt = buf.toString('utf8');
      if (/text\/html/i.test(type) || /^\s*<(!doctype|html)/i.test(txt)) throw new Error('Il file non è condiviso pubblicamente');
      return parseCSV(txt);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('elenco non disponibile');
}

module.exports = { fetchRows, parseCSV, parseXLSX, candidates };
