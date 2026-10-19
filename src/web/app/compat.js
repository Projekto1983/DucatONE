// Compatibilità IE -> Chromium e funzioni aggiuntive per le pagine eLearn
(function () {
  if (!window.navigate) {
    window.navigate = function (u) {
      if (/^javascript:/i.test(u)) { (0, eval)(u.replace(/^javascript:/i, '')); return; }
      window.location.href = u;
    };
  }
  var app = null;
  try { app = window.elearnApp || window.top.elearnApp || null; } catch (e) {}

  function mainWin() {
    var w = null;
    try { w = window.top.opener; } catch (e) {}
    try { if (w && w.top) w = w.top; } catch (e) {}
    return w;
  }
  window.goMain = function (id) {
    var url = 'main.html?node=' + id;
    var w = mainWin();
    if (w && !w.closed) {
      w.location.href = url;
      if (app) app.focusMain();
      try { w.focus(); } catch (e) {}
    } else {
      window.top.location.href = url;
    }
  };
  window.openHelp = function () {
    var w = window.open('help.html', 'WinHelp', 'width=820,height=640,scrollbars=yes');
    if (w) w.focus();
  };
  window.exitApp = function () { if (app) app.exit(); else window.close(); };
  window.quickSearch = function (q) {
    q = (q || '').trim();
    if (!q) return;
    var w = window.open('search.html?go=1&q=' + encodeURIComponent(q), 'WinSearch', 'scrollbars=yes,width=560,height=520');
    if (w) w.focus();
  };
  // esporta in PDF il documento indicato (finestra o frame)
  window.exportPdf = function (target) {
    var href = location.href;
    try { if (target && target.location) href = target.location.href; } catch (e) {}
    if (app) app.exportPdf(href);
  };
  window.printDoc = function (target) {
    try { (target || window).focus(); (target || window).print(); } catch (e) { window.print(); }
  };

  // ------------------------------------------------ zoom automatico (adatta allo schermo) + Ctrl +/-/0
  var isMainView = false, isPopup = false;
  try { isPopup = !!window.top.opener; } catch (e) {}
  isMainView = !isPopup;
  var KEY = isMainView ? 'elearn.zoom.main' : 'elearn.zoom.popup';
  function userZoom() { try { return parseFloat(localStorage.getItem(KEY)) || 1; } catch (e) { return 1; } }
  function setUserZoom(v) { try { localStorage.setItem(KEY, String(v)); } catch (e) {} }
  function themeOn(k) { try { return localStorage.getItem('elearn.theme.' + k) === '1'; } catch (e) { return false; } }
  function autoZoom() {
    if (!isMainView) return 1;
    if (themeOn('big')) return Math.max(1.3, Math.min(2.2, (window.top.innerHeight || 768) / 560));
    var h = window.top.innerHeight || 768;
    return Math.max(1, Math.min(1.8, h / 700));
  }
  function applyZoom() {
    if (window !== window.top) return; // gli iframe ereditano lo zoom della pagina
    var f = autoZoom() * userZoom();
    document.documentElement.style.zoom = f.toFixed(3);
  }
  // modalità notte: inverte i colori della pagina principale (gli iframe ereditano il filtro)
  if (themeOn('night') && window !== window.top) document.documentElement.classList.add('notte-in');
  window.__elearnApplyZoom = applyZoom;
  applyZoom();
  window.addEventListener('resize', applyZoom);
  document.addEventListener('keydown', function (e) {
    if (!e.ctrlKey) return;
    var z = userZoom();
    if (app && (e.key === 't' || e.key === 'T')) { e.preventDefault(); app.tabNew(); return; }
    if (app && (e.key === 'w' || e.key === 'W')) { e.preventDefault(); app.tabClose(); return; }
    if (app && e.key === 'Tab') { e.preventDefault(); app.tabCycle(e.shiftKey ? -1 : 1); return; }
    if (e.key === '+' || e.key === '=') z = Math.min(3, z * 1.1);
    else if (e.key === '-') z = Math.max(0.5, z / 1.1);
    else if (e.key === '0') z = 1;
    else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); var fm = null; try { fm = window.top.framemain; } catch (x) {} printDoc(fm || window); return; }
    else return;
    e.preventDefault();
    setUserZoom(z);
    try { window.top.__elearnApplyZoom(); } catch (x) { applyZoom(); }
  });

  // ------------------------------------------------ immagini: clic per ingrandire
  function openViewer(src) {
    var t = '';
    try { var m = document.querySelector('meta[name="elnode"]'); if (m) t = m.content; } catch (e) {}
    var w = window.top.open('app/viewer.html?src=' + encodeURIComponent(src) + '&t=' + encodeURIComponent(t), 'WinImg', 'width=1100,height=820,scrollbars=no');
    if (w) w.focus();
  }
  function markImages() {
    var imgs = document.querySelectorAll('img[src*="elearn://app/data/"]');
    for (var i = 0; i < imgs.length; i++) {
      var im = imgs[i];
      if (im.closest('a')) continue;
      var ok = function (el) { return (el.naturalWidth || 0) >= 120; };
      (function (el) {
        var set = function () { if (ok(el)) { el.classList.add('zoomable'); el.title = el.title || 'Clic per aprire l\'immagine (zoom e stampa)'; } };
        if (el.complete) set(); else el.addEventListener('load', set);
        el.addEventListener('click', function () { if (el.classList.contains('zoomable')) openViewer(el.src); });
      })(im);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', markImages); else markImages();

  // ------------------------------------------------ link interni Stacco / Riattacco: scorre e evidenzia la sezione
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('a[href^="#"]');
    if (!a) return;
    var id = decodeURIComponent(a.getAttribute('href').slice(1));
    if (!id) return;
    var t = document.querySelector('a[name="' + id.replace(/"/g, '') + '"]') || document.getElementById(id);
    if (!t) {
      var miss = window.__missingAnchors && window.__missingAnchors[id];
      if (miss) { ev.preventDefault(); phaseNotice(a, miss); }
      return;
    }
    ev.preventDefault();
    var box = t.closest('td') || t.parentElement || t;
    // nei layout a tabella la cella può contenere più sezioni: evidenzia dal titolo fino al titolo successivo
    var start = t.previousSibling, nodes = [];
    var el = t;
    while (el && el.previousElementSibling && el.previousElementSibling.tagName === 'IMG') el = el.previousElementSibling;
    var cur = el;
    while (cur) {
      if (cur !== el && cur.nodeType === 1 && cur.matches && cur.matches('a.title')) break;
      if (cur.nodeType === 1 && cur.tagName === 'IMG' && cur.nextSibling && cur.nextElementSibling && cur.nextElementSibling.matches && cur.nextElementSibling.matches('a.title') && cur !== el && nodes.length) break;
      nodes.push(cur);
      cur = cur.nextSibling;
    }
    var rect = box.getBoundingClientRect();
    var hl = document.createElement('div');
    hl.className = 'flashbox';
    hl.style.left = (rect.left + window.scrollX - 4) + 'px';
    hl.style.top = (rect.top + window.scrollY - 4) + 'px';
    hl.style.width = (rect.width + 8) + 'px';
    hl.style.height = (rect.height + 8) + 'px';
    document.body.appendChild(hl);
    (nodes[0] && nodes[0].nodeType === 1 ? nodes[0] : t).scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(function () { hl.style.opacity = '0'; }, 1400);
    setTimeout(function () { hl.remove(); }, 2200);
  });


  // fase non disponibile per la motorizzazione corrente: avviso con pulsanti per cambiarla
  function phaseNotice(a, opts) {
    var old = document.getElementById('phasebox');
    if (old) old.remove();
    var name = (a.textContent || '').replace(/\s+/g, ' ').trim() || 'richiesta';
    var box = document.createElement('div');
    box.id = 'phasebox';
    box.className = 'phasebox';
    var html = opts.length
      ? '<b>La fase «' + esc(name) + '» è disponibile solo per ' + opts.map(function (o) { return esc(o.label); }).join(', ') + '.</b><div class="pbtns">' +
        opts.map(function (o, i) { return '<button data-i="' + i + '">Passa a ' + esc(o.label) + '</button>'; }).join('') + '<button class="pclose">Chiudi</button></div>'
      : '<b>La fase «' + esc(name) + '» non è presente nel manuale originale.</b><div class="pbtns"><button class="pclose">Chiudi</button></div>';
    box.innerHTML = html;
    document.body.appendChild(box);
    var r = a.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - box.offsetWidth - 8)) + 'px';
    box.style.top = (r.bottom + window.scrollY + 6) + 'px';
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.classList.contains('pclose')) return box.remove();
      var o = opts[+b.getAttribute('data-i')];
      (window.parent || window).location.href = o.url;
    });
    setTimeout(function () {
      document.addEventListener('mousedown', function off(e) { if (!box.contains(e.target)) { box.remove(); document.removeEventListener('mousedown', off); } });
    }, 0);
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function markMissing() {
    var m = window.__missingAnchors;
    if (!m) return;
    document.querySelectorAll('a.title_link[href^="#"]').forEach(function (a) {
      var o = m[decodeURIComponent(a.getAttribute('href').slice(1))];
      if (o) { a.classList.add(o.length ? 'otherval' : 'nophase'); a.title = o.length ? 'Disponibile per un\'altra motorizzazione' : 'Fase non presente nel manuale originale'; }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', markMissing); else markMissing();

  // ------------------------------------------------ Ctrl+clic o clic centrale: apri in una nuova scheda
  function tabLink(ev) {
    if (!app) return;
    var a = ev.target.closest && ev.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (!/main\.html\?node=|search\.html|favorites\.html|history\.html|ricambi\.html|video\.html|guida\.html/.test(href)) return;
    if (!(ev.ctrlKey || ev.button === 1)) return;
    ev.preventDefault();
    var u = new URL(href, location.href).href;
    if (!/main\.html/.test(u)) u = new URL('main.html?node=' + (window.top.__curNode || ''), location.href).href;
    app.tabOpen(u);
  }
  document.addEventListener('click', tabLink, true);
  document.addEventListener('auxclick', tabLink, true);

  // ------------------------------------------------ albero di navigazione: apri/chiudi rami
  document.addEventListener('click', function (ev) {
    if (ev.ctrlKey || ev.button) return;
    // sezione già selezionata: un secondo clic chiude/riapre il suo albero
    var sec = ev.target.closest && ev.target.closest('a.menulateraleIlivSel');
    if (sec && sec.nextElementSibling && sec.nextElementSibling.classList.contains('tree')) {
      ev.preventDefault();
      var tr = sec.nextElementSibling;
      tr.style.display = tr.style.display === 'none' ? '' : 'none';
      return;
    }
    // categoria già aperta: il clic sul nome la chiude
    var la = ev.target.closest && ev.target.closest('.tree li.op > a');
    if (la) {
      ev.preventDefault();
      la.parentNode.classList.remove('op'); la.parentNode.classList.add('cl');
      return;
    }
    var tg = ev.target.closest && ev.target.closest('.tree i.tg');
    if (!tg) return;
    ev.preventDefault();
    var li = tg.parentNode;
    if (li.classList.contains('op')) { li.classList.remove('op'); li.classList.add('cl'); return; }
    li.classList.remove('cl'); li.classList.add('op');
    if (!li.querySelector('ul')) {
      fetch('tree?node=' + li.getAttribute('data-id')).then(function (r) { return r.text(); }).then(function (t) { li.insertAdjacentHTML('beforeend', t); });
    }
  });
  window.addEventListener('load', function () {
    var c = document.querySelector('.tree li.cur'), tr = document.querySelector('div.tree');
    if (c && tr) tr.scrollTop = Math.max(0, c.offsetTop - tr.offsetTop - tr.clientHeight / 2);
    window.scrollTo(0, 0);
  });

  // ------------------------------------------------ note personali
  document.addEventListener('click', function (ev) {
    var box = ev.target.closest && ev.target.closest('.notebox');
    if (!box) return;
    var t = ev.target, q = function (s) { return box.querySelector(s); };
    function save(text) {
      fetch('note?node=' + box.getAttribute('data-node'), { method: 'POST', body: text }).then(function () {
        q('.ntext').innerHTML = text.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }).replace(/\n/g, '<br>');
        q('.ndate').textContent = text.trim() ? new Date().toLocaleDateString('it-IT') : '';
        q('.nform').style.display = 'none';
        q('.nview').style.display = text.trim() ? '' : 'none';
        q('.nadd').style.display = text.trim() ? 'none' : '';
        box.classList.toggle('has', !!text.trim());
      });
    }
    if (t.matches('.nadd, .nedit')) { ev.preventDefault(); q('.nform').style.display = ''; q('.nadd').style.display = 'none'; q('textarea').focus(); }
    else if (t.matches('.nsave')) { ev.preventDefault(); save(q('textarea').value); }
    else if (t.matches('.ndel')) { ev.preventDefault(); q('textarea').value = ''; save(''); }
    else if (t.matches('.ncancel')) { ev.preventDefault(); q('.nform').style.display = 'none'; if (!box.classList.contains('has')) q('.nadd').style.display = ''; }
  });

  // ================================================ FUNZIONI DUCATONE 2.2
  function A() { try { return window.elearnApp || window.top.elearnApp || null; } catch (e) { return null; } }
  function kvGet(k) { var a = A(); try { return a && a.kvGet ? a.kvGet(k) : null; } catch (e) { return null; } }
  function kvSet(k, v) { var a = A(); try { a && a.kvSet && a.kvSet(k, v); } catch (e) {} }
  function onReady(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  function stepsOf(root) {
    return Array.prototype.filter.call((root || document).querySelectorAll('p.contents_testonormale'), function (p) {
      return !p.closest('.actbar,.linkbox,.notebox') && /^\s*\d+\s*[.)]/.test(p.textContent);
    });
  }

  // ---- checklist dei passaggi
  function checklist(bar, on) {
    var node = bar.getAttribute('data-node'), steps = stepsOf(), all = kvGet('checks') || {}, done = all[node] || [];
    var btn = bar.querySelector('.ab-check');
    document.body.classList.toggle('chk-on', on);
    btn.classList.toggle('on', on);
    function paint() {
      var n = 0;
      steps.forEach(function (p, i) { var d = done.indexOf(i) >= 0; p.classList.toggle('done', d); if (d) n++; });
      btn.textContent = on ? '☑ Checklist ' + n + '/' + steps.length : '☑ Checklist';
      var r = bar.querySelector('.ab-reset');
      if (!r) { r = document.createElement('a'); r.href = '#'; r.className = 'ab-reset'; r.textContent = '↺ azzera'; btn.after(r); }
      r.style.display = on && n ? '' : 'none';
    }
    steps.forEach(function (p, i) {
      p.classList.add('step');
      p.onclick = on ? function (ev) {
        if (ev.target.closest('a')) return;
        var k = done.indexOf(i);
        if (k >= 0) done.splice(k, 1); else done.push(i);
        all[node] = done; kvSet('checks', all); paint();
      } : null;
    });
    paint();
    btn._reset = function () { done = []; all[node] = done; kvSet('checks', all); paint(); };
  }

  // ---- presentazione: una foto e un passaggio alla volta
  function presentation() {
    var slides = [];
    document.querySelectorAll('tr').forEach(function (tr) {
      if (tr.closest('.actbar,.linkbox,.notebox')) return;
      var img = Array.prototype.find.call(tr.querySelectorAll(':scope > td img.contents_jpeg, :scope > td img'), function (i) { return !/none\.gif|\/\d{1,2}\.image$/.test(i.src) && i.naturalWidth > 40; });
      var text = Array.prototype.filter.call(tr.children, function (td) { return !td.contains(img); }).map(function (td) { return td.innerHTML; }).join('');
      if (img && text.replace(/<[^>]+>/g, '').trim()) slides.push({ img: img.src, html: text });
    });
    if (!slides.length) stepsOf().forEach(function (p) { slides.push({ img: '', html: p.outerHTML }); });
    if (!slides.length) return alertBox('Questa pagina non contiene passaggi da mostrare in presentazione.');
    var i = 0, ov = document.createElement('div');
    ov.className = 'pres';
    ov.innerHTML = '<div class="pimg"></div><div class="ptext"></div><button class="pprev">◀</button><button class="pnext">▶</button><div class="pbar"><span class="pcount"></span> <button class="pclose">✕ Chiudi (Esc)</button></div>';
    document.body.appendChild(ov);
    function show() {
      var sl = slides[i];
      ov.querySelector('.pimg').innerHTML = sl.img ? '<img src="' + sl.img + '">' : '';
      ov.querySelector('.pimg').style.display = sl.img ? '' : 'none';
      ov.querySelector('.ptext').innerHTML = sl.html;
      ov.querySelector('.pcount').textContent = (i + 1) + ' / ' + slides.length;
    }
    function go(d) { i = Math.max(0, Math.min(slides.length - 1, i + d)); show(); }
    function close() { document.removeEventListener('keydown', key); if (document.fullscreenElement) document.exitFullscreen().catch(function () {}); ov.remove(); }
    function key(e) { if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); go(1); } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(-1); } else if (e.key === 'Escape') close(); }
    ov.querySelector('.pprev').onclick = function () { go(-1); };
    ov.querySelector('.pnext').onclick = function () { go(1); };
    ov.querySelector('.pclose').onclick = close;
    document.addEventListener('keydown', key);
    document.addEventListener('fullscreenchange', function f() { if (!document.fullscreenElement && ov.isConnected) { document.removeEventListener('fullscreenchange', f); close(); } });
    show();
    if (ov.requestFullscreen) ov.requestFullscreen().catch(function () {});
  }
  function alertBox(msg) {
    var d = document.createElement('div'); d.className = 'phasebox'; d.style.position = 'fixed'; d.style.left = '30%'; d.style.top = '30%';
    d.innerHTML = '<b></b><div class="pbtns"><button class="pclose">Chiudi</button></div>';
    d.querySelector('b').textContent = msg; d.querySelector('button').onclick = function () { d.remove(); };
    document.body.appendChild(d);
  }

  onReady(function () {
    var bar = document.querySelector('.actbar[data-node]');
    if (bar) {
      var node = bar.getAttribute('data-node');
      if (stepsOf().length < 2) bar.querySelector('.ab-check').style.display = 'none';
      bar.addEventListener('click', function (ev) {
        var a = ev.target.closest('a'); if (!a) return; ev.preventDefault();
        var app = A();
        if (a.classList.contains('ab-check')) {
          checklist(bar, !a.classList.contains('on'));
        } else if (a.classList.contains('ab-reset')) {
          var cb = bar.querySelector('.ab-check'); if (cb._reset) cb._reset();
        } else if (a.classList.contains('ab-sheet')) {
          var u = new URL('worksheet.html?node=' + node, location.href).href;
          if (app && app.tabOpen) app.tabOpen(u); else window.open(u);
        } else if (a.classList.contains('ab-pres')) presentation();
        else if (a.classList.contains('ab-split')) {
          var l = new URL('main.html?node=' + node, location.href).href;
          try { window.top.location.href = new URL('split.html?l=' + encodeURIComponent(l) + '&r=' + encodeURIComponent(new URL('models.html', location.href).href), location.href).href; } catch (e) {}
        } else if (a.classList.contains('ab-report')) {
          if (app && app.reportPage) app.reportPage({ node: node, title: bar.getAttribute('data-title') });
        }
      });
      if (((kvGet('checks') || {})[node] || []).length) checklist(bar, true);
    }
    // video collegati / schede video: apertura nel popup
    document.addEventListener('click', function (ev) {
      var c = ev.target.closest && ev.target.closest('a.vcard[data-vid]');
      if (!c || document.querySelector('.videog')) return;
      ev.preventDefault();
      var app = A();
      if (app && app.openVideo) app.openVideo(c.getAttribute('data-vid'), c.getAttribute('data-title'));
    });
    glossary();
    wireLegend();
  });

  // ---- glossario: sigle sottolineate con spiegazione al passaggio del mouse
  function glossary() {
    var G = window.DUCATONE_GLOSS;
    if (!G || !document.querySelector('.notebox, .actbar')) return;
    var keys = Object.keys(G).sort(function (a, b) { return b.length - a.length; });
    var re = new RegExp('(^|[^A-Za-z0-9.])(' + keys.map(function (k) { return k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')(?![A-Za-z0-9])', 'g');
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentNode;
        if (!p || /^(SCRIPT|STYLE|A|ABBR|TEXTAREA|INPUT|BUTTON|TITLE)$/.test(p.nodeName) || p.closest('.actbar,.notebox,.linkbox,.phasebox')) return NodeFilter.FILTER_REJECT;
        re.lastIndex = 0;
        return re.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    var list = [], n;
    while ((n = walker.nextNode())) list.push(n);
    list.slice(0, 400).forEach(function (t) {
      var frag = document.createDocumentFragment(), s = t.nodeValue, last = 0, m;
      re.lastIndex = 0;
      while ((m = re.exec(s))) {
        var st = m.index + m[1].length;
        frag.appendChild(document.createTextNode(s.slice(last, st)));
        var ab = document.createElement('abbr'); ab.className = 'gl'; ab.title = G[m[2]]; ab.textContent = m[2];
        frag.appendChild(ab);
        last = st + m[2].length;
      }
      frag.appendChild(document.createTextNode(s.slice(last)));
      t.parentNode.replaceChild(frag, t);
    });
  }

  // ---- legenda colori cavi sulle pagine con schema elettrico
  function wireLegend() {
    var W = window.DUCATONE_WIRES;
    if (!W || !document.querySelector('embed[src*=".image"], object[data*=".image"], iframe[src*="zoom"]')) return;
    var b = document.createElement('div'); b.className = 'wleg';
    b.innerHTML = '<a href="#" class="wbtn">🎨 Colori cavi</a><div class="wpan"><b>Colori dei cavi</b> <small>(1ª lettera colore base, 2ª striscia)</small><div class="wgrid">' +
      W.map(function (w) { return '<span><i style="background:' + w[2] + '"></i><b>' + w[0] + '</b> ' + w[1] + '</span>'; }).join('') + '</div></div>';
    document.body.appendChild(b);
    b.querySelector('.wbtn').onclick = function (e) { e.preventDefault(); b.classList.toggle('open'); };
  }

  // ---- foto personali allegate alla pagina
  document.addEventListener('click', function (ev) {
    var box = ev.target.closest && ev.target.closest('.photobox');
    if (!box) return;
    var app = A(), node = box.getAttribute('data-node');
    if (ev.target.closest('.phadd')) {
      ev.preventDefault();
      if (app && app.photoAdd) app.photoAdd(node).then(function (r) { if (r && r.ok) location.reload(); });
    } else if (ev.target.closest('.phdel')) {
      ev.preventDefault();
      var a = ev.target.closest('.phdel'), img = a.parentNode.querySelector('img');
      if (!a.dataset.c) { a.dataset.c = 1; a.textContent = 'Elimina?'; a.classList.add('conf'); return; }
      if (app && app.photoDel) app.photoDel(node, img.getAttribute('data-f')).then(function () { a.parentNode.remove(); });
    } else if (ev.target.tagName === 'IMG') {
      ev.preventDefault();
      openViewer(ev.target.src);
    }
  });

  // ---- schemi: ricerca nella tabella dei componenti
  onReady(function () {
    var tables = Array.prototype.filter.call(document.querySelectorAll('table'), function (t) {
      var first = t.rows && t.rows[0] && t.rows[0].cells[0];
      return first && /codice\s+componente|component code|code composant|bauteil|c[oó]digo\s+(del\s+)?componente/i.test(first.textContent) && t.rows.length > 3;
    });
    tables.forEach(function (t) {
      var box = document.createElement('div');
      box.className = 'compsearch';
      box.innerHTML = '🔎 <input type="search" placeholder="Cerca componente (codice o nome, es. B001, relè, fusibile)…"> <span></span>';
      t.parentNode.insertBefore(box, t);
      var inp = box.querySelector('input'), info = box.querySelector('span');
      inp.addEventListener('input', function () {
        var v = inp.value.toLowerCase().trim(), n = 0;
        for (var i = 1; i < t.rows.length; i++) {
          var r = t.rows[i], ok = !v || r.textContent.toLowerCase().indexOf(v) >= 0;
          r.style.display = ok ? '' : 'none';
          r.classList.toggle('comphit', !!v && ok);
          if (v && ok) n++;
        }
        info.textContent = v ? n + ' component' + (n === 1 ? 'e' : 'i') : '';
      });
    });
    if (tables.length && document.querySelector('.wleg .wpan')) {
      var p = document.createElement('div'); p.className = 'whint';
      p.textContent = 'Clic su un filo dello schema per evidenziarne tutto il percorso; doppio clic per tornare alla vista iniziale.';
      document.querySelector('.wleg .wpan').appendChild(p);
    }
  });
})();
