'use strict';
// Libretti di uso e manutenzione (PDF Fiat) del Ducato 244 e del Nuovo Ducato X250
const P = require('./pages');
const { esc, contentHead, T, norm, snippet } = P._h;

const DOCS = [
  { id: 'u244', model: '244', title: 'Ducato 244 – Libretto di uso e manutenzione', short: 'Ducato 244', file: 'ducato244_uso_manutenzione.pdf' },
  { id: 'u250b', model: '250', title: 'Nuovo Ducato X250 – Libretto di uso e manutenzione (ed. 2012)', short: 'X250 ed. 2012', file: 'ducatoX250_uso_manutenzione_2012.pdf' },
  { id: 'u250a', model: '250', title: 'Nuovo Ducato X250 – Libretto di uso e manutenzione (ed. 2009)', short: 'X250 ed. 2009', file: 'ducatoX250_uso_manutenzione_2009.pdf' },
];
const TOPICS = [
  ['quadro', 'Quadro strumenti', '🧭'],
  ['spie', 'Spie e messaggi del quadro', '🚨'],
  ['emergenza', 'In emergenza', '🆘'],
  ['avviamento', 'Avviamento d\'emergenza / con batteria ausiliaria', '🔋'],
  ['ruota', 'Sostituzione di una ruota', '🛞'],
  ['kit', 'Kit di riparazione rapida pneumatici', '🧰'],
  ['lampade', 'Sostituzione lampade', '💡'],
  ['fusibili', 'Sostituzione fusibili', '⚡'],
  ['batteria', 'Ricarica della batteria', '🔌'],
  ['traino', 'Sollevamento e traino del veicolo', '🚚'],
  ['manut', 'Piano di manutenzione programmata', '🗓'],
  ['controlli', 'Controlli periodici', '✅'],
  ['livelli', 'Verifica dei livelli', '🛢'],
  ['spazzole', 'Spazzole tergicristallo', '🧽'],
  ['catene', 'Catene da neve', '❄'],
  ['pneumatici', 'Pressione di gonfiaggio pneumatici', '🎈'],
  ['rifornimenti', 'Rifornimenti', '⛽'],
  ['fluidi', 'Fluidi e lubrificanti', '🧴'],
  ['dati', 'Codici motori e versioni', '🏷'],
];
// argomenti delle pagine d'officina che hanno una pagina corrispondente nel libretto
const LINKS = [
  [/lampad|proiettor|fanal[ei]|plafonier/i, 'lampade'],
  [/fusibil|centralina (di )?derivazione|centralina vano motore/i, 'fusibili'],
  [/cerchi e pneumatici|pressione.*pneumatici/i, 'pneumatici'],
  [/rifornim|capacit/i, 'rifornimenti'],
  [/^prodotti|lubrificant|fluidi/i, 'fluidi'],
  [/manutenzione programmata|piano di manutenzione/i, 'manut'],
  [/^batteria$|ricarica.*batteri|batteria.*(descrizione|generalit|ricarica|controllo|stacco)/i, 'batteria'],
  [/^spie\b|quadro (di bordo|strumenti)/i, 'spie'],
  [/^tergi|spazzol/i, 'spazzole'],
  [/punti di (traino|sollevamento)/i, 'traino'],
  [/livello (olio|liquido)/i, 'livelli'],
];
const NOLINK = /^(briglia|negativo|positivo|massa|connettore|giunzione)|schema elettrico|localizzazione/i;

let data = null;
function D() { if (!data) data = require('./uem_data.json'); return data; }
let normCache = null;
function normPages() {
  if (!normCache) { normCache = {}; for (const [k, v] of Object.entries(D().pages)) normCache[k] = v.map((t) => norm(t)); }
  return normCache;
}
let ALL = null;
function all() {
  if (!ALL) ALL = DOCS.map((d) => ({ ...d, cat: 'uem', dir: 'uem' })).concat((D().ac || []).map((a) => ({ id: a.id, model: a.model, cat: 'ac', dir: 'ac', file: a.file, ac: a,
    title: `Kit aria condizionata Diavia – Ducato ${a.model === '250' ? 'X250' : '244'} ${a.eng} – ${a.tipo} (cod. ${a.code})`, short: `A/C ${a.eng.split(' (')[0]} · ${a.tipo.split(' – ')[1] || a.tipo}` })));
  return ALL;
}
const docsFor = (model, cat = 'uem') => all().filter((d) => d.model === String(model) && d.cat === cat);
const doc = (id) => all().find((d) => d.id === id) || all()[0];
const pdfUrl = (d, p) => `./app/${d.dir || 'uem'}/${d.file}${p ? '#page=' + p : ''}`;
const topicPage = (id, key) => (D().topics[id] || {})[key] || 0;
function linkFor(name) { if (NOLINK.test(name || '')) return null; for (const [re, k] of LINKS) if (re.test(name || '')) return k; return null; }

