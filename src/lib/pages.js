'use strict';
// Generazione delle pagine HTML, ricalcata sui modelli originali (Web\html\*.ehtm)
// e sulle routine di eLearn.exe (GeneraPaginaHome, GeneraPaginaModels, ...).
const fs = require('fs');
const path = require('path');
const SaxonJS = require('saxon-js');

const WEB = path.join(__dirname, '..', 'web');
const tplCache = {};
const T = (n) => (tplCache[n] ??= fs.readFileSync(path.join(WEB, 'tpl', n + '.html'), 'utf8'));

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const jsq = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const HEAD_EXTRA = '<meta charset="utf-8"><link rel="stylesheet" type="text/css" href="./app/fix.css"><script src="./app/glossario.js"></script><script src="./app/i18n.js"></script><script src="./app/compat.js"></script>';
const withMeta = (html) => html.replace(/<HEAD>/i, (m) => m + '\n\t\t' + HEAD_EXTRA);

function markCss(db, markId) {
  const m = (db && db.marks.find((x) => x.ID === markId)) || { LINK: './css/fiat.css', LINKCONT: './css/contents_fiat.css' };
  return m;
}

// ---------------------------------------------------------------- XSLT
const sefCache = {};
function sef(name) {
  return (sefCache[name] ??= JSON.parse(fs.readFileSync(path.join(WEB, 'xsl', name + '.sef.json'), 'utf8')));
}
function transform(xslName, xml, params) {
  try {
    const res = SaxonJS.transform(
      {
        stylesheetInternal: sef(xslName),
        sourceText: xml,
        destination: 'serialized',
        stylesheetParams: params,
      },
      'sync'
    );
    return res.principalResult || '';
  } catch (e) {
    return `<p class="err_msg">${esc(e.message)}</p>`;
  }
}
const bodyOf = (html) => {
  const m = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  return m ? m[1] : html.replace(/<!DOCTYPE[^>]*>/i, '');
};

// Riscrive i riferimenti interni (REFNODEID, schemazoompre.aspx, backslash...)
function fixLinks(html, fromNode) {
  html = html.replace(/(href|src)="([^"]*)"/gi, (all, attr, v) => {
    let u = v;
    try {
      u = decodeURIComponent(v);
    } catch (_) {}
    u = u.trim();
    if (attr.toLowerCase() === 'src' || /^\.\\/.test(u)) u = u.replace(/\\/g, '/');
    u = u.replace(/REFNODEID(\d+)/g, (_, id) => `main.html?node=${id}${fromNode ? '&from=' + fromNode : ''}`);
    u = u.replace(/schemazoompre\.aspx\?xmlID=(\d+)/g, 'zoom.html?xml=$1');
    if (/^REFNODEID$|^REFPDFDOC/.test(u)) u = '#';
    if (/^javascript:/i.test(u)) u = u.replace(/[\r\n\t]+/g, ' ');
    return `${attr}="${u.replace(/"/g, '&quot;')}"`;
  });
  return html;
}

// ---------------------------------------------------------------- HOME (scelta marca)
function homePage() {
  const marks = `
													<td><a id="imgFiat" title="Fiat" href="models.html?mark=1"><img border="0" src=".\\images\\marca3.jpg"></a></td>
													<td><a id="imgPeugeot" title="Peugeot" href="models.html?mark=3"><img border="0" src=".\\images\\marca4.jpg"></a></td>
													<td><a id="imgCitroen" title="Citroën" href="models.html?mark=2"><img border="0" src=".\\images\\marca5.jpg"></a></td>
`;
  return withMeta(T('homepage0')).replace('<HEAD>', '<HEAD><title>DucatONE</title>').replace(/<BODY /i, '<BODY class="home" ') + marks + T('homepage1');
}

// ---------------------------------------------------------------- MODELLI
function modelsPage(db, st, langs) {
  const css = markCss(db, st.mark);
  let h = withMeta(T('models0'));
  h += `\t\t<title>DucatONE</title>\n\t\t<link rel="stylesheet" type="text/css" href="${css.LINK}">\n` + T('script');
  let m1 = T('models1');
  // titolo pagina nella barra scura
  m1 = m1.replace(
    /(<TD class="colorescuro" colSpan="2" height="33">)&nbsp;/,
    `$1<span class="titolopagina" style="color:white;font-size:11px;font-weight:bold;font-family:verdana;margin-left:6px">${esc(db.str(13))}</span>`
  );
  // combo lingua (nell'originale era un controllo VB sovrapposto)
  const opts = db.languages
    .map((l) => {
      const ok = langs.includes(l.ID);
      return `<option value="${l.ID}"${l.ID === st.lang ? ' selected' : ''}${ok ? '' : ' disabled'}>${esc(l.NAME)}</option>`;
    })
    .join('');
  m1 = m1.replace(
    /(<span id="lblLingua"[^>]*>)Scegli la lingua(<\/span>)\s*&nbsp;/,
    `$1${esc(db.str(12))}$2<br><select class="cartype" id="cmbLanguage" style="margin-top:6px" onchange="location.href='setlang?lang='+this.value">${opts}</select>`
  );
  h += m1;
  h += esc(db.str(22));
  h += T('models2');
  const models = db.models.filter((m) => m.MARK_ID === st.mark);
  if (!models.length) h += `<td style="font-size:8pt;font-family:verdana">${esc(db.str(20))}</td>`;
  h += `
		<TD align="middle" colspan="${Math.max(1, models.length)}" style="padding-bottom:18px">
			<div class="brands">
				<a href="selmodel?model=${(models[0] || {}).ID}" title="Apri il manuale"><img src="./app/brand-fiat.png" alt="Fiat"><span>Fiat <b>Ducato</b></span></a>
				<a href="selmodel?model=${(models[0] || {}).ID}" title="Apri il manuale"><img src="./app/brand-peugeot.png" alt="Peugeot"><span>Peugeot <b>Boxer</b></span></a>
				<a href="selmodel?model=${(models[0] || {}).ID}" title="Apri il manuale"><img src="./app/brand-citroen.png" alt="Citroën"><span>Citroën <b>Jumper</b></span></a>
			</div>
		</TD></tr><tr>`;
  models.forEach((m, i) => {
    const img = (db.modelImages.find((x) => x.ID === m.ID && x.LANGUAGE_ID === st.lang) || {}).IMAGE_LINK;
    const src = img ? img : './app/ducato.jpg';
    h += `
		<TD align="middle">
         <div class="mrow"><div class="mcard">
         <span><a id="MLC_modelList_ctl${i}_ImageLink" href="selmodel?model=${m.ID}"><img border="0" id="itemImage" src="${esc(src)}" /> </a>
         <br><a id="MLC_modelList_ctl${i}_NameLink" class="nomiMacchine" href="selmodel?model=${m.ID}" style="font-size:12px;">${esc(m.NAME)}</a></span>
         <div class="m86sub">Serie 244 · 2002–2006</div>
         <a class="clickhint" href="selmodel?model=${m.ID}"><span class="ar">⬆</span> Clicca sull'immagine per aprire il manuale <span class="ar">⬆</span></a></div>${i === 0 ? `<div class="mcard m86">
         <span><a href="d86main.html?p=1" title="Ducato gamma 1986 - prima serie (290)"><img border="0" id="itemImage86" src="./app/ducato86.jpg" /> </a>
         <br><a class="nomiMacchine" href="d86main.html?p=1" style="font-size:12px;">DUCATO 1986</a></span>
         <div class="m86sub">1ª serie (290) · 1900 / 2000 / 2500</div>
         <a class="clickhint" href="d86main.html?p=1"><span class="ar">⬆</span> ${st.d86 ? 'Clicca per aprire il manuale' : 'Nuovo! Clicca per scaricarlo'} <span class="ar">⬆</span></a></div><div class="mcard m86">
         <span><a href="selmodel?model=250000000" title="Nuovo Ducato X250"><img border="0" id="itemImage86" src="./app/ducato250.jpg" /> </a>
         <br><a class="nomiMacchine" href="selmodel?model=250000000" style="font-size:12px;">NUOVO DUCATO X250</a></span>
         <div class="m86sub">Serie X250 · 2.2 / 2.3 / 3.0 JTD</div>
         <a class="clickhint" href="selmodel?model=250000000"><span class="ar">⬆</span> ${st.x250 ? 'Clicca per aprire il manuale' : 'Nuovo! Clicca per scaricarlo'} <span class="ar">⬆</span></a></div>` : ''}</div>${i === 0 ? maintBanner(db, st) + recentBlock(db, st, m.ID) : ''}
		</TD>`;
  });
  h += T('models3');
  const news = db.modelImages.filter((x) => x.LANGUAGE_ID === st.lang && x.AGGIORNAMENTO).map((x) => x.AGGIORNAMENTO);
  h += '<div class="timeline">' + require('./changelog').map((c, i) =>
    `<div class="tl${i === 0 ? ' new' : ''}"><span class="dot"></span><span class="tv">v${esc(c.v)}</span>${c.d ? `<span class="td">${esc(c.d)}</span>` : ''}<div class="tt">${esc(c.t)}</div></div>`).join('') + '</div>';
  h += `<div class="newsorig">${news.length ? news.map(esc).join('<br>') : esc(db.str(21))}</div>`;
  h += T('models4');
  return h;
}

// ---------------------------------------------------------------- PAGINA PRINCIPALE
function topBar(st) {
  return `<td class="toptd" align="right" colSpan="1" height="68">
         <A class="topbar" href="models.html" title="Torna alla pagina iniziale">Home page</A><span class="topbar">|</span>
         <a id="BannerSearch" class="topbar" href="search.html" target="framemain" title="Cerca nel manuale">Cerca</a><span class="topbar">|</span>
         <A class="topbar" href="#" title="Stampa la pagina visualizzata" onclick="printFrame(self.framemain);return false;">Stampa</A><span class="topbar">|</span>
         <A class="topbar" href="#" title="Salva la pagina visualizzata in PDF" onclick="exportPdf(self.framemain);return false;">Salva in Pdf</A><span class="topbar">|</span>
         <A class="topbar" href="guida.html" target="framemain" title="Guida all'uso di DucatONE">Aiuto</A><span class="topbar">|</span>
         <A class="topbar" href="#" title="Chiudi DucatONE" onclick="exitApp();return false;">Esci dal software</A>
      </td>`;
}

function label(e) {
  return (e.CODE ? e.CODE + ' ' : '') + e.NAME;
}

function breadcrumb(db, nodeId) {
  return db
    .pathTo(nodeId)
    .map((e) => `<a class="path" href="main.html?node=${e.ID}">${esc(label(e))}</a>`)
    .join('<span class="separatore">&gt;</span>');
}

