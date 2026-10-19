// Pulsantiera di navigazione schemi elettrici (equivalente moderno della versione per Adobe SVG Viewer)
var __svgStart = {};

function __svgRoot(img) {
  if (typeof img === 'string') img = document.getElementById(img);
  var d = null;
  try { d = img.getSVGDocument ? img.getSVGDocument() : null; } catch (e) {}
  if (!d) { try { d = img.contentDocument; } catch (e) {} }
  if (!d || !d.documentElement) return null;
  var r = d.documentElement;
  var key = img.id || img.src;
  if (!__svgStart[key]) {
    var vb = r.getAttribute('viewBox');
    if (!vb) {
      var w = parseFloat(r.getAttribute('width')) || 734, h = parseFloat(r.getAttribute('height')) || 447;
      vb = '0 0 ' + w + ' ' + h;
      r.setAttribute('viewBox', vb);
    }
    __svgStart[key] = vb;
  }
  r.__key = key;
  return r;
}

function __vb(r) {
  return r.getAttribute('viewBox').trim().split(/[\s,]+/).map(Number);
}

function svgBase(img) {
  var r = __svgRoot(img); if (!r) return;
  r.setAttribute('viewBox', __svgStart[r.__key]);
}

function svgZoom(img, f) {
  var r = __svgRoot(img); if (!r) return;
  var c = __vb(r);
  var cx = c[0] + c[2] / 2, cy = c[1] + c[3] / 2;
  var w = c[2] * f, h = c[3] * f;
  r.setAttribute('viewBox', [cx - w / 2, cy - h / 2, w, h].join(' '));
}

function svgMove(img, x, y) {
  var r = __svgRoot(img); if (!r) return;
  var c = __vb(r);
  var k = c[2] / 100;
  c[0] -= x * k; c[1] -= y * k;
  r.setAttribute('viewBox', c.join(' '));
}

// Rotella del mouse = zoom sul punto indicato, trascinamento = spostamento
function __svgInteractive(emb) {
  if (emb.__ia) return;
  var r = __svgRoot(emb);
  if (!r) return;
  emb.__ia = true;
  var d = r.ownerDocument;
  r.style.cursor = /zoom(comp)?\.html/.test(location.href) ? 'grab' : 'pointer';
  function toSvg(cx, cy) {
    var p = r.createSVGPoint(); p.x = cx; p.y = cy;
    var m = r.getScreenCTM();
    return m ? p.matrixTransform(m.inverse()) : p;
  }
  var zoomPage = /zoom(comp)?\.html/.test(location.href);
  d.addEventListener('wheel', function (e) {
    // nelle pagine del manuale la rotella scorre la pagina; Ctrl+rotella (o la finestra ingrandita) zooma lo schema
    if (!zoomPage && !e.ctrlKey) { window.scrollBy(0, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY); return; }
    e.preventDefault();
    var f = e.deltaY < 0 ? 1 / 1.15 : 1.15;
    var c = __vb(r), p = toSvg(e.clientX, e.clientY);
    r.setAttribute('viewBox', [p.x - (p.x - c[0]) * f, p.y - (p.y - c[1]) * f, c[2] * f, c[3] * f].join(' '));
  }, { passive: false });
  var drag = null;
  d.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, vb: __vb(r), m: r.getScreenCTM() };
    r.style.cursor = 'grabbing'; e.preventDefault();
  });
  d.addEventListener('mousemove', function (e) {
    if (!drag) return;
    var sx = drag.m ? drag.m.a : 1, sy = drag.m ? drag.m.d : 1;
    var c = drag.vb.slice();
    c[0] -= (e.clientX - drag.x) / sx; c[1] -= (e.clientY - drag.y) / sy;
    r.setAttribute('viewBox', c.join(' '));
  });
  var stop = function () { drag = null; r.style.cursor = 'grab'; };
  d.addEventListener('mouseup', function (e) {
    if (drag && Math.abs(e.clientX - drag.x) < 4 && Math.abs(e.clientY - drag.y) < 4) {
      var had = (r.__hl || []).length;
      var hit = __wireClick(r, e.target);
      if (!hit && !had && !zoomPage) __openZoom(emb);
    }
    stop();
  });
  d.addEventListener('mouseleave', stop);
  d.addEventListener('dblclick', function () { svgBase(emb); });
}
function __svgScan() {
  var es = document.querySelectorAll('embed[type="image/svg+xml"]');
  for (var i = 0; i < es.length; i++) {
    (function (e) {
      if (!e.id) e.id = 'svgemb' + i;
      e.addEventListener('load', function () { __svgInteractive(e); });
      __svgInteractive(e);
    })(es[i]);
  }
}
window.addEventListener('load', function () { __svgScan(); setTimeout(__svgScan, 800); });

