'use strict';
// "Ricambi online": elenco letto da un Foglio Google (CSV) aggiornabile dal gestore, con copia locale per l'uso offline
const fs = require('fs');
const path = require('path');

const DEFAULT_URL = 'https://docs.google.com/spreadsheets/d/1IJXX5RCdCCakldQV06BGO0fu_q0r4RIu/edit?rtpof=true';

// esempio mostrato finché il foglio non è raggiungibile
const DEMO = [
  { cat: 'Filtri', code: 'DEMO-001', name: 'Filtro olio motore 2.8 JTD (demo)', desc: 'Prodotto dimostrativo: compare finché il foglio online non è disponibile.', price: '12,90', link: 'https://www.google.com/search?q=filtro+olio+ducato+2.8+jtd', img: '' },
];

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
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

function toItems(rows) {
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names) => head.findIndex((h) => names.some((n) => h.startsWith(n)) && !/operaz|procedur/.test(h));
  const ops = head.findIndex((h) => /operaz|procedur/.test(h));
  const ix = {
    ops, cat: col('categoria'), code: col('codice'), name: col('nome'), desc: col('descrizione'),
    price: col('prezzo'), link: col('link'), img: col('immagine'), mezzo: col('mezzo', 'veicolo', 'serie'),
  };
  return rows.slice(1).map((r) => {
    const g = (k) => (ix[k] >= 0 ? (r[ix[k]] || '').trim() : '');
    return { cat: g('cat') || 'Altri ricambi', code: g('code'), name: g('name'), desc: g('desc'), price: g('price'), link: g('link'), img: g('img'), ops: g('ops'), mezzo: g('mezzo') };
  }).filter((x) => x.name);
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const dec = (s) => s.replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/').replace(/&quot;/g, '"');

async function get(netFetch, u, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await netFetch(u, { signal: ctl.signal, redirect: 'follow', headers: { 'User-Agent': UA, 'Accept-Language': 'it-IT,it;q=0.9' } });
  } finally {
    clearTimeout(t);
  }
}

// cerca l'immagine principale dell'inserzione (og:image, twitter:image, schema.org, Amazon) e la salva come anteprima
// scarica un'immagine e la restituisce come data: URI (piccola) o null
async function imgData(netFetch, img, min) {
  try {
    const ir = await get(netFetch, img, 8000);
    const type = (ir.headers.get('content-type') || '').split(';')[0];
    if (!ir.ok || !/^image\//.test(type)) return null;
    const buf = Buffer.from(await ir.arrayBuffer());
    if (buf.length < (min || 0)) return null;
    return buf.length < 350000 ? `data:${type};base64,${buf.toString('base64')}` : img;
  } catch (_) {
    return null;
  }
}

async function thumbFor(netFetch, link) {
  // Amazon: pagina "pulita" del prodotto e, se blocca la lettura, immagine dal codice ASIN
  const asin = /amazon\.[a-z.]+\/(?:.*\/)?(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i.exec(link);
  if (asin) {
    const host = /^(https?:\/\/[^/]+)/.exec(link)[1];
    const t = await thumbPage(netFetch, `${host}/dp/${asin[1].toUpperCase()}`);
    if (t) return t;
    for (const u of [`https://images-na.ssl-images-amazon.com/images/P/${asin[1].toUpperCase()}.01.LZZZZZZZ.jpg`, `https://ws-eu.amazon-adsystem.com/widgets/q?_encoding=UTF8&ASIN=${asin[1].toUpperCase()}&Format=_SL250_&ID=AsinImage&MarketPlace=IT&ServiceVersion=20070822&WS=1`]) {
      const d = await imgData(netFetch, u, 1000);
      if (d) return d;
    }
    return '';
  }
  return thumbPage(netFetch, link);
}

async function thumbPage(netFetch, link) {
  try {
    const r = await get(netFetch, link, 8000);
    if (!r.ok) return '';
    const h = (await r.text()).slice(0, 800000);
    const pick = [
      /<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i,
      /"hiRes"\s*:\s*"(https:[^"]+)"/,
      /data-old-hires=["'](https:[^"']+)["']/i,
      /id=["']landingImage["'][^>]*src=["'](https:[^"']+)["']/i,
      /"image"\s*:\s*\[?\s*"(https?:[^"]+)"/,
      /<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/i,
    ];
    let img = '';
    for (const re of pick) { const m = re.exec(h); if (m) { img = dec(m[1]); break; } }
    if (!img) return '';
    img = new URL(img, r.url || link).href;
    // copia locale piccola (funziona anche offline e con i siti che bloccano il collegamento diretto)
    return (await imgData(netFetch, img)) || img;
  } catch (_) {
    return '';
  }
}

async function load(netFetch, cacheDir, url) {
  url = url || DEFAULT_URL;
  const cacheFile = path.join(cacheDir, 'ricambi-cache.json');
  try {
    const items = toItems(await require('./sheet').fetchRows(netFetch, url));
    let old = null;
    try { old = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (_) {}
    const known = new Map(((old && old.items) || []).filter((x) => x.link && (x.thumb || Date.now() - (x.thumbTry || 0) < 6 * 36e5)).map((x) => [x.link, x]));
    // anteprima presa dalla pagina dell'inserzione quando la colonna Immagine è vuota
    await Promise.all(
      items.map(async (it) => {
        if (it.img || !/^https?:\/\//i.test(it.link)) return;
        const k = known.get(it.link);
        if (k) { it.thumb = k.thumb || ''; it.thumbTry = k.thumbTry; return; }
        it.thumb = (await thumbFor(netFetch, it.link)) || '';
        it.thumbTry = Date.now();
      })
    );
    const data = { items, updated: new Date().toISOString(), online: true };
    try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(data)); } catch (_) {}
    return data;
  } catch (e) {
    try {
      const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      return { ...c, online: false, error: String(e.message || e) };
    } catch (_) {
      return { items: DEMO, updated: null, online: false, demo: true, error: String(e.message || e) };
    }
  }
}

module.exports = { load, parseCSV, toItems, thumbFor, DEFAULT_URL };