function mainPage(db, st, nodeId, from) {
  const css = markCss(db, st.mark);
  const model = db.models.find((m) => m.ID === st.model) || db.models[0] || { NAME: '' };
  const curSec = db.sectionOf.get(nodeId);

  let h = withMeta(T('main0'));
  h += `\t\t<title>DucatONE - ${esc((db.elements.get(nodeId) ? label(db.elements.get(nodeId)) : ''))}</title>\n\t\t<style>html,body{overflow:hidden;height:100%}</style>\n${T('script')}\t\t<link rel="stylesheet" type="text/css" href="${css.LINK}">\n`;
  h += T('main1');
  h += topBar(st);
  h += T('main2');
  h += `<a class="backbtn" href="#" onclick="history.back();return false;" title="Torna alla pagina precedente">&#9664; Torna alla precedente</a>`;
  h += breadcrumb(db, nodeId);
  h += `</span>
					</td>
				</tr>
				<tr height="50">
					<td class="colorechiaro" WIDTH="16" rowSpan="2">&nbsp;</td>
					<td valign="top" class="colorescuro" WIDTH="144" height="100">
						<div id="modelName"><A style="MARGIN-TOP:2px" class="cartype" href="#">${esc(model.NAME)}</A></div>
						<select class="cartype" id="cmbVal" onchange="location.href='setval?val='+this.value+'&node=${nodeId}'">${db.validities
              .map((v) => `<option value="${v.ID}"${v.ID === st.val ? ' selected' : ''}>${esc(v.NAME)}</option>`)
              .join('')}</select><br>
						<select class="cartype" id="cmbProd" onchange="location.href='setprod?prod='+this.value+'&node=${nodeId}'">${db
              .productionsFor(st.val)
              .map((p) => `<option value="${p.ID}"${p.ID === st.prod ? ' selected' : ''}>${esc(p.NAME)}</option>`)
              .join('')}</select>
						<div class="tools">
							<input class="qs" name="q" type="search" placeholder="Cerca parola o codice…" title="Scrivi e premi Invio" onkeydown="if(event.key==='Enter'){event.preventDefault();if(this.value.trim())self.framemain.location.href='search.html?q='+encodeURIComponent(this.value.trim());}">
							<a class="tool" href="favtoggle?node=${nodeId}">${(st.favs || []).includes(nodeId) ? '★ Togli dai preferiti' : '☆ Aggiungi ai preferiti'}</a>
							<a class="tool" href="favorites.html" target="framemain">♥ Preferiti (${(st.favs || []).length})</a>
							<a class="tool" href="history.html" target="framemain">🕘 Cronologia</a>
							<a class="tool" href="quick.html" target="framemain">⚡ Schede rapide</a>
							<a class="tool" href="tools.html" target="framemain">🧰 Strumenti</a>
							<a class="tool" href="garage.html" target="framemain">📒 Libretto e manutenzione</a>
							<a class="tool" href="uem.html" target="framemain">📕 Libretto uso e manutenzione</a>
							<a class="tool" href="ac.html" target="framemain">❄ Kit aria condizionata</a>
							<a class="tool" href="d86main.html?p=1">⇄ Passa al Ducato 1986</a>
						</div>
					</td>
					<td class="colorescuro" WIDTH="610" vAlign="top" bgColor="white" rowSpan="3">
						<iframe id="framemain" name="framemain" style="LEFT: 0px; WIDTH: 99.8%; POSITION: relative; TOP: 0px; HEIGHT: 100%" frameborder="no" src="${st.openFrame ? st.openFrame : `content.html?node=${nodeId}${from ? '&from=' + from : ''}`}"></iframe>
					</td>
				</tr>
`;
  h += T('main3');
  for (const s of db.sections) {
    const sel = curSec && curSec.ID === s.ID;
    const ind = '&nbsp;'.repeat(Math.max(0, Math.round((s.INDENT || 0) / 2)));
    h += `
<tr>
   <td>
      <a class="${sel ? 'menulateraleIlivSel' : 'menulateraleIliv'}" style="display:block"${
      s.CLICCABLE ? ` href="main.html?node=${s.ROOT_ELEM_ID}"` : ''
    }>${ind}${esc(s.NAME)}</a>${sel ? `<div class="tree" data-cur="${nodeId}">${treeHtml(db, st, s.ROOT_ELEM_ID, nodeId)}</div>` : ''}
   </td>
</tr>`;
  }
  h += `
<tr><td><div class="menusep"></div></td></tr>
<tr>
   <td>
      <a class="menulateraleIliv ricambi" style="display:block" href="ricambi.html" target="framemain">&nbsp;&nbsp;&nbsp;🛒 Ricambi online${st.newCounts && st.newCounts.ric ? ` <span class="newb">${st.newCounts.ric} nuovi</span>` : ''}</a>
      <a class="menulateraleIliv ricambi video" style="display:block" href="video.html" target="framemain">&nbsp;&nbsp;&nbsp;▶ Video guide${st.newCounts && st.newCounts.vid ? ` <span class="newb">${st.newCounts.vid} nuovi</span>` : ''}</a>
   </td>
</tr>`;
  h += T('main4');
  return h;
}

// ---------------------------------------------------------------- CONTENUTI (iframe)
function contentHead(db, st, title) {
  const css = markCss(db, st.mark);
  return (
    withMeta(T('content0')) +
    `\t\t<title>${esc(title || 'eLearn - Contents')}</title>
		<link rel="stylesheet" type="text/css" media="screen" href="./css/contents.css">
		<link rel="stylesheet" type="text/css" href="${css.LINKCONT}">
		<link rel="stylesheet" type="text/css" media="print" href="./css/contents_print.css">
		<script src="./svgscript/mysvg.js"></script>
`
  );
}

function isSchemaGroup(db, id) {
  const e = db.elements.get(id);
  if (!e || e.LAYOUT !== 1 || db.xmlByEl.has(id)) return false;
  const ch = db.children.get(id) || [];
  return ch.length > 0 && ch.every((c) => db.xmlByEl.has(c.ID) && !(db.children.get(c.ID) || []).length);
}

function schemaTabLabel(db, parent, child) {
  let n = child.NAME;
  if (parent && n.toUpperCase().startsWith(parent.NAME.toUpperCase())) n = n.slice(parent.NAME.length).trim();
  if (!n) {
    const x = (db.xmlByEl.get(child.ID) || [])[0];
    const m = x && /<bigtext1>([^<]*)<\/bigtext1>/.exec(x.VALUE_XML);
    n = m ? m[1] : child.NAME;
  }
  return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
}

function errorPage(db, st, nodeId, msgId) {
  const sec = db.sectionOf.get(nodeId) || db.sections[0];
  return (
    withMeta(T('verror0')).replace(/<form[^>]*>/, '<form name="VrNav_ErrorPage">') +
    esc(db.str(msgId || 15)) +
    `</span></P><P><span class="err_msg">${esc(db.str(16))}</span>&nbsp;<P><a class="contents_link" href="main.html?node=${
      sec ? sec.ROOT_ELEM_ID : ''
    }" target="_parent">${esc(sec ? sec.NAME : '')}` +
    T('verror1')
  );
}

function renderXmlList(db, st, list, xslName, fromNode) {
  let out = '';
  for (const x of list) {
    const all = !!x.ALL_CODEP;
    if (!all) out += `<p><b>${esc(db.str(18))}${esc(db.codepNames(db.xmlCodep.get(x.ID)))}</b></p>`;
    out += bodyOf(
      transform(xslName, x.VALUE_XML, {
        linkUrl: '',
        codep: all ? '0' : '1',
        cdPath: 'elearn://app/data/',
        xmlID: String(x.ID),
        ingrandisciLabel: db.str(23),
      })
    );
  }
  return fixLinks(out, fromNode);
}

// link interni (Stacco/Riattacco) il cui bersaglio non esiste per la motorizzazione/produzione corrente
function missingAnchors(db, st, nodeId, list, body) {
  const anchorsOf = (x) => new Set([...x.VALUE_XML.matchAll(/<anchor>\s*([^<]*?)\s*<\/anchor>/g)].map((m) => m[1]));
  const here = new Set();
  for (const x of list) for (const a of anchorsOf(x)) here.add(a);
  const out = {};
  for (const m of body.matchAll(/class="title_link"[^>]*href="#([^"]+)"|href="#([^"]+)"[^>]*class="title_link"/g)) {
    const id = m[1] || m[2];
    if (here.has(id) || out[id]) continue;
    const opts = [];
    for (const x of db.xmlByEl.get(nodeId) || []) {
      if (!anchorsOf(x).has(id)) continue;
      const vals = x.ALL_VALIDITY ? [st.val] : [...(db.xmlVal.get(x.ID) || [])];
      for (const v of vals) {
        const prods = x.ALL_PRODUCTION ? [db.productionsFor(v).some((p) => p.ID === st.prod) ? st.prod : (db.productionsFor(v)[0] || {}).ID] : [...(db.xmlProd.get(x.ID) || [])];
        for (const p of prods) {
          const vv = db.validities.find((y) => y.ID === v);
          const pp = db.productions.find((y) => y.ID === p);
          if (!vv) continue;
          const label = vv.NAME + (pp && (p !== st.prod || !x.ALL_PRODUCTION) && db.productions.length > 1 ? ' (' + pp.NAME + ')' : '');
          if (!opts.some((o) => o.label === label)) opts.push({ label, url: `setval?val=${v}${p ? '&prod=' + p : ''}&node=${nodeId}` });
        }
      }
    }
    out[id] = opts;
  }
  return Object.keys(out).length ? `<script>window.__missingAnchors=${JSON.stringify(out).replace(/</g, '\\u003c')};</script>` : '';
}

function contentPage(db, st, nodeId, from) {
  const e = db.elements.get(nodeId);
  if (!e || !db.elementValid(e, st.val, st.prod)) return errorPage(db, st, nodeId, 15);

  let h = contentHead(db, st) + `\t\t<meta name="elnode" content="${esc(label(e))}">\n` + T('content1');
  const back =
    from && db.elements.get(from)
      ? `<a id="hypBack" class="contents_link" href="javascript:history.back()" target="_parent">${esc(db.str(14))}${esc(
          db.elements.get(from).NAME
        )}</a>`
      : '';

  if (db.xmlByEl.has(nodeId)) {
    // ---- visualizzazione contenuti
    const list = db.validXml(nodeId, st.val, st.prod);
    if (!list.length) return errorPage(db, st, nodeId, 15);
    if (back) h += back + '\n<HR id="separator" style="WIDTH: 100%; HEIGHT: 1px" width="100%" SIZE="1"></HR>\n';
    const parent = db.elements.get(e.PARENT_ID);
    if (parent && isSchemaGroup(db, parent.ID)) {
      const sibs = db.validChildren(parent.ID, st.val, st.prod);
      h += `<table id="SchemaTop" cellspacing="1" cellpadding="1" align="Center" border="0" style="width:90%;">\n   <tr>\n`;
      for (const s of sibs)
        h += `      <td align="center">\n      <a class="${s.ID === nodeId ? 'Selected' : 'notSelected'}" href="main.html?node=${
          s.ID
        }" target="_parent">${esc(schemaTabLabel(db, parent, s))}</a>\n   </td>\n`;
      h += `      <td align="center">\n      <a class="notSelected" href="#" onclick="parent.openWinPrint('print.html?node=${parent.ID}');return false;">${esc(
        db.str(11)
      )}</a>\n   </td>\n   </tr>\n</table>\n<HR width="100%" SIZE="1"></HR>\n`;
    }
    const note = (st.notes || {})[nodeId];
    h += `<div class="notebox${note ? ' has' : ''}" data-node="${nodeId}">
<div class="nview"${note ? '' : ' style="display:none"'}><b>📝 La mia nota</b> <span class="ndate">${note ? esc(new Date(note.date).toLocaleDateString('it-IT')) : ''}</span> <a href="#" class="nedit">modifica</a><div class="ntext">${note ? esc(note.text).replace(/\n/g, '<br>') : ''}</div></div>
<a href="#" class="nadd"${note ? ' style="display:none"' : ''}>📝 Aggiungi una nota personale a questa pagina</a>
<div class="nform" style="display:none"><textarea rows="4" placeholder="Es. coppia verificata 25 Nm, ricambio usato, osservazioni…">${note ? esc(note.text) : ''}</textarea><br><button class="nsave">Salva nota</button> <button class="ncancel">Annulla</button> <button class="ndel">Elimina</button></div>
</div>`;
    h += actionBar(db, st, e, list) + photoBox(e.ID, st.photos || []) + uemLink(db, st, e);
    const body = renderXmlList(db, st, list, db.xslFor(nodeId), nodeId);
    h += body + missingAnchors(db, st, nodeId, list, body);
    h += '\n\t</body>\n</HTML>';
    return h;
  }

  // ---- navigazione (elenco figli)
  const kids = db.validChildren(nodeId, st.val, st.prod);
  if (!kids.length) return errorPage(db, st, nodeId, 17);
  h += T('content2') + back + `<div class="actbar chap"><a href="#" onclick="var a=null;try{a=window.elearnApp||window.top.elearnApp}catch(e){};if(a&&a.exportPdf){this.textContent='⏳ Preparazione PDF del capitolo…';var t=this;a.exportPdf(new window.URL('chapter.html?node=${nodeId}',location.href).href).then(function(){t.textContent='📄 PDF di tutto il capitolo'})}return false;" title="Crea un unico PDF con tutte le pagine di questo capitolo, con indice">📄 PDF di tutto il capitolo</a></div>` + T('content3');
  for (const k of kids) {
    let name = k.NAME;
    if (!k.ALL_CODEP) {
      const cn = db.codepNames(db.elCodep.get(k.ID));
      if (cn) name += ` (${cn})`;
    }
    const href = `main.html?node=${k.ID}`;
    h += `
<tr nowrap="nowrap">
   <td valign="Top" style="height:12px;width:20px;">
      <a href="${href}" class="nav" target="_parent">${esc(k.CODE)}</a></td>
   <td valign="Top">
      <a href="${href}" class="nav" target="_parent">${esc(name)}</a>
   </td>
</tr>`;
  }
  h += T('content4');
  return h;
}