function searchHits(model, query) {
  const words = norm(query).split(/\s+/).filter((w) => w.length > 1);
  const res = [];
  if (!words.length) return res;
  const np = normPages();
  for (const d of all().filter((x) => x.model === String(model))) {
    (np[d.id] || []).forEach((t, i) => {
      let score = 0;
      for (const w of words) { const c = t.split(w).length - 1; if (!c) return; score += Math.min(c, 5); }
      res.push({ d, p: i + 1, score });
    });
  }
  return res.sort((a, b) => b.score - a.score || a.p - b.p);
}

// pagina del visore: PDF incorporato + argomenti + scarica
function viewPage(db, st, id, p, q) {
  const model = Math.floor((st.model || 0) / 1e6) === 250 ? '250' : '244';
  const want = all().find((x) => x.id === id);
  const docs = docsFor(want ? want.model : model, want ? want.cat : 'uem');
  const d = docs.find((x) => x.id === id) || docs[0];
  const isAc = d.cat === 'ac';
  const pg = +p || 1;
  let h = contentHead(db, st, 'DucatONE - Libretto uso e manutenzione') + T('content1');
  h += `<div class="uem"><div class="uemside">${isAc ? `<p><a href="ac.html">◀ Tutti i kit aria condizionata</a></p><h1>❄ ${esc(d.ac.eng)}</h1><p class="qnote">${esc(d.ac.tipo)}<br>Codice kit: <b>${esc(d.ac.code)}</b>${d.ac.gas ? `<br>Carica R134a: <b>${esc(d.ac.gas)} kg</b>` : ''}</p>` : '<h1>📕 Libretto di uso e manutenzione</h1>'}
${!isAc && docs.length > 1 ? `<div class="uemed">${docs.map((x) => `<a href="uem.html?d=${x.id}" class="${x.id === d.id ? 'sel' : ''}">${esc(x.short)}</a>`).join('')}</div>` : ''}
<form class="uemq" onsubmit="location.href='uem.html?d=${d.id}&q='+encodeURIComponent(this.q.value.trim());return false;"><input name="q" type="search" placeholder="Cerca nel libretto…" value="${esc(q || '')}"><button>Cerca</button></form>`;
  if (q) {
    const words = norm(q).split(/\s+/).filter((w) => w.length > 1);
    const hits = searchHits(d.model, q).filter((r) => r.d.id === d.id).slice(0, 40);
    h += `<div class="uemres"><b>${hits.length}</b> pagine con «${esc(q)}»${hits.map((r) => `<a href="#" data-p="${r.p}"><span>pag. ${r.p}</span>${snippet(D().pages[d.id][r.p - 1], words)}</a>`).join('')}</div>`;
  }
  h += `<div class="uemtop">${TOPICS.filter(([k]) => topicPage(d.id, k)).map(([k, t, ic]) => `<a href="#" data-p="${topicPage(d.id, k)}"><span>${ic}</span>${esc(t)}</a>`).join('')}</div>
<p class="uemdl"><a href="#" id="dl" class="gbtn">⬇ Scarica il PDF</a> <a href="${pdfUrl(d)}" target="_blank" class="gbtn lite">↗ Apri in una finestra</a></p>
<p class="qnote">${esc(d.title)} · ${D().pages[d.id].length} pagine. ${isAc ? 'Istruzioni Delphi Diavia in 5 lingue (IT, FR, EN, DE, ES): figure e testi riferiti ai componenti del kit.' : 'Il libretto descrive tutte le versioni e gli optional: considera solo quanto riguarda il tuo veicolo.'}</p></div>
<iframe id="pdf" class="uempdf" src="${pdfUrl(d, pg)}"></iframe></div>
<script>
var F=document.getElementById('pdf'),base=${JSON.stringify(pdfUrl(d))};
document.querySelectorAll('[data-p]').forEach(function(a){a.addEventListener('click',function(e){e.preventDefault();F.src='about:blank';setTimeout(function(){F.src=base+'#page='+a.dataset.p},30);document.querySelectorAll('[data-p]').forEach(function(x){x.classList.remove('sel')});a.classList.add('sel');});});
document.getElementById('dl').onclick=function(e){e.preventDefault();fetch('uemsave?d=${d.id}').then(function(r){return r.json()}).then(function(r){if(r.file)document.getElementById('dl').textContent='✔ Salvato: '+r.file;});};
</script></body></HTML>`;
  return h;
}