// ---- clic su un filo: evidenzia tutto il percorso collegato
function __wireList(r) {
  if (r.__wires) return r.__wires;
  var d = r.ownerDocument, view = d.defaultView, out = [];
  var els = r.querySelectorAll('rect, line, polyline, path');
  function tr(m, p) { return [m.a * p[0] + m.c * p[1] + m.e, m.b * p[0] + m.d * p[1] + m.f]; }
  for (var i = 0; i < els.length; i++) {
    var el = els[i], cs = view.getComputedStyle(el), m = el.getCTM();
    if (!cs || !m) continue;
    var sc = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)), pts = [], sw, kind;
    if (el.tagName === 'rect') {
      // i fili spessi sono rettangoli sottili pieni
      if (cs.fill === 'none') continue;
      var x = +el.getAttribute('x') || 0, y = +el.getAttribute('y') || 0, w = +el.getAttribute('width') || 0, h = +el.getAttribute('height') || 0;
      var th = Math.min(w, h), ln = Math.max(w, h);
      if (th <= 0 || th > 3 || ln < th * 3) continue;
      pts = w >= h ? [[x, y + h / 2], [x + w, y + h / 2]] : [[x + w / 2, y], [x + w / 2, y + h]];
      sw = th * sc; kind = 'fill';
    } else {
      if (cs.stroke === 'none' || (cs.fill && cs.fill !== 'none' && cs.fill !== 'transparent')) continue;
      sw = (parseFloat(cs.strokeWidth) || 1) * sc;
      if ((parseFloat(cs.strokeWidth) || 1) < 0.8) continue; // contorni sottili dei componenti
      if (el.tagName === 'line') pts = [[+el.getAttribute('x1') || 0, +el.getAttribute('y1') || 0], [+el.getAttribute('x2') || 0, +el.getAttribute('y2') || 0]];
      else if (el.tagName === 'polyline') { var a = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number); for (var k = 0; k + 1 < a.length; k += 2) pts.push([a[k], a[k + 1]]); }
      else { try { var L = el.getTotalLength(), n = Math.max(2, Math.min(150, Math.ceil(L / 3))); for (var k2 = 0; k2 <= n; k2++) { var q = el.getPointAtLength(L * k2 / n); pts.push([q.x, q.y]); } } catch (e) { continue; } }
      kind = 'stroke';
    }
    if (pts.length < 2) continue;
    out.push({ el: el, pts: pts.map(function (p) { return tr(m, p); }), sw: sw, kind: kind });
  }
  return (r.__wires = out);
}
function __dSeg(p, a, b) {
  var dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy, t = l ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l : 0;
  t = Math.max(0, Math.min(1, t));
  var x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
  return Math.sqrt(x * x + y * y);
}
function __touch(A, B, tol) {
  var ends = [A.pts[0], A.pts[A.pts.length - 1]];
  for (var i = 0; i < 2; i++) for (var k = 0; k + 1 < B.pts.length; k++) if (__dSeg(ends[i], B.pts[k], B.pts[k + 1]) <= tol) return true;
  return false;
}
function __wireClear(r) {
  (r.__hl || []).forEach(function (w) { if (w.kind === 'fill') w.el.style.fill = w.o; else { w.el.style.stroke = w.o; w.el.style.strokeWidth = w.ow; } });
  r.__hl = [];
}
function __wireClick(r, target) {
  __wireClear(r);
  var W = __wireList(r), start = null;
  for (var i = 0; i < W.length; i++) if (W[i].el === target) { start = W[i]; break; }
  if (!start) return false;
  var tol = Math.max(0.6, start.sw * 0.9), seen = [start], q = [start];
  while (q.length && seen.length < 500) {
    var x = q.shift();
    for (var j = 0; j < W.length; j++) {
      var y = W[j];
      if (seen.indexOf(y) >= 0 || Math.abs(y.sw - start.sw) > Math.max(0.4, start.sw * 0.4)) continue;
      if (__touch(x, y, tol) || __touch(y, x, tol)) { seen.push(y); q.push(y); }
    }
  }
  r.__hl = seen.map(function (w) {
    if (w.kind === 'fill') { var o = { el: w.el, kind: 'fill', o: w.el.style.fill }; w.el.style.fill = '#ff5a00'; return o; }
    var o2 = { el: w.el, kind: 'stroke', o: w.el.style.stroke, ow: w.el.style.strokeWidth };
    w.el.style.stroke = '#ff5a00';
    return o2;
  });
  return true;
}
// clic su un punto vuoto dello schema: apre lo schema ingrandito nella finestra a parte
function __openZoom(emb) {
  var links = document.querySelectorAll('a[href*="zoom.html"], a[href*="openWinZoom"]');
  var best = null;
  for (var i = 0; i < links.length; i++) { if (emb.compareDocumentPosition(links[i]) & Node.DOCUMENT_POSITION_FOLLOWING) { best = links[i]; break; } }
  best = best || links[0];
  if (!best) return;
  var m = /xml=(\d+)/.exec(best.getAttribute('href') || '');
  try { if (m && parent.openWinZoom) return parent.openWinZoom('zoom.html?xml=' + m[1]); } catch (e) {}
  best.click();
}