// primo nodo da visualizzare entrando in un gruppo "funzione elettrica"
function resolveNode(db, st, nodeId) {
  if (isSchemaGroup(db, nodeId)) {
    const kids = db.validChildren(nodeId, st.val, st.prod);
    const schema = kids.find((k) => (db.xmlByEl.get(k.ID) || []).some((x) => x.VALUE_XML.includes('<svgimage>')));
    if (schema || kids[0]) return (schema || kids[0]).ID;
  }
  return nodeId;
}

// ---------------------------------------------------------------- ZOOM SCHEMA
function zoomPage(db, st, xmlId) {
  const x = db.xmlById.get(xmlId);
  let h = withMeta('<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN" >\n<HTML>\n\t<HEAD>\n');
  h += `\t\t<title>eLearn - Zoom</title>
		<link rel="stylesheet" type="text/css" media="screen" href="./css/contents.css">
		<link rel="stylesheet" type="text/css" media="print" href="./css/contents_print.css">
		<script src="./svgscript/mysvg.js"></script>
		<style>html,body{height:100%;margin:0} embed.electricalzoom{width:100%;height:100%} @media print{.display{display:none}}</style>
`;
  h += T('zoom0');
  h += `<A class='display' HREF='javascript:window.print()'>${esc(db.str(19))}</A> &nbsp; <A class='display' HREF='javascript:exportPdf()'>PDF</A>\n`;
  if (x) {
    const z = bodyOf(
      transform('schemi_zoom', x.VALUE_XML, { linkUrl: '', codep: '0', cdPath: 'elearn://app/data/', xmlID: String(xmlId), components: '1' })
    );
    h += `<table width="100%" style="height:95%" border="0"><tr><td valign="top" style="height:100%">${fixLinks(
      z
    )}</td><td valign="top" width="15%"><iframe src="zoomcomp.html?xml=${xmlId}" frameborder="0" width="100%" height="100%"></iframe></td></tr></table>`;
  }
  h += T('zoom1');
  return h;
}

function zoomCompPage(db, st, xmlId) {
  const x = db.xmlById.get(xmlId);
  let h = withMeta('<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN" >\n<HTML>\n\t<HEAD>\n');
  h += `\t\t<title>eLearn - Componenti</title>
		<link rel="stylesheet" type="text/css" href="./css/contents.css">
`;
  h += T('zoom0');
  if (x) {
    let c = bodyOf(transform('schemi_comp', x.VALUE_XML, { linkUrl: '', codep: '0', cdPath: 'elearn://app/data/', xmlID: String(xmlId) }));
    c = c.replace(/href="([^"]*)"/g, (all, v) => {
      let u = v;
      try {
        u = decodeURIComponent(v);
      } catch (_) {}
      const m = /REFNODEID(\d+)/.exec(u);
      return m ? `href="#" onclick="goMain(${m[1]});return false;"` : all;
    });
    h += c;
  }
  h += T('zoom1');
  return h;
}

// ---------------------------------------------------------------- STAMPA FUNZIONE ELETTRICA
function printPage(db, st, groupId) {
  const g = db.elements.get(groupId);
  const model = db.models.find((m) => m.ID === st.model) || { NAME: '' };
  const val = db.validities.find((v) => v.ID === st.val) || { NAME: '' };
  const prod = db.productions.find((p) => p.ID === st.prod) || { NAME: '' };
  let h = contentHead(db, st, 'eLearn - ' + (g ? g.NAME : '')) + '</HEAD><body>\n';
  h += `<a class="screen" href="javascript: window.print();">${esc(db.str(19))}</a> &nbsp; <a class="screen" href="javascript: exportPdf();">PDF</a>\n`;
  h += `<DIV class="print"><BR><BR><BR><BR><center><img src='./app/logo@2x.jpg' style='width:324px'></center>\n<BR><BR><BR><BR><center><font size=5>${esc(
    g ? label(g) : ''
  )}</font></center></DIV><BR><BR>\n`;
  h += `<DIV class="print"><center><font size=4>${esc(model.NAME)}&nbsp;&nbsp;&nbsp;${esc(val.NAME)}&nbsp;&nbsp;&nbsp;${esc(
    prod.NAME
  )}</font></center></DIV><BR>\n`;
  for (const c of db.validChildren(groupId, st.val, st.prod)) {
    h += `<DIV class=breakbefore>${esc(schemaTabLabel(db, g, c))}</DIV>\n`;
    h += renderXmlList(db, st, db.validXml(c.ID, st.val, st.prod), 'schemi_print', null);
  }
  h += '\n</body></HTML>';
  return h;
}

// ---------------------------------------------------------------- PREFERITI (iframe)
function favoritesPage(db, st) {
  let h = contentHead(db, st, 'eLearn - Preferiti') + T('content1');
  h += '<h1 class="bigtext1">♥ Preferiti</h1>';
  const favs = (st.favs || []).map((id) => db.elements.get(id)).filter(Boolean);
  if (!favs.length) h += '<p class="contents_testonormale">Nessun preferito. Apri una pagina e clicca «☆ Aggiungi ai preferiti» nella colonna a sinistra.</p>';
  else {
    h += '<table class="nav" cellspacing="0" border="0" style="border-style:None;font-family:Verdana;border-collapse:collapse;FONT-SIZE: 10pt;">';
    for (const e of favs) {
      const s = db.sectionOf.get(e.ID);
      h += `<tr><td valign="Top" style="width:20px;padding:3px 0"><a class="nav" href="main.html?node=${e.ID}" target="_parent">${esc(e.CODE)}</a></td>
<td valign="Top" style="padding:3px 0"><a class="nav" href="main.html?node=${e.ID}" target="_parent">${esc(e.NAME)}</a> <span style="color:gray;font-size:7pt">(${esc(s ? s.NAME : '')})</span></td>
<td valign="Top" style="padding:3px 8px"><a href="favdel?node=${e.ID}" title="Rimuovi" style="color:#c00;text-decoration:none;font-weight:bold">✕</a></td></tr>`;
    }
    h += '</table>';
  }
  return h + '\n</body></HTML>';
}

// ---------------------------------------------------------------- RICERCA
// ---------------------------------------------------------------- RICERCA (nell'area contenuti)
const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function highlight(text, words) {
  let h = esc(text);
  if (!words.length) return h;
  const nt = norm(text);
  const marks = [];
  for (const w of words) {
    let i = 0;
    while ((i = nt.indexOf(w, i)) >= 0) { marks.push([i, i + w.length]); i += w.length; }
  }
  if (!marks.length) return h;
  marks.sort((a, b) => a[0] - b[0]);
  let out = '', pos = 0;
  for (const [a, b] of marks) {
    if (a < pos) continue;
    out += esc(text.slice(pos, a)) + '<mark>' + esc(text.slice(a, b)) + '</mark>';
    pos = b;
  }
  return out + esc(text.slice(pos));
}
function snippet(text, words) {
  const nt = norm(text);
  let i = -1;
  for (const w of words) { i = nt.indexOf(w); if (i >= 0) break; }
  if (i < 0) return '';
  const a = Math.max(0, i - 70), b = Math.min(text.length, i + 110);
  return (a > 0 ? '…' : '') + highlight(text.slice(a, b), words) + (b < text.length ? '…' : '');
}
// ricerca tollerante: per ogni parola, alternative da sinonimi e (se la parola non esiste nel manuale) da parole simili
function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
function vocab(db) {
  if (db._vocab) return db._vocab;
  const v = new Set();
  for (const id of db.xmlById.keys()) for (const w of db.normText(id).split(/[^a-z0-9]+/)) if (w.length >= 4 && !/^\d+$/.test(w)) v.add(w);
  for (const e of db.elements.values()) for (const w of norm(e.NAME).split(/[^a-z0-9]+/)) if (w.length >= 4) v.add(w);
  return (db._vocab = v);
}
function expandWords(db, words) {
  const SYN = require('./synonyms');
  const voc = vocab(db);
  const used = [];
  const alts = words.map((w) => {
    const set = new Set([w]);
    for (const g of SYN) if (g.includes(w)) g.forEach((x) => set.add(x));
    if (w.length >= 4 && !/\d/.test(w) && ![...voc].some((x) => x.includes(w))) {
      const max = w.length >= 7 ? 2 : 1;
      const near = [];
      for (const x of voc) { const d = lev(w, x, max); if (d <= max) near.push([d, x]); }
      near.sort((a, b) => a[0] - b[0]);
      near.filter((n) => n[0] === (near[0] || [])[0]).slice(0, 6).forEach(([, x]) => { set.add(x); used.push(x); });
    }
    return [...set];
  });
  return { alts, fuzzy: used };
}
function legendText(db, xmlId) {
  if (!db._leg) db._leg = new Map();
  let t = db._leg.get(xmlId);
  if (t == null) {
    const x = db.xmlById.get(xmlId);
    t = x ? norm([...x.VALUE_XML.matchAll(/<(itemleg|itemtext|legend|cell)>([\s\S]*?)<\/\1>/g)].map((m) => m[2].replace(/<[^>]+>/g, ' ')).join(' ')) : '';
    db._leg.set(xmlId, t);
  }
  return t;
}
function searchPage(db, st, q) {
  const query = (q.get('q') || '').trim();
  const inText = q.has('go') ? q.get('t') === '1' : true;
  const onlyLeg = q.get('l') === '1';
  const secSel = q.getAll('s').length ? q.getAll('s').map(Number) : db.sections.map((s) => s.ID);
  const words = norm(query).split(/\s+/).filter((w) => w.length >= 2);
  const { alts, fuzzy } = words.length ? expandWords(db, words) : { alts: [], fuzzy: [] };
  const allW = [...new Set(alts.flat())];
  const hasAll = (t) => alts.every((a) => a.some((w) => t.includes(w)));

  let h = contentHead(db, st, 'DucatONE - Cerca') + T('content1');
  h += `<div class="srch">
<form action="search.html" method="get">
  <input type="hidden" name="go" value="1">
  <div class="srow"><input class="sq" type="search" name="q" value="${esc(query)}" placeholder="Parola, frase o codice (es. massa, E3010, frizione)" autofocus>
  <button type="submit">Cerca</button></div>
  <div class="sopt"><label><input type="checkbox" name="t" value="1"${inText ? ' checked' : ''}> cerca anche nel testo delle pagine</label> &nbsp;<label title="Cerca solo nelle legende delle foto e nelle tabelle dei componenti degli schemi"><input type="checkbox" name="l" value="1"${onlyLeg ? ' checked' : ''}> solo legende foto e componenti</label>
  &nbsp;&nbsp;|&nbsp;&nbsp; Sezioni: ${db.sections
    .map((s) => `<label><input type="checkbox" name="s" value="${s.ID}"${secSel.includes(s.ID) ? ' checked' : ''}> ${esc(s.NAME)}</label>`)
    .join(' ')}</div>
</form>`;

  if (!query) {
    h += `<p class="shint">Scrivi una o più parole: verranno mostrate tutte le voci del manuale che le contengono nel titolo, nel codice${
      inText ? ' o nel testo' : ''
    }, con il percorso completo delle categorie. La ricerca tiene conto della motorizzazione e del periodo di produzione selezionati a sinistra.</p></div></body></HTML>`;
    return h;
  }
  if (!words.length) {
    h += `<p class="shint">Scrivi almeno 2 caratteri.</p></div></body></HTML>`;
    return h;
  }
  const secs = new Set(secSel);
  const groups = new Map();
  let total = 0;
  // ordine ad albero: visita in profondità per ogni sezione
  for (const s of db.sections) {
    if (!secs.has(s.ID)) continue;
    const list = [];
    const visit = (id) => {
      for (const c of db.validChildren(id, st.val, st.prod)) {
        const title = (c.CODE ? c.CODE + ' ' : '') + c.NAME;
        const nTitle = norm(title);
        let kind = null, snip = '', score = 0;
        const nCode = norm(c.CODE);
        const qn = norm(query);
        let inLeg = false;
        if (!onlyLeg && hasAll(nTitle)) {
          kind = 'titolo';
          score = 100;
          if (nCode && nCode === qn) score += 400;
          else if (nCode && nCode.startsWith(qn)) score += 150;
          for (const w of allW) if (new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)').test(nTitle)) score += words.includes(w) ? 30 : 15;
          score -= Math.min(40, nTitle.length / 4);
        }
        if ((inText || onlyLeg) && db.xmlByEl.has(c.ID)) {
          let hits = 0;
          for (const x of db.validXml(c.ID, st.val, st.prod)) {
            const nt = db.normText(x.ID);
            if (onlyLeg ? hasAll(legendText(db, x.ID)) : hasAll(nt)) {
              if (!inLeg && hasAll(legendText(db, x.ID))) inLeg = true;
              for (const w of allW) { let i = -1, n = 0; while ((i = nt.indexOf(w, i + 1)) >= 0 && n < 20) n++; hits += n; }
              if (!snip) snip = snippet(db.plainTextRaw(x.ID), allW);
            }
          }
          if (hits) {
            if (!kind) kind = 'testo';
            score += Math.min(60, hits * 4);
          }
          if (kind === 'titolo') snip = '';
        }
        if (kind) list.push({ e: c, kind, snip, score, inLeg });
        visit(c.ID);
      }
    };
    visit(s.ROOT_ELEM_ID);
    list.sort((a, b) => b.score - a.score);
    if (list.length) { groups.set(s, list); total += list.length; }
  }
  h += `<p class="scount"><b>${total}</b> risultat${total === 1 ? 'o' : 'i'} per «${esc(query)}»${
    fuzzy.length ? ` <span class="sfuzzy">· cercato anche: ${fuzzy.map(esc).join(', ')}</span>` : ''
  }${alts.some((a) => a.length > 1) && !fuzzy.length ? ' <span class="sfuzzy">· inclusi i sinonimi</span>' : ''}</p></div>`;
  if (!total) h += `<p class="shint">${esc(db.str(7))}. Prova con una parola diversa, attiva «cerca anche nel testo» oppure cambia motorizzazione / periodo di produzione.</p>`;
  const ordered = [...groups].sort((x, y) => y[1][0].score - x[1][0].score);
  for (const [s, list] of ordered) {
    h += `<h1 class="bigtext1 sgroup">${esc(s.NAME)} <span>(${list.length})</span></h1><ul class="sres">`;
    for (const r of list) {
      const path = db.pathTo(r.e.ID).slice(0, -1);
      const crumbs = path.map((p) => `<a href="main.html?node=${p.ID}" target="_parent">${esc((p.CODE ? p.CODE + ' ' : '') + p.NAME)}</a>`).join(' › ');
      h += `<li><a class="stitle" href="main.html?node=${r.e.ID}" target="_parent">${highlight((r.e.CODE ? r.e.CODE + ' ' : '') + r.e.NAME, allW)}</a>${
        r.kind === 'testo' ? ` <span class="sbadge">${r.inLeg ? 'in legenda / tabella componenti' : 'nel testo'}</span>` : ''
      }<div class="spath">${crumbs}</div>${r.snip ? `<div class="ssnip">${r.snip}</div>` : ''}</li>`;
    }
    h += '</ul>';
  }
  return h + '\n</body></HTML>';
}

