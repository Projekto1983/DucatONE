'use strict';
// Accesso ai dati del CD: da cartella (database/, Image/, system/) oppure da un unico archivio data.pak
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const MAGIC = 'DUCPAK01';

class PakStore {
  constructor(file) {
    this.file = file;
    this.fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(12);
    fs.readSync(this.fd, head, 0, 12, 0);
    if (head.toString('latin1', 0, 8) !== MAGIC) throw new Error('data.pak non valido');
    const n = head.readUInt32LE(8);
    const idx = Buffer.alloc(n);
    fs.readSync(this.fd, idx, 0, n, 12);
    this.index = JSON.parse(idx.toString('utf8'));
    this.base = 12 + n;
  }
  key(rel) {
    return rel.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  }
  exists(rel) {
    return Object.prototype.hasOwnProperty.call(this.index, this.key(rel));
  }
  // verifica: tutte le voci dentro il file e i blocchi compressi leggibili
  async verify() {
    const size = fs.fstatSync(this.fd).size;
    let bad = 0, n = 0;
    for (const [k, e] of Object.entries(this.index)) {
      if (this.base + e[0] + e[1] > size) { bad++; continue; }
      if (e[2]) {
        try { const b = Buffer.alloc(e[1]); fs.readSync(this.fd, b, 0, e[1], this.base + e[0]); zlib.gunzipSync(b); } catch (_) { bad++; }
      }
      if (++n % 200 === 0) await new Promise((r) => setImmediate(r));
    }
    return { entries: n, bad };
  }
  read(rel) {
    const e = this.index[this.key(rel)];
    if (!e) return null;
    const b = Buffer.alloc(e[1]);
    fs.readSync(this.fd, b, 0, e[1], this.base + e[0]);
    return e[2] ? zlib.gunzipSync(b) : b;
  }
  list(dir) {
    const p = this.key(dir).replace(/\/?$/, '/');
    const out = new Set();
    for (const k of Object.keys(this.index)) if (k.startsWith(p)) out.add(k.slice(p.length).split('/')[0]);
    return [...out];
  }
}

class DirStore {
  constructor(dir) {
    this.dir = dir;
  }
  resolve(rel) {
    let cur = this.dir;
    for (const part of rel.split(/[\\/]+/).filter(Boolean)) {
      if (part === '..') return null;
      const p = path.join(cur, part);
      if (fs.existsSync(p)) { cur = p; continue; }
      let hit = null;
      try { hit = fs.readdirSync(cur).find((n) => n.toLowerCase() === part.toLowerCase()); } catch (_) {}
      if (!hit) return null;
      cur = path.join(cur, hit);
    }
    return cur;
  }
  exists(rel) {
    const f = this.resolve(rel);
    return !!f && fs.statSync(f).isFile();
  }
  read(rel) {
    const f = this.resolve(rel);
    return f && fs.statSync(f).isFile() ? fs.readFileSync(f) : null;
  }
  list(dir) {
    const f = this.resolve(dir);
    try { return f ? fs.readdirSync(f) : []; } catch (_) { return []; }
  }
}

const cache = new Map();
function storeFor(dir) {
  if (!dir) return null;
  if (cache.has(dir)) return cache.get(dir);
  const pak = /\.pak$/i.test(dir) ? dir : path.join(dir, 'data.pak');
  const s = fs.existsSync(pak) ? new PakStore(pak) : new DirStore(dir);
  cache.set(dir, s);
  return s;
}

// crea data.pak a partire da una cartella dati
function buildPak(srcDir, outFile, subdirs = ['database', 'Image', 'system', 'pdf']) {
  const files = [];
  const walk = (abs, rel) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const a = path.join(abs, e.name), r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(a, r);
      else files.push([a, r]);
    }
  };
  for (const d of subdirs) if (fs.existsSync(path.join(srcDir, d))) walk(path.join(srcDir, d), d);
  // i database e i testi si comprimono molto bene (38 MB -> 3,4 MB); immagini già compresse restano invariate
  const COMPRESS = /\.(dat|html?|txt|css|js|json|xml)$/i;
  const index = {};
  const blobs = [];
  let off = 0;
  for (const [a, r] of files) {
    let b = fs.readFileSync(a);
    let gz = 0;
    if (COMPRESS.test(r)) { b = zlib.gzipSync(b, { level: 9 }); gz = 1; }
    index[r.toLowerCase()] = gz ? [off, b.length, 1] : [off, b.length];
    blobs.push(b);
    off += b.length;
  }
  const idx = Buffer.from(JSON.stringify(index), 'utf8');
  const head = Buffer.alloc(12);
  head.write(MAGIC, 0, 'latin1');
  head.writeUInt32LE(idx.length, 8);
  const fd = fs.openSync(outFile, 'w');
  fs.writeSync(fd, head);
  fs.writeSync(fd, idx);
  for (const b of blobs) fs.writeSync(fd, b);
  fs.closeSync(fd);
  return files.length;
}

function dropStore(dir) { const s = cache.get(dir); cache.delete(dir); try { if (s && s.fd != null) fs.closeSync(s.fd); } catch (_) {} }
module.exports = { storeFor, buildPak, PakStore, dropStore };
