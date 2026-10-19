'use strict';
// Ducato gamma 1986 (prima serie, "290"): manuale Fiat cartaceo scansionato, letto da ducato86.pak
const fs = require('fs');
const { PakStore } = require('./store');
const P = require('./pages');
const { T, withMeta, markCss, esc, contentHead, highlight, snippet, norm } = P._h;

const BASE = 86000000; // id numerico delle pagine (note e foto personali)
const ENG = [
  ['', 'Tutte le motorizzazioni'],
  ['b', '2000 benzina'],
  ['d19', '1900 Diesel / turbo D'],
  ['d25', '2500 Diesel / turbo D'],
  ['crd', '2500 Diesel C.R.D.'],
];

const SEC_COL = { '': '#7a8796', '00': '#4f6f8f', '10': '#2e7d6b', '18': '#c0703a', '21-27': '#d08a2c', '33': '#b8433a', '41': '#8a5a9e', '44': '#3f8f3f', '50': '#5d7fa8', '55': '#2f6fb0', '70': '#7c6a55', DE: '#9a7b2f' };
let cur = null;
function open(file) {
  if (cur && cur.file === file) return cur;
  const s = new PakStore(file);
  const idx = JSON.parse(s.read('meta/index.json').toString('utf8'));
  const byId = new Map(idx.nodes.map((n) => [n.id, n]));
  const kids = new Map();
  for (const n of idx.nodes) { if (!kids.has(n.p)) kids.set(n.p, []); kids.get(n.p).push(n); }
  const normPages = idx.pages.map((t) => norm(t || ''));
  cur = { file, s, idx, byId, kids, normPages, count: idx.count };
  return cur;
}
function close() { try { if (cur) require('fs').closeSync(cur.s.fd); } catch (_) {} cur = null; }
async function verify(file) { try { return await new PakStore(file).verify(); } catch (e) { return { entries: 0, bad: 1, error: e.message }; } }

const okEng = (n, eng) => !eng || !n.e || n.e.split(',').includes(eng);
const childrenOf = (d, id, eng) => (d.kids.get(id) || []).filter((n) => okEng(n, eng));
// nodo più profondo che contiene la pagina
function leafFor(d, p, eng) {
  let best = null;
  for (const n of d.idx.nodes) if (p >= n.a && p <= n.b && (!best || n.b - n.a < best.b - best.a || (n.b - n.a === best.b - best.a && n.p === best.id))) best = n;
  return best;
}
function pathTo(d, n) { const out = []; while (n) { out.unshift(n); n = d.byId.get(n.p); } return out; }
const lbl = (n) => (n.code && n.code !== 'DE' ? n.code + ' ' : '') + n.t;

function img(d, p, thumb) {
  const k = (thumb ? 'thumb/' : 'img/') + String(p).padStart(3, '0') + '.jpg';
  return d.s.read(k);
}

// ---------------------------------------------------------------- pagina principale (stessa impaginazione del 244)
function treeHtml(d, pid, curLeaf, pathIds, eng) {
  const list = childrenOf(d, pid, eng);
  if (!list.length) return '';
  let h = '<ul>';
  for (const k of list) {
    const leaf = !childrenOf(d, k.id, eng).length;
    const openN = pathIds.has(k.id) && !leaf;
    h += `<li class="${leaf ? 'lf' : openN ? 'op' : 'cl'}${curLeaf && k.id === curLeaf.id ? ' cur' : ''}" data-id="d${k.id}">${leaf ? '<i></i>' : '<i class="tg"></i>'}<a href="d86main.html?p=${k.a}" title="${esc(k.t)} (pag. ${k.a}${k.b > k.a ? '–' + k.b : ''})">${esc(k.t)}</a>${leaf ? '' : treeHtml(d, k.id, curLeaf, pathIds, eng)}</li>`;
  }
  return h + '</ul>';
}