// ---------------------------------------------------------------- ALBERO DI NAVIGAZIONE (colonna sinistra)
function treeHtml(db, st, parentId, curId) {
  const path = new Set(curId ? db.pathTo(curId).map((e) => e.ID) : []);
  const build = (pid, depth) => {
    const kids = db.validChildren(pid, st.val, st.prod);
    if (!kids.length) return '';
    let h = '<ul>';
    for (const k of kids) {
      const leaf = db.isLeaf(k.ID) || isSchemaGroup(db, k.ID);
      const open = path.has(k.ID) && !leaf;
      const t = (k.CODE ? k.CODE + ' ' : '') + k.NAME;
      h += `<li class="${leaf ? 'lf' : open ? 'op' : 'cl'}${k.ID === curId || (path.has(k.ID) && leaf) ? ' cur' : ''}" data-id="${k.ID}">${
        leaf ? '<i></i>' : '<i class="tg"></i>'
      }<a href="main.html?node=${k.ID}" title="${esc(t)}">${esc(t)}</a>${open ? build(k.ID, depth + 1) : ''}</li>`;
    }
    return h + '</ul>';
  };
  return build(parentId, 0);
}

// ---------------------------------------------------------------- CRONOLOGIA (iframe)
function historyPage(db, st, hist) {
  let h = contentHead(db, st, 'DucatONE - Cronologia') + T('content1');
  h += '<h1 class="bigtext1">🕘 Cronologia — ultime pagine consultate</h1>';
  const items = hist.map((id) => db.elements.get(id)).filter(Boolean);
  if (!items.length) h += '<p class="contents_testonormale">Nessuna pagina consultata.</p>';
  else {
    h += '<table class="nav" cellspacing="0" border="0" style="border-collapse:collapse;FONT-SIZE:10pt;">';
    for (const e of items) {
      const sct = db.sectionOf.get(e.ID);
      h += `<tr><td valign="Top" style="padding:3px 8px 3px 0"><a class="nav" href="main.html?node=${e.ID}" target="_parent">${esc(e.CODE)}</a></td>
<td valign="Top" style="padding:3px 0"><a class="nav" href="main.html?node=${e.ID}" target="_parent">${esc(e.NAME)}</a> <span style="color:gray;font-size:7pt">(${esc(sct ? sct.NAME : '')})</span></td></tr>`;
    }
    h += '</table>';
  }
  return h + '\n</body></HTML>';
}

// ---------------------------------------------------------------- RICAMBI ONLINE
function ricambiPage(db, st, data) {
  const eur = (p) => {
    if (!p) return '';
    const n = parseFloat(String(p).replace(',', '.').replace(/[^\d.]/g, ''));
    return isNaN(n) ? esc(p) : n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
  };
  const when = data.updated ? new Date(data.updated).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '';
  let h = contentHead(db, st, 'DucatONE - Ricambi online') + T('content1');
  h += `<div class="ricambi">
<div class="rhead"><h1>🛒 Ricambi online${st.mezzo === '86' ? ' <small>· Ducato 1986</small>' : ''}</h1>
<input type="search" id="rf" placeholder="Filtra per nome, codice o descrizione…" oninput="rfilter(this.value)">
<label class="rfonly"><input type="checkbox" id="rfo" onchange="rfilter(document.getElementById('rf').value)"> ★ Solo preferiti</label>
</div>
<p class="rstate ${data.online ? 'ok' : 'off'}">${
    data.online
      ? `Elenco aggiornato · ${data.items.length} articoli`
      : data.demo
      ? `Elenco online non raggiungibile (${esc(data.error || 'nessuna connessione')}): visualizzati i prodotti dimostrativi.`
      : data.items.length
      ? `Connessione non disponibile: elenco salvato del ${esc(when)} · ${data.items.length} articoli`
      : `Elenco non disponibile. Controlla la connessione a Internet e riprova.`
  }</p>`;
  const groups = new Map();
  for (const it of data.items) {
    if (!groups.has(it.cat)) groups.set(it.cat, []);
    groups.get(it.cat).push(it);
  }
  for (const [cat, list] of groups) {
    h += `<h2 class="rcat">${esc(cat)}</h2><div class="rgrid">`;
    for (const it of list) {
      const safe = /^https?:\/\//i.test(it.link) ? it.link : '';
      h += `<div class="rcard" data-fav="${esc(it.link || it.name)}" data-k="${esc((it.name + ' ' + it.code + ' ' + it.desc + ' ' + cat).toLowerCase())}"><a href="#" class="rstar" title="Aggiungi ai miei ricambi preferiti">☆</a>
  ${(() => { const src = /^https?:\/\//i.test(it.img) ? it.img : /^(https?:\/\/|data:image\/)/i.test(it.thumb || '') ? it.thumb : ''; return src ? `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '<div class="rnoimg">🔧</div>'; })()}
  <div class="rbody"><div class="rname">${esc(it.name)}</div>${it.code ? `<div class="rcode">Cod. ${esc(it.code)}</div>` : ''}
  <div class="rdesc" title="${esc(it.desc)}">${esc(it.desc)}</div>
  <div class="rfoot">${it.price ? `<span class="rprice">${eur(it.price)}</span>` : '<span></span>'}${
        safe ? `<a class="rbuy" href="${esc(safe)}" target="_blank" rel="noopener">Acquista online ↗</a>` : ''
      }</div></div></div>`;
    }
    h += '</div>';
  }
  h += `</div><script>
var RA=null;try{RA=window.elearnApp||window.top.elearnApp}catch(e){}var RF=(RA&&RA.kvGet&&RA.kvGet('ricFav'))||[];
document.querySelectorAll('.rcard').forEach(function(c){var st=c.querySelector('.rstar');if(!st)return;function p(){var on=RF.indexOf(c.dataset.fav)>=0;st.textContent=on?'★':'☆';st.classList.toggle('on',on);c.classList.toggle('fav',on)}p();
st.onclick=function(e){e.preventDefault();var i=RF.indexOf(c.dataset.fav);if(i>=0)RF.splice(i,1);else RF.push(c.dataset.fav);RA&&RA.kvSet&&RA.kvSet('ricFav',RF);p();rfilter(document.getElementById('rf').value)}});
function rfilter(v){v=v.toLowerCase().trim();var fo=document.getElementById('rfo')&&document.getElementById('rfo').checked;document.querySelectorAll('.rcard').forEach(c=>{c.style.display=(!v||c.dataset.k.includes(v))&&(!fo||c.classList.contains('fav'))?'':'none'});
document.querySelectorAll('h2.rcat').forEach(h=>{const g=h.nextElementSibling;h.style.display=[...g.children].some(c=>c.style.display!=='none')?'':'none'});}
</script></body></HTML>`;
  return h;
}

// ---------------------------------------------------------------- VIDEO GUIDE
function videoPage(db, st, data) {
  const when = data.updated ? new Date(data.updated).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '';
  let h = contentHead(db, st, 'DucatONE - Video guide') + T('content1');
  h += `<div class="ricambi videog">
<div class="rhead"><h1>▶ Video guide${st.mezzo === '86' ? ' <small>· Ducato 1986</small>' : ''}</h1>
<input type="search" id="rf" placeholder="Filtra per titolo o descrizione…" oninput="rfilter(this.value)">
</div>
<p class="rstate ${data.online ? 'ok' : 'off'}">${
    data.online
      ? `Elenco aggiornato · ${data.items.length} video`
      : data.demo
      ? `Elenco online non raggiungibile (${esc(data.error || 'nessuna connessione')}): visualizzato il video dimostrativo.`
      : `Connessione non disponibile: elenco salvato del ${esc(when)} · ${data.items.length} video (la riproduzione richiede Internet)`
  }</p>`;
  const groups = new Map();
  for (const it of data.items) {
    if (!groups.has(it.cat)) groups.set(it.cat, []);
    groups.get(it.cat).push(it);
  }
  for (const [cat, list] of groups) {
    h += `<h2 class="rcat">${esc(cat)}</h2><div class="rgrid">`;
    for (const it of list) {
      h += `<a class="rcard vcard" href="#" data-vid="${esc(it.id)}" data-title="${esc(it.title)}" data-k="${esc((it.title + ' ' + it.desc + ' ' + cat).toLowerCase())}">
  <span class="vthumb"><img src="https://i.ytimg.com/vi/${esc(it.id)}/mqdefault.jpg" alt="" onerror="this.style.visibility='hidden'"><span class="vplay">▶</span></span>
  <div class="rbody"><div class="rname">${esc(it.title)}</div><div class="rdesc" title="${esc(it.desc)}">${esc(it.desc)}</div></div></a>`;
    }
    h += '</div>';
  }
  h += `</div><script>
