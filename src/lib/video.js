'use strict';
// "Video guide": elenco letto da un Foglio Google (Categoria, Titolo, Link YouTube, Descrizione) con copia locale
const fs = require('fs');
const path = require('path');
const { parseCSV } = require('./ricambi');

const DEFAULT_URL = 'https://docs.google.com/spreadsheets/d/1rZTBpOuUeY-AaS22p5lXJnhCxm9vcRsU/edit?rtpof=true';
const DEMO = [
  { cat: 'Diagnosi', title: 'Spia motore accesa: cosa controllare (DEMO)', id: 'Q4e-Jz3Cvq4', desc: 'Video dimostrativo: compare finché l\'elenco online non è disponibile.' },
];

function ytId(u) {
  u = String(u || '').trim();
  if (/^[\w-]{11}$/.test(u)) return u;
  const m = /(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})/.exec(u);
  return m ? m[1] : '';
}

function toItems(rows) {
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...n) => head.findIndex((h) => n.some((x) => h.startsWith(x)));
  const ix = { cat: col('categoria'), title: col('titolo'), link: col('link', 'youtube', 'video', 'url'), desc: col('descrizione'), mezzo: col('mezzo', 'veicolo', 'serie'), ops: head.findIndex((h) => /operaz|procedur/.test(h)) };
  return rows
    .slice(1)
    .map((r) => {
      const g = (k) => (ix[k] >= 0 ? (r[ix[k]] || '').trim() : '');
      return { cat: g('cat') || 'Altri video', title: g('title'), id: ytId(g('link')), desc: g('desc'), ops: g('ops'), mezzo: g('mezzo') };
    })
    .filter((x) => x.id);
}

const decode = (s) =>
  s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// titolo e descrizione dal video YouTube (usati quando le celle del foglio sono vuote)
async function ytMeta(netFetch, id) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 7000);
  try {
    const r = await netFetch('https://www.youtube.com/watch?v=' + id + '&hl=it', {
      signal: ctl.signal,
      headers: { Cookie: 'CONSENT=YES+cb; SOCS=CAI', 'Accept-Language': 'it-IT,it;q=0.9' },
    });
    const h = await r.text();
    const meta = (p) => {
      const m = new RegExp('<meta\\s+(?:name|property)="' + p + '"\\s+content="([^"]*)"', 'i').exec(h);
      return m ? decode(m[1]) : '';
    };
    let desc = '';
    const sd = /"shortDescription":"((?:[^"\\]|\\.)*)"/.exec(h);
    if (sd) try { desc = JSON.parse('"' + sd[1] + '"'); } catch (_) {}
    desc = desc || meta('og:description') || meta('description');
    return { title: meta('og:title') || meta('title'), desc };
  } catch (_) {
    return {};
  } finally {
    clearTimeout(t);
  }
}

const short = (s, n) => {
  s = String(s || '').replace(/https?:\/\/\S+/g, '').replace(/[#][\wÀ-ÿ]+/g, '').replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const dot = cut.lastIndexOf('. ');
  return (dot > n * 0.5 ? cut.slice(0, dot + 1) : cut.replace(/\s+\S*$/, '') + '…');
};

async function load(netFetch, cacheDir, url) {
  url = url || DEFAULT_URL;
  const cacheFile = path.join(cacheDir, 'video-cache.json');
  let old = null;
  try { old = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (_) {}
  const known = new Map(((old && old.items) || []).map((x) => [x.id, x]));
  try {
    const items = toItems(await require('./sheet').fetchRows(netFetch, url));
    await Promise.all(
      items.map(async (it) => {
        if (it.title && it.desc) return;
        const k = known.get(it.id);
        let m = k && k.ytTitle ? { title: k.ytTitle, desc: k.ytDesc } : await ytMeta(netFetch, it.id);
        it.ytTitle = m.title || '';
        it.ytDesc = m.desc || '';
        if (!it.title) it.title = it.ytTitle || 'Video';
        if (!it.desc) it.desc = short(it.ytDesc, 260);
      })
    );
    const data = { items, updated: new Date().toISOString(), online: true };
    try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(data)); } catch (_) {}
    return data;
  } catch (e) {
    if (old) return { ...old, online: false, error: String(e.message || e) };
    return { items: DEMO, updated: null, online: false, demo: true, error: String(e.message || e) };
  }
}

module.exports = { load, ytId, toItems, short, DEFAULT_URL };