// ---------------------------------------------------------------- catalogo kit aria condizionata Diavia
function acPage(db, st, showAll) {
  const model = Math.floor((st.model || 0) / 1e6) === 250 ? '250' : '244';
  const list = all().filter((d) => d.cat === 'ac' && (showAll || d.model === model));
  let h = contentHead(db, st, 'DucatONE - Aria condizionata') + T('content1');
  h += `<div class="acpage"><h1>❄ Kit aria condizionata Delphi Diavia</h1>
<p class="ghint">Istruzioni di montaggio e manutenzione degli impianti A/C aftermarket Diavia per il ${showAll ? 'Ducato 244 e il Nuovo Ducato X250' : model === '250' ? 'Nuovo Ducato X250' : 'Ducato 244'} (valide anche per i gemelli Peugeot Boxer e Citroën Jumper indicati). ${showAll ? `<a href="ac.html">Solo il modello attuale</a>` : `<a href="ac.html?all=1">Mostra anche l'altro modello</a>`}</p>
<table class="gtab actab"><tr><th>Modello</th><th>Motore</th><th>Tipo di kit</th><th>Codice</th><th>Carica R134a</th><th>Pagine</th><th></th></tr>${list
    .map((d) => `<tr><td>${d.model === '250' ? 'X250' : '244'}</td><td>${esc(d.ac.eng)}</td><td>${esc(d.ac.tipo)}</td><td><b>${esc(d.ac.code)}</b></td><td>${d.ac.gas ? esc(d.ac.gas) + ' kg' : '—'}</td><td>${D().pages[d.id].length}</td><td style="white-space:nowrap"><a class="gbtn" href="uem.html?d=${d.id}">Apri</a> <a class="gbtn lite" href="#" data-dl="${d.id}">⬇ PDF</a></td></tr>`)
    .join('')}</table>
<div class="uemcheck"><h2>⚠ Prescrizioni obbligatorie per l'installatore (Diavia)</h2><ol>
<li>Verificare il corretto serraggio della bulloneria fornita e rimossa e di tutte le parti interessate al montaggio.</li>
<li>Verificare che non ci siano perdite d'acqua, olio e aria su motore, freni, servosterzo, servofreno.</li>
<li>Verificare tutti i livelli; se si rimuove il radiatore acqua ricaricare lo stesso liquido, rabboccare con l'anticongelante prescritto e spurgare l'aria come prescritto dal costruttore.</li>
<li>Controllare la tensione di tutte le cinghie e l'usura di quelle non sostituite.</li>
<li>Verificare che non ci siano interferenze in nessuna condizione di funzionamento e le distanze di sicurezza tra le parti in movimento.</li>
<li>Evitare sfregamenti tra le parti con corretto serraggio e posizionamento.</li>
<li>Controllare isolamento elettrico, fusibili e tutto l'impianto elettrico.</li>
<li>Dopo la carica del refrigerante cercare accuratamente eventuali perdite di gas.</li>
<li>Eseguire ogni operazione secondo le norme di buona tecnica.</li>
<li>Proteggere fori e tagli praticati con l'antiruggine fornito con l'impianto.</li></ol>
<p><b>Cinghie:</b> con A/C inserito, dopo circa 15 minuti di funzionamento ritensionare le cinghie; ripetere dopo 1.500 km dall'installazione. <b>Raccordi:</b> lubrificare raccordi e O-ring con olio refrigerante nuovo e serrare con due chiavi senza superare le coppie massime della tabella del manuale. Destra e sinistra sono riferite al senso di marcia (sinistra = lato guida).</p></div></div>
<script>document.querySelectorAll('[data-dl]').forEach(function(a){a.onclick=function(e){e.preventDefault();fetch('uemsave?d='+a.dataset.dl).then(function(r){return r.json()}).then(function(r){if(r.file)a.textContent='✔ Salvato';});};});</script></body></HTML>`;
  return h;
}

module.exports = { acPage, all, DOCS, TOPICS, docsFor, doc, searchHits, viewPage, linkFor, topicPage, pdfUrl, pageText: (id, p) => (D().pages[id] || [])[p - 1] || '' };