var RA=null;try{RA=window.elearnApp||window.top.elearnApp}catch(e){}var RF=(RA&&RA.kvGet&&RA.kvGet('ricFav'))||[];
document.querySelectorAll('.rcard').forEach(function(c){var st=c.querySelector('.rstar');if(!st)return;function p(){var on=RF.indexOf(c.dataset.fav)>=0;st.textContent=on?'★':'☆';st.classList.toggle('on',on);c.classList.toggle('fav',on)}p();
st.onclick=function(e){e.preventDefault();var i=RF.indexOf(c.dataset.fav);if(i>=0)RF.splice(i,1);else RF.push(c.dataset.fav);RA&&RA.kvSet&&RA.kvSet('ricFav',RF);p();rfilter(document.getElementById('rf').value)}});
function rfilter(v){v=v.toLowerCase().trim();var fo=document.getElementById('rfo')&&document.getElementById('rfo').checked;document.querySelectorAll('.rcard').forEach(c=>{c.style.display=(!v||c.dataset.k.includes(v))&&(!fo||c.classList.contains('fav'))?'':'none'});
document.querySelectorAll('h2.rcat').forEach(h=>{const g=h.nextElementSibling;h.style.display=[...g.children].some(c=>c.style.display!=='none')?'':'none'});}
document.addEventListener('click',function(e){var c=e.target.closest('a.vcard');if(!c)return;e.preventDefault();
var a=null;try{a=window.elearnApp||window.top.elearnApp}catch(_){}
if(a&&a.openVideo)a.openVideo(c.dataset.vid,c.dataset.title);else window.open('https://www.youtube.com/watch?v='+c.dataset.vid);});
</script></body></HTML>`;
  return h;
}

// ---------------------------------------------------------------- GUIDA
function guidePage(db, st, version) {
  const fs2 = require('fs');
  const gf = st.lang > 1 && fs2.existsSync(path.join(WEB, 'app', 'guida_en.html')) ? 'guida_en.html' : 'guida.html';
  const body = fs2.readFileSync(path.join(WEB, 'app', gf), 'utf8').replace(/\{\{VERSION\}\}/g, esc(version.version)).replace(/\{\{UPDATED\}\}/g, esc(version.updated));
  return contentHead(db, st, 'DucatONE - Aiuto') + T('content1') + body + '\n</body></HTML>';
}

// ---------------------------------------------------------------- HOME: pagine recenti e preferiti
function recentBlock(db, st, modelId) {
  const item = (id) => { const e = db.elements.get(id); return e ? `<li><a href="selmodel?model=${modelId}&node=${id}" title="${esc(label(e))}">${esc(label(e))}</a></li>` : ''; };
  const rec = (st.recent || []).map(item).filter(Boolean).slice(0, 5).join('');
  const fav = (st.favs || []).slice(-5).reverse().map(item).filter(Boolean).join('');
  if (!rec && !fav) return '';
  return `<div class="recent">${rec ? `<div><b>🕘 Ultime pagine aperte</b><ul>${rec}</ul></div>` : ''}${fav ? `<div><b>♥ Preferiti</b><ul>${fav}</ul></div>` : ''}</div>`;
}

// ---------------------------------------------------------------- ATTREZZATURA SPECIFICA citata nelle procedure
function toolTable(db) {
  if (db._tools) return db._tools;
  const map = new Map();
  const walk = (id) => {
    for (const x of db.xmlByEl.get(id) || [])
      for (const r of x.VALUE_XML.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
        const c = [...r[1].matchAll(/<text>([^<]*)<\/text>/g)].map((m) => m[1].trim());
        if (/^\d\.\d{3}\.\d{3}\.\d{3}$/.test(c[1] || '') && !map.has(c[1])) map.set(c[1], { name: c[0], use: c[2] || '' });
      }
    for (const c of db.children.get(id) || []) walk(c.ID);
  };
  for (const s of db.sections) for (const c of db.children.get(s.ROOT_ELEM_ID) || []) if (/ATTREZZ|SPECIAL TOOL|SPEZIALWERKZEUG|OUTILLAGE|HERRAMIENTA/i.test(c.NAME)) walk(c.ID);
  return (db._tools = map);
}
function toolsIn(db, list) {
  const tt = toolTable(db), found = new Map();
  for (const x of list) for (const m of x.VALUE_XML.matchAll(/\b\d\.\d{3}\.\d{3}\.\d{3}\b/g)) if (!found.has(m[0])) found.set(m[0], tt.get(m[0]) || null);
  return [...found];
}

// ---------------------------------------------------------------- RICAMBI E VIDEO COLLEGATI ALL'OPERAZIONE
function linkedFor(st, code) {
  if (!code || !st.linked) return { ric: [], vid: [] };
  const c = String(code).toUpperCase();
  const hit = (it) => String(it.ops || '').toUpperCase().split(/[\s,;/]+/).some((o) => o.length >= 3 && c.startsWith(o));
  return { ric: (st.linked.ricambi || []).filter(hit), vid: (st.linked.video || []).filter(hit) };
}

// barra azioni sopra il contenuto: checklist, scheda lavoro, segnala errore + attrezzi, ricambi e video collegati
function actionBar(db, st, e, list) {
  const tools = toolsIn(db, list);
  const lk = linkedFor(st, e.CODE);
  let h = `<div class="actbar" data-node="${e.ID}" data-title="${esc(label(e))}">
<a href="#" class="ab-check" title="Spunta i passaggi mentre lavori">☑ Checklist</a>
<a href="#" class="ab-sheet" title="Scheda lavoro stampabile con passaggi da spuntare">🖨 Scheda lavoro</a>
<a href="#" class="ab-pres" title="Una foto e un passaggio alla volta, a tutto schermo">▶ Presentazione</a>
<a href="#" class="ab-split" title="Affianca questa pagina a un'altra">◫ Affianca</a>
<a href="#" class="ab-report" title="Segnala un errore in questa pagina del manuale">⚠ Segnala errore</a>
</div>`;
  if (tools.length)
    h += `<div class="linkbox tools"><b>🔧 Attrezzatura specifica per questa operazione</b><ul>${tools
      .map(([c, t]) => `<li><span class="tcode">${esc(c)}</span> ${t ? esc(t.name) + (t.use ? ` <span class="tuse">— ${esc(t.use)}</span>` : '') : ''}</li>`)
      .join('')}</ul></div>`;
  if (lk.ric.length || lk.vid.length) {
    h += `<div class="linkbox linked">`;
    if (lk.ric.length)
      h += `<b>🛒 Ricambi per questa operazione</b><div class="lrow">${lk.ric
        .map((it) => {
          const src = /^https?:\/\//i.test(it.img) ? it.img : it.thumb || '';
          const u = /^https?:\/\//i.test(it.link) ? it.link : '';
          return `<a class="lcard" ${u ? `href="${esc(u)}" target="_blank" rel="noopener"` : 'href="ricambi.html"'}>${src ? `<img src="${esc(src)}" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}<span>${esc(it.name)}</span></a>`;
        })
        .join('')}</div>`;
    if (lk.vid.length)
      h += `<b>▶ Video guide</b><div class="lrow">${lk.vid
        .map((it) => `<a class="lcard vcard" href="#" data-vid="${esc(it.id)}" data-title="${esc(it.title)}"><img src="https://i.ytimg.com/vi/${esc(it.id)}/mqdefault.jpg" onerror="this.remove()"><span>${esc(it.title)}</span></a>`)
        .join('')}</div>`;
    h += `</div>`;
  }
  return h;
}

// ---------------------------------------------------------------- SCHEDA LAVORO (stampabile)
function worksheetPage(db, st, nodeId) {
  const e = db.elements.get(nodeId);
  if (!e || !db.xmlByEl.has(nodeId)) return errorPage(db, st, nodeId, 15);
  const list = db.validXml(nodeId, st.val, st.prod);
  const val = db.validities.find((v) => v.ID === st.val), prod = db.productions.find((p) => p.ID === st.prod);
  const veh = ((st.user || {}).vehicles || []).find((v) => v.id === (st.user || {}).activeVehicle) || {};
  const tools = toolsIn(db, list);
  const note = (st.notes || {})[nodeId];
  let h = contentHead(db, st, 'Scheda lavoro - ' + label(e)) + T('content1');
  h += `<div class="wsheet">
<div class="wsh"><img src="./app/logo.jpg"><div><h1>Scheda lavoro</h1><div class="wop">${esc(label(e))}</div></div></div>
<table class="wfields"><tr><td>Veicolo<br><b>Fiat Ducato ${esc(val ? val.NAME : '')} ${esc(prod ? prod.NAME : '')}</b></td><td>Targa<br><b>${esc(veh.targa || '')}</b>&nbsp;</td><td>Telaio<br><b>${esc(veh.telaio || '')}</b>&nbsp;</td><td>Km<br><b>${esc(veh.km || '')}</b>&nbsp;</td></tr>
<tr><td>Data<br><b>${new Date().toLocaleDateString('it-IT')}</b></td><td>Tecnico<br>&nbsp;</td><td>Inizio<br>&nbsp;</td><td>Fine<br>&nbsp;</td></tr></table>
${tools.length ? `<div class="wblock"><b>Attrezzatura specifica</b><ul class="wcheck">${tools.map(([c, t]) => `<li>☐ ${esc(c)} ${t ? esc(t.name) : ''}</li>`).join('')}</ul></div>` : ''}
${note ? `<div class="wblock"><b>Note personali</b><div>${esc(note.text).replace(/\n/g, '<br>')}</div></div>` : ''}
<div class="wbody">${renderXmlList(db, st, list, db.xslFor(nodeId), null)}</div>
<div class="wblock"><b>Ricambi utilizzati / osservazioni</b><div class="wlines"></div></div>
<div class="wsign"><span>Firma tecnico ____________________</span><span>Firma cliente ____________________</span></div>
</div><script>document.querySelectorAll('.wbody p.contents_testonormale').forEach(function(p){if(/^\\s*\\d+\\s*[.)]/.test(p.textContent))p.classList.add('wstep')});</script></body></HTML>`;
  return h;
}

