'use strict';
// Statistiche anonime d'uso: un invio a un Modulo Google all'installazione, a ogni aggiornamento e al massimo una volta al giorno all'avvio.
// Dati inviati: codice casuale del PC, versione, evento, versione di Windows, lingua. Nessun dato personale.
const crypto = require('crypto');
const os = require('os');

// link precompilato del modulo (valori segnaposto A, B, C, D, E nelle 5 domande)
const FORM_PREFILL = 'https://docs.google.com/forms/d/e/1FAIpQLSflxmbcizPfTU9ZJlWHlavKdi8HxviZV4cXJMAuBLyWXK6KwA/viewform?usp=pp_url&entry.505657728=A&entry.764629140=B&entry.2070670241=C&entry.1480438365=D&entry.1161862710=E';

function parsePrefill(u) {
  try {
    const url = new URL(u);
    const m = /\/forms\/d\/e\/([\w-]+)\//.exec(url.pathname);
    if (!m) return null;
    const map = {};
    for (const [k, v] of url.searchParams) if (/^entry\.\d+$/.test(k)) map[v.trim().toUpperCase()] = k;
    if (!map.A) return null;
    return { action: `https://docs.google.com/forms/d/e/${m[1]}/formResponse`, map };
  } catch (_) {
    return null;
  }
}

function winName() {
  const r = os.release();
  if (process.platform !== 'win32') return `${process.platform} ${r}`;
  const build = +(r.split('.')[2] || 0);
  return `${build >= 22000 ? 'Windows 11' : /^10\./.test(r) ? 'Windows 10' : 'Windows ' + r} (${r}, ${os.arch()})`;
}

// decide l'evento da inviare oggi; restituisce null se non c'è nulla da inviare
function pending(settings, version) {
  if (settings.stats === false) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (!settings.statsId) return { ev: 'installazione', today };
  if (settings.statsVer && settings.statsVer !== version) return { ev: 'aggiornamento da ' + settings.statsVer, today };
  if (settings.statsDay !== today) return { ev: 'avvio', today };
  return null;
}

async function send(netFetch, settings, save, version, lang, log) {
  const p = pending(settings, version);
  if (!p) return;
  const cfg = parsePrefill(settings.statsUrl || FORM_PREFILL);
  if (!cfg) return;
  if (!settings.statsId) settings.statsId = crypto.randomBytes(6).toString('hex').toUpperCase();
  const vals = { A: settings.statsId, B: version, C: p.ev, D: winName(), E: lang || '' };
  const body = new URLSearchParams();
  for (const [ph, entry] of Object.entries(cfg.map)) if (vals[ph] != null) body.append(entry, vals[ph]);
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10000);
    const r = await netFetch(cfg.action, { method: 'POST', body: body.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    settings.statsDay = p.today;
    settings.statsVer = version;
    save();
    log && log('statistiche inviate:', p.ev);
  } catch (e) {
    save(); // conserva comunque il codice del PC; si riprova al prossimo avvio
    log && log('statistiche non inviate:', String(e.message || e));
  }
}

module.exports = { send, parsePrefill, pending, winName, FORM_PREFILL };