function mainPage(db, st, d, p, o) {
  const css = markCss(db, st.mark);
  const eng = o.eng || '';
  const leaf = leafFor(d, p);
  const path = leaf ? pathTo(d, leaf) : [];
  const pathIds = new Set(path.map((n) => n.id));
  const sec = path[0];
  let h = withMeta(T('main0'));
  h += `\t\t<title>DucatONE - Ducato 1986 - ${esc(leaf ? leaf.t : '')}</title>\n\t\t<style>html,body{overflow:hidden;height:100%}</style>\n${T('script')}\t\t<link rel="stylesheet" type="text/css" href="${css.LINK}">\n`;
  h += T('main1');
  h += `<td class="toptd" align="right" colSpan="1" height="68">
         <A class="topbar" href="models.html" title="Torna alla pagina iniziale">Home page</A><span class="topbar">|</span>
         <a class="topbar" href="d86search.html" target="framemain" title="Cerca nel manuale 1986">Cerca</a><span class="topbar">|</span>
         <A class="topbar" href="#" title="Stampa la pagina visualizzata" onclick="printFrame(self.framemain);return false;">Stampa</A><span class="topbar">|</span>
         <A class="topbar" href="#" title="Salva la pagina visualizzata in PDF" onclick="exportPdf(self.framemain);return false;">Salva in Pdf</A><span class="topbar">|</span>
         <A class="topbar" href="guida.html" target="framemain" title="Guida all'uso di DucatONE">Aiuto</A><span class="topbar">|</span>
         <A class="topbar" href="#" title="Chiudi DucatONE" onclick="exitApp();return false;">Esci dal software</A>
      </td>`;
  h += T('main2');
  h += `<a class="backbtn" href="#" onclick="history.back();return false;" title="Torna alla pagina precedente">&#9664; Torna alla precedente</a>`;
  h += `<a class="path" href="d86main.html?p=1">Ducato 1986</a>` + path.map((n) => `<span class="separatore">&gt;</span><a class="path" href="d86main.html?p=${n.a}">${esc(lbl(n))}</a>`).join('');
  const favs = o.favs || [];
  h += `</span>
					</td>
				</tr>
				<tr height="50">
					<td class="colorechiaro" WIDTH="16" rowSpan="2">&nbsp;</td>
					<td valign="top" class="colorescuro" WIDTH="144" height="100">
						<div id="modelName"><A style="MARGIN-TOP:2px" class="cartype" href="d86main.html?p=1">Ducato gamma 1986</A></div>
						<select class="cartype" id="cmbEng" title="Mostra solo i capitoli della motorizzazione scelta" onchange="location.href='d86set?eng='+this.value+'&p=${p}'">${ENG.map(([v, t]) => `<option value="${v}"${v === eng ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>
						<div class="tools">
							<input class="qs" name="q" type="search" placeholder="Cerca nel manuale 1986…" title="Scrivi e premi Invio" onkeydown="if(event.key==='Enter'){event.preventDefault();if(this.value.trim())self.framemain.location.href='d86search.html?q='+encodeURIComponent(this.value.trim());}">
							<a class="tool" href="d86fav?p=${p}">${favs.includes(p) ? '★ Togli dai preferiti' : '☆ Aggiungi ai preferiti'}</a>
							<a class="tool" href="d86favs.html" target="framemain">♥ Preferiti (${favs.length})</a>
							<a class="tool" href="d86hist.html" target="framemain">🕘 Cronologia</a>
							<a class="tool" href="d86index.html" target="framemain">📑 Indice completo</a>
							<a class="tool" href="d86quick.html" target="framemain">⚡ Schede rapide</a>
							<a class="tool" href="d86tools.html" target="framemain">🧰 Attrezzatura specifica</a>
							<a class="tool" href="garage.html" target="framemain">📒 Libretto e manutenzione</a>
							<a class="tool" href="${esc(o.other || 'models.html')}">⇄ Passa al Ducato 244</a>
						</div>
					</td>
					<td class="colorescuro" WIDTH="610" vAlign="top" bgColor="white" rowSpan="3">
						<iframe id="framemain" name="framemain" style="LEFT: 0px; WIDTH: 99.8%; POSITION: relative; TOP: 0px; HEIGHT: 100%" frameborder="no" src="${o.frame || 'd86page.html?p=' + p}"></iframe>
					</td>
				</tr>
`;
  h += T('main3');
  for (const s of childrenOf(d, 0, eng)) {
    const sel = sec && sec.id === s.id;
    h += `
<tr>
   <td>
      <a class="${sel ? 'menulateraleIlivSel' : 'menulateraleIliv'}" style="display:block" href="d86main.html?p=${s.a}">${s.code === 'DE' ? '&nbsp;🇩🇪 ' : s.code ? '&nbsp;' + esc(s.code) + ' ' : '&nbsp;'}${esc(s.t)}</a>${sel ? `<div class="tree" data-cur="${p}">${treeHtml(d, s.id, leaf, pathIds, eng)}</div>` : ''}
   </td>
</tr>`;
  }
  h += `
<tr><td><div class="menusep"></div></td></tr>
<tr>
   <td>
      <a class="menulateraleIliv ricambi" style="display:block" href="ricambi.html?m=86" target="framemain">&nbsp;&nbsp;&nbsp;🛒 Ricambi online</a>
      <a class="menulateraleIliv ricambi video" style="display:block" href="video.html?m=86" target="framemain">&nbsp;&nbsp;&nbsp;▶ Video guide</a>
   </td>
</tr>`;
  h += T('main4');
  return h;
}

// ---------------------------------------------------------------- pagina del manuale (iframe)
function pagePage(db, st, d, p, o) {
  const leaf = leafFor(d, p);
  const path = leaf ? pathTo(d, leaf) : [];
  const title = leaf ? leaf.t : 'Pagina ' + p;
  const node = BASE + p;
  let h = contentHead(db, st, 'DucatONE - ' + title).replace('</title>', '</title>\n\t\t<meta name="elnode" content="' + esc('Ducato 1986 · ' + title + ' · pag. ' + p) + '">') + T('content1');
  const n = d.count;
  const nav = (cls) => `<div class="d86nav ${cls}">
  <a class="d86btn${p <= 1 ? ' dis' : ''}" href="d86main.html?p=${Math.max(1, p - 1)}" target="_parent" title="Pagina precedente (←)">◀ Precedente</a>
  <span class="d86pg">Pagina <b>${p}</b> di ${n}${leaf && leaf.b > leaf.a ? ` · ${esc(leaf.t)} ${p - leaf.a + 1}/${leaf.b - leaf.a + 1}` : ''}</span>
  <a class="d86btn${p >= n ? ' dis' : ''}" href="d86main.html?p=${Math.min(n, p + 1)}" target="_parent" title="Pagina successiva (→)">Successiva ▶</a>
</div>`;
  const sec = path[0] || {};
  const pm = (d.idx.printed || {})[sec.code] || {};
  const printed = pm[p];
  // segnalibri colorati delle sezioni (come i separatori del manuale cartaceo)
  h += `<div class="d86tabs">${childrenOf(d, 0, '').map((s) => `<a href="d86main.html?p=${s.a}" target="_parent" class="${s.id === sec.id ? 'on' : ''}" style="--c:${SEC_COL[s.code] || '#777'}" title="${esc(lbl(s))}">${esc(s.code || 'Intro')}</a>`).join('')}</div>`;
  h += `<h1 class="bigtext1 d86h" style="border-left:6px solid ${SEC_COL[sec.code] || '#777'};padding-left:8px">${esc(title)}</h1><div class="d86path">${path.slice(0, -1).map((x) => esc(lbl(x))).join(' › ')}${printed ? (sec.code === 'DE' ? ` · <span title="Numero stampato sul manuale tedesco">pag. ${printed} del manuale tedesco</span>` : ` · <span title="Numero stampato sul foglio originale">foglio ${esc(sec.code)} pag. ${printed}</span>`) : ''}</div>`;
  // rimandi ad altre pagine citati nel testo
  const refs = [];
  const inv = {};
  for (const [k, v] of Object.entries(pm)) if (!(v in inv)) inv[v] = +k;
  const txt0 = d.idx.pages[p] || '';
  for (const m of txt0.matchAll(/\bpag(?:ina|\.)?\s*(\d{1,3})\b/gi)) { const t = inv[+m[1]]; if (t && t !== p && !refs.some((r) => r.p === t)) refs.push({ p: t, l: 'pag. ' + m[1] }); }
  for (const m of txt0.matchAll(/\bsezione\s*(\d{2})\b/gi)) { const s2 = childrenOf(d, 0, '').find((x) => x.code === m[1] || x.code.startsWith(m[1] + '-')); if (s2 && !refs.some((r) => r.p === s2.a)) refs.push({ p: s2.a, l: 'sezione ' + m[1] }); }
  if (refs.length) h += `<div class="d86refs">↪ Rimandi in questa pagina: ${refs.map((r) => { const lf = leafFor(d, r.p); return `<a href="d86main.html?p=${r.p}" target="_parent">${esc(r.l)}${lf ? ' · ' + esc(lf.t) : ''}</a>`; }).join(' ')}</div>`;
  h += nav('top');
  const hot = ((d.idx.hot || {})[p] || []).filter((x) => x.p && /[a-zà-ù]{3}/i.test(x.t) && !/^DUCATO/i.test(x.t.trim()));
  h += `<div class="d86page"><div class="d86wrap"><img id="d86img" src="d86img?p=${p}" alt="Pagina ${p}" title="Clic per ingrandire (zoom, rotazione e stampa)">${hot
    .map((x) => { const two = /^[a-zà-ù]/.test(x.t.trim()); const y = two ? x.y - x.h * 1.5 : x.y, hh = two ? x.h * 2.5 : x.h; return `<a class="d86hot" href="d86main.html?p=${x.p}" target="_parent" style="left:${(x.x * 100).toFixed(2)}%;top:${(y * 100 - 0.3).toFixed(2)}%;width:${(x.w * 100).toFixed(2)}%;height:${(hh * 100 + 0.6).toFixed(2)}%" title="Vai a: ${esc(x.t)} (pag. ${x.n})"></a>`; })
    .join('')}</div>${hot.length ? '<div class="d86hint">👆 Indice cliccabile: passa con il mouse sulle voci e clicca per aprire la pagina.</div>' : ''}</div>`;
  h += nav('bot');
  // miniature del capitolo
  const grp = leaf && leaf.b > leaf.a ? leaf : path.length > 1 ? path[path.length - 2] : null;
  if (grp && grp.b > grp.a && grp.b - grp.a < 60) {
    h += `<div class="d86strip">`;
    for (let i = grp.a; i <= grp.b; i++) h += `<a href="d86main.html?p=${i}" target="_parent" class="${i === p ? 'cur' : ''}" title="Pagina ${i}"><img loading="lazy" src="d86img?p=${i}&t=1"><span>${i}</span></a>`;
    h += `</div>`;
  }
  const note = (st.notes || {})[node];
  h += `<div class="notebox${note ? ' has' : ''}" data-node="${node}">
<div class="nview"${note ? '' : ' style="display:none"'}><b>📝 La mia nota</b> <span class="ndate">${note ? esc(new Date(note.date).toLocaleDateString('it-IT')) : ''}</span> <a href="#" class="nedit">modifica</a><div class="ntext">${note ? esc(note.text).replace(/\n/g, '<br>') : ''}</div></div>
<a href="#" class="nadd"${note ? ' style="display:none"' : ''}>📝 Aggiungi una nota personale a questa pagina</a>
<div class="nform" style="display:none"><textarea rows="4" placeholder="Es. coppia verificata 25 Nm, ricambio usato, osservazioni…">${note ? esc(note.text) : ''}</textarea><br><button class="nsave">Salva nota</button> <button class="ncancel">Annulla</button> <button class="ndel">Elimina</button></div>
</div>`;
  h += `<div class="photobox" data-node="${node}">${(o.photos || [])
    .map((f) => `<span class="ph"><img src="userfoto?f=${encodeURIComponent(node + '/' + f)}" data-f="${esc(f)}" title="La tua foto · clic per ingrandire"><a href="#" class="phdel" title="Elimina foto">✕</a></span>`)
    .join('')}<a href="#" class="phadd" title="Allega a questa pagina foto scattate da te">📷 ${(o.photos || []).length ? 'Aggiungi foto' : 'Aggiungi le tue foto a questa pagina'}</a></div>`;
  const txt = d.idx.pages[p] || '';
  const q = (o.hl || '').trim();
  const words = q ? norm(q).split(/\s+/).filter((w) => w.length > 1) : [];
  if (txt && sec.code === 'DE') h = h.replace('<div class="notebox', `<div class="d86tr"><h3>🇮🇹 Traduzione italiana della pagina</h3><div class="trt">${(words.length ? highlight(txt, words) : esc(txt)).replace(/\n/g, '<br>')}</div><div class="trn">Traduzione in italiano del manuale di riparazione tedesco «Reparaturhandbuch Fiat Ducato» (pubblicazione di terzi, non Fiat). Figure, tabelle e schemi restano in tedesco nella scansione sopra; i rimandi «pag.» si riferiscono alla numerazione del manuale tedesco.</div></div>\n<div class="notebox`);
  else if (txt) h += `<details class="d86ocr"${words.length ? ' open' : ''}><summary>Testo della pagina (riconosciuto automaticamente, può contenere errori)</summary><pre>${words.length ? highlight(txt, words) : esc(txt)}</pre></details>`;
  h += `<script>
(function(){var im=document.getElementById('d86img');
im.onclick=function(){var t=document.querySelector('meta[name="elnode"]').content;var w=window.top.open('app/viewer.html?src='+encodeURIComponent(im.src)+'&t='+encodeURIComponent(t),'WinImg','width=1100,height=900,scrollbars=no');if(w)w.focus();};
document.addEventListener('keydown',function(e){if(e.target.closest('textarea,input'))return;if(e.key==='ArrowLeft'&&${p}>1)parent.location.href='d86main.html?p=${p - 1}';if(e.key==='ArrowRight'&&${p}<${n})parent.location.href='d86main.html?p=${p + 1}';});
var c=document.querySelector('.d86strip .cur'),sp=document.querySelector('.d86strip');if(c&&sp)sp.scrollLeft=c.offsetLeft-sp.offsetLeft-sp.clientWidth/2+c.offsetWidth/2;})();
</script>`;
  return h + '\n\t</body>\n</HTML>';
}

// ---------------------------------------------------------------- schede rapide
function quickPage(db, st, d) {
  let h = contentHead(db, st, 'DucatONE - Ducato 1986 - Schede rapide') + T('content1');
  h += `<h1 class="bigtext1">⚡ Schede rapide — Ducato 1986</h1><p class="contents_testonormale" style="color:#555">Le pagine più consultate in officina, raccolte per argomento. Clic per aprire la pagina originale del manuale.</p><div class="d86quick">`;
  for (const g of d.idx.quick || []) {
    h += `<div class="qk"><h3>${esc(g.i)} ${esc(g.t)}</h3>${g.l.map(([t, p]) => `<a href="d86main.html?p=${p}" target="_parent"><img loading="lazy" src="d86img?p=${p}&t=1"><span>${esc(t)}<small>pag. ${p}</small></span></a>`).join('')}</div>`;
  }
  return h + '</div>\n</body></HTML>';
}

// ---------------------------------------------------------------- attrezzatura specifica
function toolsPage(db, st, d) {
  let h = contentHead(db, st, 'DucatONE - Ducato 1986 - Attrezzatura') + T('content1');
  const tl = d.idx.tools || [];
  h += `<h1 class="bigtext1">🧰 Attrezzatura specifica Fiat — Ducato 1986</h1><p class="contents_testonormale" style="color:#555">${tl.length} attrezzi elencati nel manuale, con le pagine in cui vengono usati.</p>
<input type="search" class="compsearch" placeholder="Filtra per codice o descrizione…" oninput="var v=this.value.toLowerCase();document.querySelectorAll('.d86tool tr[data-k]').forEach(function(r){r.style.display=r.dataset.k.indexOf(v)>=0?'':'none'})" style="width:60%;padding:4px;margin:4px 0 8px">
<table class="d86tool"><tr><th>Codice</th><th>Descrizione</th><th>Sezione</th><th>Usato a pagina</th></tr>`;
  for (const t of tl) {
    const lf = leafFor(d, t.p), sec = lf ? pathTo(d, lf)[0] : null;
    h += `<tr data-k="${esc((t.c + ' ' + t.d).toLowerCase())}"><td><b>${esc(t.c)}</b></td><td>${esc(t.d)}</td><td><a href="d86main.html?p=${t.p}" target="_parent">${esc(sec ? lbl(sec) : '')}</a></td><td>${t.u.map((u) => { const l2 = leafFor(d, u); return `<a href="d86main.html?p=${u}" target="_parent" title="${esc(l2 ? l2.t : '')}">${u}</a>`; }).join(' ') || '—'}</td></tr>`;
  }
  return h + '</table>\n</body></HTML>';
}

// ---------------------------------------------------------------- indice completo
function indexPage(db, st, d, eng) {
  let h = contentHead(db, st, 'DucatONE - Ducato 1986 - Indice') + T('content1');
  h += `<h1 class="bigtext1">📑 Ducato gamma 1986 — indice del manuale</h1><p class="contents_testonormale" style="color:#555">${esc(d.idx.sub)} · ${d.count} pagine${eng ? ' · filtro: ' + esc((ENG.find((x) => x[0] === eng) || [])[1]) : ''}</p>`;
  const walk = (pid, lv) => {
    let o = '';
    for (const n of childrenOf(d, pid, eng)) {
      o += `<div class="d86ix lv${lv}"><a href="d86main.html?p=${n.a}" target="_parent">${esc(lbl(n))}</a><span>pag. ${n.a}${n.b > n.a ? '–' + n.b : ''}</span></div>` + walk(n.id, lv + 1);
    }
    return o;
  };
  return h + walk(0, 0) + '\n</body></HTML>';
}

// ---------------------------------------------------------------- ricerca nel testo OCR
const SYN = (w) => { const set = new Set([w]); try { for (const g of require('./synonyms')) if (g.includes(w)) g.forEach((x) => set.add(norm(x))); } catch (_) {} return [...set]; };
function searchHits(d, query) {
  const words = norm(query).split(/\s+/).filter((w) => w.length > 1);
  const res = [];
  if (!words.length) return res;
  for (let p = 1; p <= d.count; p++) {
    const leaf = leafFor(d, p);
    const head = norm(leaf ? pathTo(d, leaf).map((n) => n.t).join(' ') : '');
    const t = d.normPages[p];
    let score = 0, ok = true;
    for (const w of words) {
      const alts = SYN(w);
      const inH = alts.some((a) => head.includes(a)), c = alts.reduce((n, a) => n + t.split(a).length - 1, 0);
      if (!inH && !c) { ok = false; break; }
      score += (inH ? 5 : 0) + Math.min(c, 5);
    }
    if (ok) res.push({ p, score, leaf });
  }
  res.sort((a, b) => b.score - a.score || a.p - b.p);
  return res;
}
function searchPage(db, st, d, q) {
  const query = (q || '').trim();
  let h = contentHead(db, st, 'DucatONE - Ducato 1986 - Cerca') + T('content1');
  h += `<h1 class="bigtext1">🔎 Cerca nel manuale Ducato 1986</h1>
<form onsubmit="location.href='d86search.html?q='+encodeURIComponent(this.q.value.trim());return false;" style="margin:6px 0 10px"><input name="q" value="${esc(query)}" style="width:60%;padding:4px;font:10pt verdana" placeholder="Es. coppia serraggio testa, frizione, pompa iniezione…" autofocus> <button>Cerca</button></form>`;
  if (!query) return h + '<p class="contents_testonormale">Scrivi una o più parole: la ricerca avviene nel testo di tutte le pagine e nei titoli dei capitoli.</p></body></HTML>';
  const words = norm(query).split(/\s+/).filter((w) => w.length > 1);
  const res = searchHits(d, query);
  h += `<p class="contents_testonormale" style="font-size:8pt">↔ <a href="search.html?q=${encodeURIComponent(query)}">Cerca «${esc(query)}» anche nel manuale Ducato 244</a></p>`;
  h += `<p class="contents_testonormale"><b>${res.length}</b> pagine trovate per «${esc(query)}»</p>`;
  for (const r of res.slice(0, 150)) {
    const sn = snippet((d.idx.pages[r.p] || '').replace(/\s+/g, ' '), words);
    h += `<div class="d86res"><a href="d86main.html?p=${r.p}&hl=${encodeURIComponent(query)}" target="_parent"><img loading="lazy" src="d86img?p=${r.p}&t=1"></a><div><a class="nav" href="d86main.html?p=${r.p}&hl=${encodeURIComponent(query)}" target="_parent"><b>${esc(r.leaf ? r.leaf.t : 'Pagina ' + r.p)}</b></a> <span style="color:gray;font-size:8pt">pag. ${r.p}${r.leaf ? ' · ' + esc(pathTo(d, r.leaf)[0].t) : ''}</span><div class="sn">${sn}</div></div></div>`;
  }
  return h + '\n</body></HTML>';
}

// ---------------------------------------------------------------- preferiti / cronologia
function listPage(db, st, d, title, pages, empty) {
  let h = contentHead(db, st, 'DucatONE - Ducato 1986') + T('content1');
  h += `<h1 class="bigtext1">${esc(title)}</h1>`;
  if (!pages.length) return h + `<p class="contents_testonormale">${esc(empty)}</p></body></HTML>`;
  for (const p of pages) {
    const leaf = leafFor(d, p);
    h += `<div class="d86res"><a href="d86main.html?p=${p}" target="_parent"><img loading="lazy" src="d86img?p=${p}&t=1"></a><div><a class="nav" href="d86main.html?p=${p}" target="_parent"><b>${esc(leaf ? leaf.t : 'Pagina ' + p)}</b></a> <span style="color:gray;font-size:8pt">pag. ${p}${leaf ? ' · ' + esc(pathTo(d, leaf)[0].t) : ''}</span></div></div>`;
  }
  return h + '\n</body></HTML>';
}

// ---------------------------------------------------------------- scaricamento dati
function getPage(state, upd) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>DucatONE - Ducato 1986</title><link rel="stylesheet" href="./app/fix.css"><script src="./app/i18n.js"></script><style>
body{margin:0;font:10pt Verdana,sans-serif;background:#eef3fa;color:#123}
.box{max-width:560px;margin:60px auto;background:#fff;border-radius:8px;box-shadow:0 4px 20px rgba(0,40,100,.15);padding:24px 28px;border-top:5px solid #fb6705}
h1{font-size:15pt;color:#004594;margin:0 0 8px} .bar{height:14px;background:#dde6f2;border-radius:7px;overflow:hidden;margin:16px 0 6px} .bar i{display:block;height:100%;width:0;background:#fb6705;transition:width .3s}
button,a.b{background:#004594;color:#fff;border:0;border-radius:4px;padding:8px 16px;font:bold 10pt Verdana;cursor:pointer;text-decoration:none;display:inline-block;margin-top:10px} button:hover,a.b:hover{background:#fb6705}
.er{color:#b00020;margin-top:10px} .sm{color:#667;font-size:8.5pt}
</style></head><body><div class="box"><h1>Ducato gamma 1986 (prima serie)</h1>
${upd ? '<p><b>È disponibile un aggiornamento del manuale Ducato 1986</b>: pagine più nitide, indici cliccabili, schede rapide e il manuale di riparazione tradotto in italiano. Il pacchetto (circa 110 MB) si scarica una sola volta.</p>' : '<p>Il manuale di assistenza tecnica del Ducato 1986 è un pacchetto aggiuntivo di circa <b>110 MB</b>. Va scaricato una sola volta, poi funziona anche senza internet.</p>'}
<div id="st">${state && state.error ? `<div class="er">Scaricamento non riuscito: ${esc(state.error)}</div>` : ''}</div>
<div class="bar"><i id="pb"></i></div><div class="sm" id="pt">&nbsp;</div>
<button id="go">⬇ ${upd ? 'Aggiorna' : 'Scarica'} il manuale Ducato 1986</button> ${upd ? '<a class="b" href="d86skip" style="background:#667">Usa la versione attuale</a>' : '<a class="b" href="models.html" style="background:#667">Torna alla home</a>'}
<p class="sm" style="margin-top:16px">In alternativa copia il file <b>ducato86.pak</b> nella cartella dati del programma e riapri DucatONE.</p></div>
<script>
var go=document.getElementById('go'),pb=document.getElementById('pb'),pt=document.getElementById('pt');
function poll(){fetch('d86get?status=1').then(function(r){return r.json()}).then(function(s){
 if(s.done){pt.textContent='Completato!';pb.style.width='100%';setTimeout(function(){location.href='d86main.html?p=1'},500);return}
 if(s.error){document.getElementById('st').innerHTML='<div class="er">Scaricamento non riuscito: '+s.error+'</div>';go.disabled=false;go.textContent='↻ Riprova';return}
 if(s.running){var pc=s.total?Math.round(s.got/s.total*100):0;pb.style.width=pc+'%';pt.textContent=(s.got/1048576).toFixed(1)+' MB di '+(s.total/1048576||110).toFixed(1)+' MB ('+pc+'%)';}
 setTimeout(poll,400)})}
go.onclick=function(){go.disabled=true;go.textContent='Scaricamento in corso…';fetch('d86get?start=1').then(poll)};
</script></body></html>`;
}

module.exports = { searchHits, open, close, verify, mainPage, pagePage, quickPage, toolsPage, ENG, SEC_COL, childrenOf, pathTo, indexPage, searchPage, listPage, getPage, img, leafFor, BASE };