// ---------------------------------------------------------------- SCARICAMENTO NUOVO DUCATO X250
function x250GetPage(state) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>DucatONE - Nuovo Ducato X250</title><link rel="stylesheet" href="./app/fix.css"><script src="./app/i18n.js"></script><style>
body{margin:0;font:10pt Verdana,sans-serif;background:#eef3fa;color:#123}
.box{max-width:560px;margin:60px auto;background:#fff;border-radius:8px;box-shadow:0 4px 20px rgba(0,40,100,.15);padding:24px 28px;border-top:5px solid #fb6705}
h1{font-size:15pt;color:#004594;margin:0 0 8px} .bar{height:14px;background:#dde6f2;border-radius:7px;overflow:hidden;margin:16px 0 6px} .bar i{display:block;height:100%;width:0;background:#fb6705;transition:width .3s}
button,a.b{background:#004594;color:#fff;border:0;border-radius:4px;padding:8px 16px;font:bold 10pt Verdana;cursor:pointer;text-decoration:none;display:inline-block;margin-top:10px} button:hover,a.b:hover{background:#fb6705}
.er{color:#b00020;margin-top:10px} .sm{color:#667;font-size:8.5pt}
</style></head><body><div class="box"><img src="./app/ducato250.jpg" style="float:right;width:170px;margin:-6px -6px 6px 10px"><h1>Nuovo Ducato X250</h1>
<p>Il manuale eLearn del <b>Nuovo Ducato X250</b> (2.2, 2.3 e 3.0 JTD) è un pacchetto aggiuntivo di circa <b>200 MB</b>, con le stesse funzioni del 244 in tutte le 11 lingue. Va scaricato una sola volta, poi funziona anche senza internet.</p>
<div id="st">${state && state.error ? `<div class="er">Scaricamento non riuscito: ${esc(state.error)}</div>` : ''}</div>
<div class="bar"><i id="pb"></i></div><div class="sm" id="pt">&nbsp;</div>
<button id="go">⬇ Scarica il manuale Ducato X250</button> <a class="b" href="models.html" style="background:#667">Torna alla home</a>
<p class="sm" style="margin-top:16px">In alternativa copia il file <b>x250.pak</b> nella cartella dati del programma e riapri DucatONE.</p></div>
<script>
var go=document.getElementById('go'),pb=document.getElementById('pb'),pt=document.getElementById('pt');
function poll(){fetch('x250get?status=1').then(function(r){return r.json()}).then(function(s){
 if(s.done){pt.textContent='Completato!';pb.style.width='100%';setTimeout(function(){location.href='selmodel?model=250000000'},500);return}
 if(s.error){document.getElementById('st').innerHTML='<div class="er">Scaricamento non riuscito: '+s.error+'</div>';go.disabled=false;go.textContent='↻ Riprova';return}
 if(s.running){var pc=s.total?Math.round(s.got/s.total*100):0;pb.style.width=pc+'%';pt.textContent=(s.got/1048576).toFixed(1)+' MB di '+(s.total/1048576||200).toFixed(1)+' MB ('+pc+'%)';}
 setTimeout(poll,400)})}
go.onclick=function(){go.disabled=true;go.textContent='Scaricamento in corso…';fetch('x250get?start=1').then(poll)};
${state && state.running ? 'go.disabled=true;go.textContent="Scaricamento in corso…";poll();' : ''}
</script></body></html>`;
}

// ---------------------------------------------------------------- SCHEDE RAPIDE
const QUICK = [
  ['Piano di manutenzione programmata', 244000548, '🗓'],
  ['Piano di ispezione annuale', 244000549, '🔎'],
  ['Capacità (rifornimenti)', 244000029, '🛢'],
  ['Prodotti consigliati', 244000031, '🧴'],
  ['Coppie di serraggio', 244000095, '🔩'],
  ['Cerchi e pneumatici', 244000030, '🛞'],
  ['Dati caratteristici motore', 244000037, '⚙'],
  ['Angoli di fasatura', 244000038, '🕒'],
  ['Codice dei motori', 244000002, '🏷'],
  ['Frizione', 244000049, '🦶'],
  ['Impianto frenante', 244000051, '🛑'],
  ['Freni anteriori', 244000052, '🛑'],
  ['Freni posteriori', 244000053, '🛑'],
  ['Sterzo', 244000054, '🎯'],
  ['Termostato', 244000040, '🌡'],
  ['Attrezzatura specifica', 244000264, '🔧'],
];
const QUICK250 = [
  ['Piano di manutenzione programmata', 250000021, '🗓'],
  ['Capacità (rifornimenti)', 250000034, '🛢'],
  ['Prodotti consigliati', 250000033, '🧴'],
  ['Coppie di serraggio motore', 250001158, '🔩'],
  ['Cerchi e pneumatici', 250000031, '🛞'],
  ['Dati caratteristici motore', 250000023, '⚙'],
  ['Marcatura del motore', 250000019, '🏷'],
  ['Frizione', 250000025, '🦶'],
  ['Freni – generalità', 250000027, '🛑'],
  ['Freni anteriori', 250004071, '🛑'],
  ['Freni posteriori', 250004072, '🛑'],
  ['Sterzo', 250000030, '🎯'],
  ['Termostato', 250004076, '🌡'],
  ['Punti di sollevamento', 250000037, '🔧'],
];
const is250db = (db) => (db.models[0] || {}).CODE === '250';
// rimando dalla pagina d'officina alla pagina corrispondente del libretto di uso e manutenzione
function uemLink(db, st, e) {
  const U = require('./uem');
  const acl = !/^(briglia|negativo|positivo|massa|connettore|giunzione)/i.test(e.NAME) && /climatizz|condizionat|\bA\/C\b/i.test(e.NAME + ' ' + ((db.elements.get(e.PARENT_ID) || {}).NAME || ''))
    ? `<div class="uemlink">❄ <a href="ac.html" target="framemain">Istruzioni di montaggio dei <b>kit aria condizionata Diavia</b> per questo modello</a></div>` : '';
  const k = U.linkFor(e.NAME) || U.linkFor((db.elements.get(e.PARENT_ID) || {}).NAME);
  if (!k) return acl;
  const docs = U.docsFor(is250db(db) ? '250' : '244').filter((d) => U.topicPage(d.id, k));
  if (!docs.length) return acl;
  const t = (U.TOPICS.find((x) => x[0] === k) || [])[1];
  return `<div class="uemlink">📕 Nel <b>libretto di uso e manutenzione</b>: ${docs.map((d) => `<a href="uem.html?d=${d.id}&p=${U.topicPage(d.id, k)}" target="framemain">${esc(t)}${docs.length > 1 ? ' (' + esc(d.short) + ')' : ''} – pag. ${U.topicPage(d.id, k)}</a>`).join(' · ')}</div>` + acl;
}
function quickPage(db, st) {
  const items = (is250db(db) ? QUICK250 : QUICK).map(([t, id, ic]) => [t, id, ic, db.elements.get(id)]).filter((x) => x[3] && db.elementValid(x[3], st.val, st.prod));
  let h = contentHead(db, st, 'DucatONE - Schede rapide') + T('content1');
  h += `<div class="quick"><div class="qlist"><h1>⚡ Schede rapide</h1>${items
    .map(([t, id, ic, e], i) => `<a href="content.html?node=${id}" target="qframe" class="${i ? '' : 'sel'}" title="${esc(e.NAME)}"><span>${ic}</span>${esc(t)}</a>`)
    .join('')}${(() => {
      const U = require('./uem'), d = U.docsFor(is250db(db) ? '250' : '244')[0];
      const keys = ['spie', 'lampade', 'fusibili', 'pneumatici', 'avviamento', 'ruota', 'traino', 'controlli', 'rifornimenti'];
      return `<h2 class="qh2">📕 Dal libretto di uso e manutenzione</h2>` + keys.filter((k) => U.topicPage(d.id, k)).map((k) => { const t = U.TOPICS.find((x) => x[0] === k); return `<a href="${U.pdfUrl(d, U.topicPage(d.id, k))}" target="qframe" title="${esc(d.title)}"><span>${t[2]}</span>${esc(t[1])}</a>`; }).join('') + `<a href="ac.html" target="qframe"><span>❄</span>Kit aria condizionata Diavia</a>`;
    })()}<p class="qnote">I dati sono quelli del manuale originale per la motorizzazione selezionata. Clicca una voce per vederla qui a destra.</p></div>
<iframe name="qframe" class="qframe" src="content.html?node=${items.length ? items[0][1] : ''}"></iframe></div>
<script>document.querySelectorAll('.qlist a').forEach(function(a){a.addEventListener('click',function(){document.querySelectorAll('.qlist a').forEach(function(x){x.classList.remove('sel')});a.classList.add('sel')})});</script></body></HTML>`;
  return h;
}

// ---------------------------------------------------------------- STRUMENTI (convertitori, glossario, colori cavi, backup)
function toolsPage(db, st, tab) {
  const tabs = [['conv', '🔢 Convertitori'], ['gloss', '📖 Glossario'], ['wire', '🎨 Colori cavi'], ['backup', '💾 Backup']];
  const cur = tabs.some((t) => t[0] === tab) ? tab : 'conv';
  let h = contentHead(db, st, 'DucatONE - Strumenti') + T('content1');
  h += `<div class="toolsp"><h1>🧰 Strumenti</h1><div class="ttabs">${tabs
    .map(([k, t]) => `<a href="tools.html?t=${k}" class="${k === cur ? 'sel' : ''}">${t}</a>`)
    .join('')}</div><div class="tbody">`;
  if (cur === 'conv') {
    const conv = [
      ['Coppia', 'Nm', 'kgm', 1 / 9.80665], ['Coppia', 'Nm', 'lbf·ft', 1 / 1.3558179],
      ['Pressione', 'bar', 'psi', 14.503774], ['Pressione', 'bar', 'kPa', 100],
      ['Volume', 'litri', 'galloni USA', 1 / 3.785411784], ['Volume', 'litri', 'galloni UK', 1 / 4.54609],
      ['Distanza', 'km', 'miglia', 1 / 1.609344], ['Lunghezza', 'mm', 'pollici', 1 / 25.4],
      ['Potenza', 'kW', 'CV', 1 / 0.73549875], ['Temperatura', '°C', '°F', 'T'],
    ];
    h += `<p class="thint">Scrivi un valore in una delle due caselle: l'altra si aggiorna subito.</p><table class="conv">${conv
      .map(([g, a, b, f], i) => `<tr><td class="cg">${g}</td><td><input type="number" step="any" data-i="${i}" data-s="a"> ${a}</td><td>⇄</td><td><input type="number" step="any" data-i="${i}" data-s="b"> ${b}</td></tr>`)
      .join('')}</table><script>
var F=${JSON.stringify(conv.map((c) => c[3]))};
document.querySelectorAll('.conv input').forEach(function(inp){inp.addEventListener('input',function(){var i=+inp.dataset.i,v=parseFloat(inp.value),o=document.querySelector('.conv input[data-i="'+i+'"][data-s="'+(inp.dataset.s==='a'?'b':'a')+'"]');
if(isNaN(v)){o.value='';return;}var r=F[i]==='T'?(inp.dataset.s==='a'?v*9/5+32:(v-32)*5/9):(inp.dataset.s==='a'?v*F[i]:v/F[i]);o.value=Math.round(r*1000)/1000;});});
</script>`;
  } else if (cur === 'gloss') {
    h += `<p class="thint">Nelle pagine del manuale queste sigle sono sottolineate a puntini: passaci sopra col mouse per leggerne il significato.</p><table class="gloss" id="gl"></table>
<script>var G=window.DUCATONE_GLOSS||{},t=document.getElementById('gl');Object.keys(G).sort().forEach(function(k){var r=t.insertRow();r.insertCell().innerHTML='<b>'+k+'</b>';r.insertCell().textContent=G[k];});</script>`;
  } else if (cur === 'wire') {
    h += `<p class="thint">Negli schemi elettrici Fiat ogni cavo è indicato con una o due lettere: la prima è il colore di base, la seconda il colore della striscia. Esempio: <b>AV</b> = azzurro con striscia verde. Legenda indicativa: in caso di dubbio verifica sul cablaggio.</p>
<div class="wires" id="wl"></div><div class="wtry">Prova una sigla: <input id="wi" maxlength="2" placeholder="es. HN"> <span id="wo"></span></div>
<script>var W=window.DUCATONE_WIRES||[],M={};W.forEach(function(w){M[w[0]]=w});document.getElementById('wl').innerHTML=W.map(function(w){return '<div><span class="sw" style="background:'+w[2]+'"></span><b>'+w[0]+'</b> '+w[1]+'</div>'}).join('');
var wi=document.getElementById('wi'),wo=document.getElementById('wo');wi.oninput=function(){var s=wi.value.toUpperCase().replace(/[^A-Z]/g,'');wi.value=s;var a=M[s[0]],b=M[s[1]];
var T=window.__t||function(k,x,y){return k.replace('{0}',x).replace('{1}',y)};wo.innerHTML=!s?'':!a||(s[1]&&!b)?T('sigla non riconosciuta'):'<span class="wire" style="background:'+(b?'linear-gradient(180deg,'+a[2]+' 0 35%,'+b[2]+' 35% 65%,'+a[2]+' 65%)':a[2])+'"></span> '+(b?T('{0} con striscia {1}',a[1],b[1]):a[1]);};</script>`;
  } else {
    h += `<p class="thint">Salva in un file note personali, preferiti, cronologia, checklist, libretti dei veicoli e foto personali, per ripristinarli su un altro PC o dopo una reinstallazione.</p>
<p><button class="tbtn" id="bx">💾 Esporta backup…</button> &nbsp; <button class="tbtn" id="bi">📂 Ripristina backup…</button></p><p id="bo" class="thint"></p>
<script>var A=null;try{A=window.elearnApp||window.top.elearnApp}catch(e){}var o=document.getElementById('bo');
document.getElementById('bx').onclick=async function(){var r=await A.backupExport();o.textContent=r.ok?'Backup salvato in: '+r.file:r.error||'';};
document.getElementById('bi').onclick=async function(){var r=await A.backupImport();o.textContent=r.ok?'Backup ripristinato. Riapri le pagine per vedere i dati.':r.error||'';if(r.ok)setTimeout(function(){A.reloadAll()},800);};</script>`;
  }
  return h + '</div></div></body></HTML>';
}

function warmSearch(db) { try { vocab(db); toolTable(db); } catch (_) {} }

// ---------------------------------------------------------------- CONFRONTO AFFIANCATO
function splitPage(l, r) {
  const ok = (u) => (/^elearn:\/\/app\//.test(u) ? u : 'elearn://app/models.html');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>DucatONE - Affiancate</title><style>
html,body{margin:0;height:100%;overflow:hidden;font:12px Verdana,sans-serif;background:#004594}
.sp{display:flex;height:calc(100% - 26px)} iframe{border:0;height:100%;background:#fff} #L{width:50%} #R{flex:1}
.dv{width:7px;cursor:col-resize;background:#fb6705} .top{height:26px;display:flex;align-items:center;gap:12px;padding:0 10px;color:#fff}
.top a{color:#ffd9bf;text-decoration:none;cursor:pointer} .top a:hover{color:#fff;text-decoration:underline} .top b{color:#fff}
</style><script src="./app/i18n.js"></script></head><body><div class="top"><b>◫ Pagine affiancate</b><span>Trascina la barra arancione per cambiare le proporzioni.</span><span style="flex:1"></span><a id="sw">⇄ Scambia</a><a id="cl">✕ Chiudi affiancamento</a></div>
<div class="sp"><iframe id="L" src="${esc(ok(l))}"></iframe><div class="dv" id="D"></div><iframe id="R" src="${esc(ok(r))}"></iframe></div>
<script>
var L=document.getElementById('L'),R=document.getElementById('R'),D=document.getElementById('D');
D.onmousedown=function(e){e.preventDefault();L.style.pointerEvents=R.style.pointerEvents='none';
document.onmousemove=function(m){L.style.width=Math.max(15,Math.min(85,m.clientX/innerWidth*100))+'%'};
document.onmouseup=function(){document.onmousemove=document.onmouseup=null;L.style.pointerEvents=R.style.pointerEvents=''}};
function cur(f){try{return f.contentWindow.location.href}catch(e){return f.src}}
document.getElementById('sw').onclick=function(){var a=cur(L),b=cur(R);L.src=b;R.src=a};
document.getElementById('cl').onclick=function(){location.href=cur(L)};
</script></body></html>`;
}

// ---------------------------------------------------------------- FOTO PERSONALI
function photoBox(node, photos) {
  return `<div class="photobox" data-node="${node}">${photos
    .map((f) => `<span class="ph"><img src="userfoto?f=${encodeURIComponent(node + '/' + f)}" data-f="${esc(f)}" title="La tua foto · clic per ingrandire"><a href="#" class="phdel" title="Elimina foto">✕</a></span>`)
    .join('')}<a href="#" class="phadd" title="Allega a questa pagina foto scattate da te">📷 ${photos.length ? 'Aggiungi foto' : 'Aggiungi le tue foto a questa pagina'}</a></div>`;
}

// ---------------------------------------------------------------- PIANO DI MANUTENZIONE (dal manuale)
function maintPlan(db, val, prod) {
  const id = is250db(db) ? 250000021 : 244000548;
  const xs = db.xmlByEl.has(id) ? db.validXml(id, val, prod) : [];
  const out = [];
  const vn = (db.validities.find((v) => v.ID === val) || {}).NAME || '';
  const diesel = /JTD|TD|D$/i.test(vn), petrol = /16V|benz/i.test(vn) && !diesel;
  for (const x of xs) {
    const rows = [...x.VALUE_XML.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) => [...r[1].matchAll(/<cell>([\s\S]*?)<\/cell>/g)].map((c) => c[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()));
    let kms = null;
    for (const r of rows) {
      if (!kms && r.slice(1).filter((c) => /^\d+$/.test(c)).length >= 3) { kms = r.slice(1).map((c) => +c * 1000); continue; }
      if (!kms || !/^sostituzione/i.test(r[0] || '')) continue;
      if ((diesel && /benzina/i.test(r[0])) || (petrol && /gasolio/i.test(r[0]))) continue;
      const i = r.slice(1).findIndex((c) => c === '+');
      if (i < 0) continue;
      const mm = /ogni (\d+) mesi/i.exec(r[0]);
      out.push({ key: r[0].replace(/\s*\(.*?\)\s*/g, ' ').replace(/^sostituzione\s+/i, '').trim(), name: r[0].replace(/\s*\((\*+)\)/g, '').trim(), km: kms[i], months: mm ? +mm[1] : 0 });
    }
  }
  return out;
}
function maintStatus(item, last, kmNow) {
  if (!last || (!last.km && !last.date)) return { s: 'na', t: 'mai registrato' };
  let s = 'ok', t = [];
  if (item.km && last.km != null && kmNow) {
    const due = +last.km + item.km, left = due - kmNow;
    t.push(left < 0 ? `scaduto da ${(-left).toLocaleString('it-IT')} km` : `tra ${left.toLocaleString('it-IT')} km`);
    if (left < 0) s = 'late'; else if (left < 2000) s = 'soon';
  }
  if (item.months && last.date) {
    const d = new Date(last.date); d.setMonth(d.getMonth() + item.months);
    const days = Math.round((d - Date.now()) / 864e5);
    t.push(days < 0 ? `scaduto da ${-days} giorni` : `entro ${d.toLocaleDateString('it-IT')}`);
    if (days < 0) s = 'late'; else if (days < 30 && s !== 'late') s = 'soon';
  }
  return { s, t: t.join(' · ') || 'registrato' };
}
function maintBanner(db, st) {
  const u = st.user || {};
  const v = (u.vehicles || []).find((x) => x.id === u.activeVehicle);
  if (!v) return '';
  const vdb = (st.dbs || [db]).find((d) => d.validities.some((x) => x.ID === v.val)) || db;
  const plan = (typeof v.val === 'string' ? [] : maintPlan(vdb, v.val || st.val, v.prod || st.prod)).concat(v.custom || []);
  const items = plan.map((it) => ({ it, st: maintStatus(it, (v.maint || {})[it.key], +v.km || 0) })).filter((x) => x.st.s === 'late' || x.st.s === 'soon');
  if (!items.length) return '';
  return `<a class="mbanner" href="selmodel?model=${st.model || ''}&open=garage.html" title="Apri il libretto">⚠ <b>${esc(v.nome || v.targa || 'Il tuo veicolo')}</b>: ${items.length} <span>${items.length === 1 ? 'manutenzione in scadenza' : 'manutenzioni in scadenza'}</span> (${items.slice(0, 3).map((x) => esc(x.it.key)).join(', ')}${items.length > 3 ? '…' : ''}) — <span>apri</span> «📒 <span>Libretto e manutenzione</span>»</a>`;
}

// ---------------------------------------------------------------- LIBRETTO, VEICOLI E MANUTENZIONE
function garagePage(db, st) {
  const plans = {};
  const dbs = st.dbs && st.dbs.length ? st.dbs : [db];
  for (const d of dbs) for (const v of d.validities) for (const p of d.productionsFor(v.ID)) plans[v.ID + ':' + p.ID] = maintPlan(d, v.ID, p.ID);
  const vals = [].concat(...dbs.map((d) => d.validities.map((v) => ({ id: v.ID, name: (is250db(d) ? 'Ducato X250 · ' : 'Ducato 244 · ') + v.NAME, prods: d.productionsFor(v.ID).map((p) => ({ id: p.ID, name: p.NAME })) }))))
    .concat([['b', '2000 benzina'], ['d19', '1900 Diesel / turbo D'], ['d25', '2500 Diesel / turbo D'], ['crd', '2500 Diesel C.R.D.']].map(([k, n]) => ({ id: 'd86' + k, name: 'Ducato 1986 · ' + n, prods: [{ id: 0, name: 'gamma 1986 (1ª serie)' }] })));
  let h = contentHead(db, st, 'DucatONE - Libretto') + T('content1');
  h += `<div class="garage"><div class="ghead"><h1>📒 Libretto e manutenzione</h1><select id="gv"></select><a href="#" id="gnew" class="gbtn">＋ Nuovo veicolo</a><a href="#" id="gprint" class="gbtn lite">🖨 Stampa libretto</a></div>
<div id="gbody"></div>
<div class="uemcheck"><h2>✅ Controlli periodici consigliati dal libretto di uso e manutenzione</h2>
<p><b>Ogni 1.000 km o prima di lunghi viaggi</b> controllare ed eventualmente ripristinare: livello del liquido di raffreddamento motore, livello del liquido freni, livello del liquido lavacristallo, pressione e condizione dei pneumatici, funzionamento delle luci (fari, indicatori di direzione, emergenza) e del tergi/lavacristallo con posizione e usura delle spazzole. <b>Ogni 3.000 km</b>: livello dell'olio motore.</p>
<p><b>Uso gravoso</b> (traino di rimorchi o roulotte, strade polverose, tragitti brevi e ripetuti con temperature sotto zero, motore spesso al minimo, consegne porta a porta, lunga inattività): controllare più spesso di quanto previsto dal piano pattini dei freni anteriori, serrature e leverismi, condizioni di motore, cambio, trasmissione, tubazioni ed elementi in gomma, carica e livello della batteria, cinghie dei comandi accessori, olio motore e filtro.</p>
<p class="ghint">Dal libretto: ${require('./uem').DOCS.map((d) => `<a href="uem.html?d=${d.id}&p=${require('./uem').topicPage(d.id, 'controlli')}">${esc(d.short)}</a>`).join(' · ')} · piano di manutenzione del libretto: ${require('./uem').DOCS.map((d) => `<a href="uem.html?d=${d.id}&p=${require('./uem').topicPage(d.id, 'manut')}">${esc(d.short)}</a>`).join(' · ')}</p></div>
</div>
<script>
var VALS=${JSON.stringify(vals).replace(/</g, '\\u003c')},PLANS=${JSON.stringify(plans).replace(/</g, '\\u003c')},CUR={val:${st.val},prod:${st.prod}};
var A=null;try{A=window.elearnApp||window.top.elearnApp}catch(e){}
function get(k){try{return A.kvGet(k)}catch(e){return null}} function set(k,v){try{A.kvSet(k,v)}catch(e){}}
var V=get('vehicles')||[],act=get('activeVehicle');
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function save(){set('vehicles',V);set('activeVehicle',act)}
function cur(){return V.find(function(v){return v.id===act})||V[0]}
function nf(n){return (+n||0).toLocaleString('it-IT')}
function valName(v){var x=VALS.find(function(a){return a.id==v.val});var p=x&&x.prods.find(function(a){return a.id==v.prod});return (x?x.name:'')+(p?' '+p.name:'')}
function status(it,last,km){if(!last||(!last.km&&!last.date))return{s:'na',t:'mai registrato'};var s='ok',t=[];
 if(it.km&&last.km!=null&&km){var left=(+last.km+it.km)-km;t.push(left<0?'scaduto da '+nf(-left)+' km':'tra '+nf(left)+' km');if(left<0)s='late';else if(left<2000)s='soon'}
 if(it.months&&last.date){var d=new Date(last.date);d.setMonth(d.getMonth()+it.months);var days=Math.round((d-Date.now())/864e5);t.push(days<0?'scaduto da '+(-days)+' giorni':'entro '+d.toLocaleDateString('it-IT'));if(days<0)s='late';else if(days<30&&s!=='late')s='soon'}
 return{s:s,t:t.join(' · ')||'registrato'}}
function plan0(v){var is86=String(v.val).indexOf('d86')===0;return (is86?[]:(PLANS[(v.val||CUR.val)+':'+(v.prod||CUR.prod)]||[])).concat(v.custom||[])}
function render(){
 var sel=document.getElementById('gv');sel.innerHTML=V.map(function(v){return '<option value="'+v.id+'"'+(v.id===act?' selected':'')+'>'+esc(v.nome||v.targa||'Veicolo')+'</option>'}).join('');sel.style.display=V.length?'':'none';
 var b=document.getElementById('gbody'),v=cur();
 if(!v){b.innerHTML='<p class="gempty">Nessun veicolo. Clicca <b>＋ Nuovo veicolo</b> per creare il libretto del tuo Ducato: dati, interventi eseguiti e scadenze di manutenzione.</p>';return}
 act=v.id;v.custom=v.custom||[];var is86=String(v.val).indexOf('d86')===0;var plan=(is86?[]:(PLANS[(v.val||CUR.val)+':'+(v.prod||CUR.prod)]||[])).concat(v.custom);v.maint=v.maint||{};v.log=v.log||[];
 var h='<div class="gcard"><div class="gdata"><div><small>Nome</small><b>'+esc(v.nome)+'</b></div><div><small>Targa</small><b>'+esc(v.targa)+'</b></div><div><small>Telaio</small><b>'+esc(v.telaio)+'</b></div><div><small>Anno</small><b>'+esc(v.anno)+'</b></div><div><small>Motorizzazione</small><b>'+esc(valName(v))+'</b></div><div><small>Km attuali</small><b>'+nf(v.km)+'</b> <a href="#" id="gkm">aggiorna</a></div></div>'+
 '<div class="gact"><a href="#" id="guse" class="gbtn">✔ Usa questo veicolo nel manuale</a><a href="#" id="gedit" class="gbtn lite">✎ Modifica dati</a><a href="#" id="gdel" class="gbtn lite red">Elimina veicolo</a></div></div>';
 h+='<h2>🔧 Scadenze di manutenzione</h2><p class="ghint">'+(is86?'Il manuale Ducato 1986 non contiene un piano di manutenzione: aggiungi le tue scadenze (es. olio motore ogni 10.000 km o 12 mesi) con «＋ Scadenza personalizzata». Dati utili: <a href="d86main.html?p=31" target="_parent">rifornimenti</a> e <a href="d86main.html?p=32" target="_parent">lubrificanti</a>.':'Intervalli presi dal <a href="main.html?node=244000548" target="_parent">Piano di manutenzione programmata</a> del manuale per la motorizzazione del veicolo, più le tue scadenze personalizzate.')+' Registra quando esegui un intervento per calcolare la prossima scadenza.</p><table class="gtab"><tr><th>Intervento</th><th>Ogni</th><th>Ultima volta</th><th>Stato</th><th></th></tr>';
 plan.forEach(function(it,i){var last=v.maint[it.key],st=status(it,last,+v.km);h+='<tr class="'+st.s+'"><td>'+esc(it.name)+'</td><td>'+(it.km?nf(it.km)+' km':'')+(it.months?(it.km?' o ':'')+it.months+' mesi':'')+'</td><td>'+(last?(last.date?new Date(last.date).toLocaleDateString('it-IT'):'')+(last.km?' · '+nf(last.km)+' km':''):'—')+'</td><td><span class="gst '+st.s+'">'+st.t+'</span></td><td><a href="#" data-done="'+i+'">✔ fatto</a>'+(it.custom?' <a href="#" data-cdel="'+i+'" title="Elimina scadenza">✕</a>':'')+'</td></tr>'});
 h+='<tr class="gin"><td colspan="5"><a href="#" id="cadd" class="gbtn lite">＋ Scadenza personalizzata</a></td></tr></table>';
 h+='<h2>📋 Interventi eseguiti</h2><table class="gtab glog"><tr><th>Data</th><th>Km</th><th>Descrizione</th><th>Ricambi</th><th>Ore</th><th>Costo €</th><th></th></tr>'+
 '<tr class="gin"><td><input type="date" id="ld"></td><td><input type="number" id="lk" placeholder="km"></td><td><input id="ldesc" placeholder="es. Sostituzione olio e filtro"></td><td><input id="lr" placeholder="ricambi usati"></td><td><input id="lo" placeholder="h:mm" title="Clic: usa il tempo del cronometro"></td><td><input type="number" step="0.01" id="lc"></td><td><a href="#" id="ladd" class="gbtn">Aggiungi</a></td></tr>';
 v.log.slice().sort(function(a,b){return (b.date||'').localeCompare(a.date||'')}).forEach(function(l){h+='<tr><td>'+(l.date?new Date(l.date).toLocaleDateString('it-IT'):'')+'</td><td>'+(l.km?nf(l.km):'')+'</td><td>'+esc(l.desc)+'</td><td>'+esc(l.ric)+'</td><td>'+esc(l.ore)+'</td><td>'+(l.costo?(+l.costo).toLocaleString('it-IT',{style:'currency',currency:'EUR'}):'')+'</td><td><a href="#" data-dl="'+l.id+'" title="Elimina">✕</a></td></tr>'});
 var tot=v.log.reduce(function(s,l){return s+(+l.costo||0)},0);
 h+='</table>'+(tot?'<p class="gtot">Totale spese registrate: <b>'+tot.toLocaleString('it-IT',{style:'currency',currency:'EUR'})+'</b></p>':'');
 b.innerHTML=h;
 document.getElementById('ld').value=new Date().toISOString().slice(0,10);document.getElementById('lk').value=v.km||'';
 document.getElementById('lo').onclick=function(){try{var t0=+localStorage.getItem('elearn.tmr.start')||0,acc=+localStorage.getItem('elearn.tmr.acc')||0,ms=acc+(t0?Date.now()-t0:0);if(ms>0){var m=Math.round(ms/60000);this.value=Math.floor(m/60)+':'+String(m%60).padStart(2,'0')}}catch(e){}};
}
function form(v){var x=v||{};var o=VALS.map(function(a){return '<option value="'+a.id+'"'+((x.val||CUR.val)==a.id?' selected':'')+'>'+esc(a.name)+'</option>'}).join('');
 var d=document.createElement('div');d.className='gform';d.innerHTML='<div class="gfi"><h3>'+(v?'Modifica veicolo':'Nuovo veicolo')+'</h3><label>Nome <input id="fn" value="'+esc(x.nome||'Il mio Ducato')+'"></label><label>Targa <input id="ft" value="'+esc(x.targa)+'"></label><label>Telaio <input id="fc" value="'+esc(x.telaio)+'"></label><label>Anno <input id="fa" value="'+esc(x.anno)+'"></label><label>Km attuali <input type="number" id="fk" value="'+esc(x.km)+'"></label><label>Motorizzazione <select id="fv">'+o+'</select></label><label>Periodo <select id="fp"></select></label><div><a href="#" id="fok" class="gbtn">Salva</a> <a href="#" id="fno" class="gbtn lite">Annulla</a></div></div>';
 document.body.appendChild(d);var fv=d.querySelector('#fv'),fp=d.querySelector('#fp');
 function prods(){var a=VALS.find(function(z){return z.id==fv.value});fp.innerHTML=(a?a.prods:[]).map(function(p){return '<option value="'+p.id+'"'+((x.prod||CUR.prod)==p.id?' selected':'')+'>'+esc(p.name)+'</option>'}).join('')}
 fv.onchange=prods;prods();
 d.querySelector('#fno').onclick=function(e){e.preventDefault();d.remove()};
 d.querySelector('#fok').onclick=function(e){e.preventDefault();var t=v||{id:'v'+Date.now(),maint:{},log:[]};t.nome=d.querySelector('#fn').value.trim();t.targa=d.querySelector('#ft').value.trim().toUpperCase();t.telaio=d.querySelector('#fc').value.trim().toUpperCase();t.anno=d.querySelector('#fa').value.trim();t.km=+d.querySelector('#fk').value||0;t.val=isNaN(+fv.value)?fv.value:+fv.value;t.prod=+fp.value;if(!v)V.push(t);act=t.id;save();d.remove();render()};
}
document.getElementById('gnew').onclick=function(e){e.preventDefault();form(null)};
document.getElementById('gprint').onclick=function(e){e.preventDefault();window.print()};
document.getElementById('gv').onchange=function(){act=this.value;save();render()};
document.getElementById('gbody').addEventListener('click',function(e){var a=e.target.closest('a');if(!a)return;var v=cur();if(!v)return;
 if(a.id==='gedit'){e.preventDefault();form(v)}
 else if(a.id==='gdel'){e.preventDefault();if(a.dataset.c){V=V.filter(function(x){return x!==v});act=V[0]&&V[0].id;save();render()}else{a.dataset.c=1;a.textContent='Clicca di nuovo per confermare'}}
 else if(a.id==='guse'){e.preventDefault();save();window.top.location.href=String(v.val).indexOf('d86')===0?'d86set?eng='+String(v.val).slice(3)+'&p=1':'setval?val='+(v.val||CUR.val)+'&prod='+(v.prod||CUR.prod)+'&node='+(String(v.val||CUR.val).indexOf('250')===0?'250000123':'244000595')}
 else if(a.id==='cadd'){e.preventDefault();a.parentNode.innerHTML='<input id="cn" placeholder="Nome (es. Olio motore e filtro)" style="width:40%"> ogni <input id="ck" type="number" value="10000" style="width:80px"> km o <input id="cm" type="number" value="12" style="width:50px"> mesi <a href="#" id="csave" class="gbtn">Salva</a>';document.getElementById('cn').focus()}
 else if(a.id==='csave'){e.preventDefault();var nm=document.getElementById('cn').value.trim();if(!nm)return;v.custom.push({key:'c'+Date.now()+' '+nm,name:nm,km:+document.getElementById('ck').value||0,months:+document.getElementById('cm').value||0,custom:1});save();render()}
 else if(a.dataset.cdel!=null){e.preventDefault();var ci=plan0(v)[+a.dataset.cdel];v.custom=v.custom.filter(function(c){return c!==ci});save();render()}
 else if(a.id==='gkm'){e.preventDefault();var inp=document.createElement('input');inp.type='number';inp.value=v.km||'';inp.className='gkmi';a.replaceWith(inp);inp.focus();inp.onkeydown=function(k){if(k.key==='Enter'){v.km=+inp.value||v.km;save();render()}};inp.onblur=function(){v.km=+inp.value||v.km;save();render()}}
 else if(a.dataset.done!=null){e.preventDefault();var it=plan0(v)[+a.dataset.done];v.maint[it.key]={date:new Date().toISOString().slice(0,10),km:+v.km||0};v.log.push({id:'l'+Date.now(),date:new Date().toISOString().slice(0,10),km:+v.km||0,desc:it.name,ric:'',ore:'',costo:''});save();render()}
 else if(a.id==='ladd'){e.preventDefault();var g=function(i){return document.getElementById(i).value.trim()};if(!g('ldesc'))return;var km=+g('lk')||0;v.log.push({id:'l'+Date.now(),date:g('ld'),km:km,desc:g('ldesc'),ric:g('lr'),ore:g('lo'),costo:g('lc')});if(km>(+v.km||0))v.km=km;save();render()}
 else if(a.dataset.dl){e.preventDefault();v.log=v.log.filter(function(l){return l.id!==a.dataset.dl});save();render()}
});
render();
</script></body></HTML>`;
  return h;
}

// ---------------------------------------------------------------- PDF DI UN CAPITOLO INTERO
function chapterPage(db, st, nodeId) {
  const g = db.elements.get(nodeId);
  if (!g) return errorPage(db, st, nodeId, 15);
  const val = db.validities.find((v) => v.ID === st.val) || { NAME: '' };
  const prod = db.productions.find((p) => p.ID === st.prod) || { NAME: '' };
  const leaves = [];
  const walk = (id, depth) => {
    for (const c of db.validChildren(id, st.val, st.prod)) {
      if (db.xmlByEl.has(c.ID)) leaves.push({ e: c, depth });
      else { leaves.push({ e: c, depth, head: true }); walk(c.ID, depth + 1); }
    }
  };
  walk(nodeId, 0);
  let h = contentHead(db, st, 'DucatONE - ' + label(g)) + '</HEAD><body class="chapter">\n';
  h += `<div class="ctitle"><img src="./app/logo@2x.jpg"><h1>${esc(label(g))}</h1><p>Fiat Ducato · ${esc(val.NAME)} · ${esc(prod.NAME)}</p><p class="cdate">Creato con DucatONE il ${new Date().toLocaleDateString('it-IT')}</p></div>`;
  h += `<div class="cindex"><h2>Indice</h2>${leaves.map((l, i) => `<div class="ci d${Math.min(l.depth, 3)}${l.head ? ' h' : ''}">${l.head ? '' : `<a href="#p${i}">`}${esc(label(l.e))}${l.head ? '' : '</a>'}</div>`).join('')}</div>`;
  leaves.forEach((l, i) => {
    if (l.head) return;
    const sec = db.sectionOf.get(l.e.ID);
    const xsl = db.xslFor(l.e.ID);
    h += `<div class="cpage"><h2 class="cph" id="p${i}">${esc(label(l.e))}</h2>${renderXmlList(db, st, db.validXml(l.e.ID, st.val, st.prod), /schemi_elettrici/.test(xsl) ? 'schemi_print' : xsl, null)}</div>`;
  });
  return h + '\n</body></HTML>';
}

module.exports = {
  x250GetPage,
  _h: { T: (n) => T(n), withMeta: (h) => withMeta(h), markCss: (d, m) => markCss(d, m), esc: (x) => esc(x), contentHead: (d, s, t) => contentHead(d, s, t), highlight: (a, b) => highlight(a, b), snippet: (a, b) => snippet(a, b), norm: (x) => norm(x), lev: (a, b, m) => lev(a, b, m) },
  garagePage,
  chapterPage,
  splitPage,
  quickPage,
  toolsPage,
  worksheetPage,
  warmSearch,
  homePage,
  modelsPage,
  mainPage,
  contentPage,
  zoomPage,
  zoomCompPage,
  printPage,
  searchPage,
  favoritesPage,
  guidePage,
  ricambiPage,
  videoPage,
  historyPage,
  treeHtml,
  resolveNode,
  errorPage,
};
