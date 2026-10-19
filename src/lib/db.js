'use strict';
// Accesso ai database originali eLearn (Access/JET4, file database\elearn_N.dat)
const fs = require('fs');
const path = require('path');

let MDBReader = null;
async function loadReader() {
  if (!MDBReader) MDBReader = (await import('mdb-reader')).default;
  return MDBReader;
}

const fix = (s) => (s == null ? '' : String(s).replace(/''/g, "'").replace(/\s*\(\s*\)\s*$/, ''));

class LangDB {
  constructor(buf, langId) {
    this.buf = buf;
    this.langId = langId;
  }

  async load() {
    const R = await loadReader();
    const r = new R(this.buf);
    this.buf = null;
    const T = (n) => (r.getTableNames().includes(n) ? r.getTable(n).getData() : []);
    const L = this.langId;
    const own = (rows) => rows.filter((x) => x.LANGUAGE_ID == null || x.LANGUAGE_ID === L);

    this.languages = T('LANGUAGE').sort((a, b) => a.ID - b.ID);
    this.marks = T('MARK');
    this.models = own(T('MODEL'));
    this.modelImages = T('MODEL_IMAGE');
    this.sections = own(T('SECTION')).sort((a, b) => (a.ORDERS || 0) - (b.ORDERS || 0));
    this.validities = own(T('VALIDITY')).sort((a, b) => (a.ORDERS || 0) - (b.ORDERS || 0));
    this.productions = own(T('PRODUCTION'));
    this.codeps = new Map(own(T('CODEP')).map((c) => [c.ID, c]));
    this.xsl = new Map();
    for (const x of T('XSL')) if (!this.xsl.has(x.SECTION_TYPE)) this.xsl.set(x.SECTION_TYPE, x.XSL);

    this.strings = new Map();
    for (const s of T('STRING')) {
      if (!this.strings.has(s.LANGUAGE_ID)) this.strings.set(s.LANGUAGE_ID, new Map());
      this.strings.get(s.LANGUAGE_ID).set(s.ID, s.STRING);
    }

    // Elementi
    this.elements = new Map();
    this.children = new Map();
    for (const e of own(T('ELEMENT'))) {
      e.NAME = fix(e.NAME);
      this.elements.set(e.ID, e);
      if (!this.children.has(e.PARENT_ID)) this.children.set(e.PARENT_ID, []);
      this.children.get(e.PARENT_ID).push(e);
    }
    for (const list of this.children.values()) list.sort((a, b) => a.ORDERS - b.ORDERS);

    const multi = (rows, k, v) => {
      const m = new Map();
      for (const r of rows) {
        if (!m.has(r[k])) m.set(r[k], new Set());
        m.get(r[k]).add(r[v]);
      }
      return m;
    };
    this.elVal = multi(T('ELEMENT_VALIDITY'), 'ELEMENT_ID', 'VALIDITY_ID');
    this.elProd = multi(T('ELEMENT_PRODUCTION'), 'ELEMENT_ID', 'PRODUCTION_ID');
    this.elCodep = multi(T('ELEMENT_CODEP'), 'ELEMENT_ID', 'CODEP_ID');

    // XML
    this.xmlById = new Map();
    this.xmlByEl = new Map();
    for (const x of own(T('XML'))) {
      x.VALUE_XML = fix(x.VALUE_XML);
      this.xmlById.set(x.ID, x);
      if (!this.xmlByEl.has(x.ELEMENT_ID)) this.xmlByEl.set(x.ELEMENT_ID, []);
      this.xmlByEl.get(x.ELEMENT_ID).push(x);
    }
    for (const list of this.xmlByEl.values()) list.sort((a, b) => a.ORDERS - b.ORDERS);
    this.xmlVal = multi(T('XML_VALIDITY'), 'XML_ID', 'VALIDITY_ID');
    this.xmlProd = multi(T('XML_PRODUCTION'), 'XML_ID', 'PRODUCTION_ID');
    this.xmlCodep = multi(T('XML_CODEP'), 'XML_ID', 'CODEP_ID');

    // sezione di appartenenza di ogni elemento
    this.sectionOf = new Map();
    for (const s of this.sections) {
      const stack = [s.ROOT_ELEM_ID];
      while (stack.length) {
        const id = stack.pop();
        this.sectionOf.set(id, s);
        for (const c of this.children.get(id) || []) stack.push(c.ID);
      }
    }
    this._text = null;
    return this;
  }

  str(id, lang) {
    const m = this.strings.get(lang || this.langId) || this.strings.get(1);
    return (m && m.get(id)) || (this.strings.get(1) && this.strings.get(1).get(id)) || '';
  }

  productionsFor(valId) {
    return this.productions.filter((p) => !p.VALIDITY_ID || p.VALIDITY_ID === valId);
  }

  elementValid(e, val, prod) {
    if (!e) return false;
    if (!e.ALL_VALIDITY && !(this.elVal.get(e.ID) || new Set()).has(val)) return false;
    if (!e.ALL_PRODUCTION && !(this.elProd.get(e.ID) || new Set()).has(prod)) return false;
    return true;
  }

  xmlValid(x, val, prod) {
    if (!x.ALL_VALIDITY && !(this.xmlVal.get(x.ID) || new Set()).has(val)) return false;
    if (!x.ALL_PRODUCTION && !(this.xmlProd.get(x.ID) || new Set()).has(prod)) return false;
    return true;
  }

  validChildren(id, val, prod) {
    return (this.children.get(id) || []).filter(
      (c) => this.elementValid(c, val, prod) && (!this.xmlByEl.has(c.ID) || this.validXml(c.ID, val, prod).length > 0)
    );
  }

  validXml(id, val, prod) {
    return (this.xmlByEl.get(id) || []).filter((x) => this.xmlValid(x, val, prod));
  }

  isLeaf(id) {
    return this.xmlByEl.has(id) || !(this.children.get(id) || []).length;
  }

  codepNames(ids) {
    return [...(ids || [])]
      .map((i) => this.codeps.get(i))
      .filter(Boolean)
      .map((c) => (c.NAME && c.NAME.trim() !== '-' ? c.NAME : c.CODE))
      .join(', ');
  }

  // percorso dalla radice di sezione all'elemento
  pathTo(id) {
    const out = [];
    let e = this.elements.get(id);
    const sec = this.sectionOf.get(id);
    while (e) {
      out.unshift(e);
      if (sec && e.ID === sec.ROOT_ELEM_ID) break;
      e = this.elements.get(e.PARENT_ID);
    }
    return out;
  }

  xslFor(id) {
    const s = this.sectionOf.get(id);
    const t = s ? s.TYPE : 0;
    return (this.xsl.get(t) || this.xsl.get(0) || './xsl/standard.xsl').replace(/^\.\/xsl\//, '').replace(/\.xsl$/i, '');
  }

  normText(xmlId) {
    if (!this._norm) this._norm = new Map();
    let t = this._norm.get(xmlId);
    if (t == null) {
      t = this.plainTextRaw(xmlId).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      this._norm.set(xmlId, t);
    }
    return t;
  }
  // indice di ricerca: prepara in anticipo il testo normalizzato di tutte le pagine
  buildIndex() {
    for (const id of this.xmlById.keys()) this.normText(id);
  }

  plainTextRaw(xmlId) {
    if (!this._raw) this._raw = new Map();
    let t = this._raw.get(xmlId);
    if (t == null) {
      const x = this.xmlById.get(xmlId);
      t = x ? x.VALUE_XML.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() : '';
      this._raw.set(xmlId, t);
    }
    return t;
  }

  // Testo semplice dei contenuti (per la ricerca)
  plainText(xmlId) {
    if (!this._text) this._text = new Map();
    let t = this._text.get(xmlId);
    if (t == null) {
      const x = this.xmlById.get(xmlId);
      t = x ? x.VALUE_XML.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').toLowerCase() : '';
      this._text.set(xmlId, t);
    }
    return t;
  }
}

const { storeFor } = require('./store');
const cache = new Map();
async function openLang(dataDir, langId) {
  const key = dataDir + '|' + langId;
  if (cache.has(key)) return cache.get(key);
  const store = storeFor(dataDir);
  const rel = `database/elearn_${langId}.dat`;
  if (!store || !store.exists(rel)) return null;
  const db = await new LangDB(store.read(rel), langId).load();
  cache.set(key, db);
  return db;
}

function availableLangs(dataDir) {
  const store = storeFor(dataDir);
  if (!store) return [];
  return store
    .list('database')
    .map((n) => /^elearn_(\d+)\.dat$/i.exec(n))
    .filter(Boolean)
    .map((m) => +m[1])
    .sort((a, b) => a - b);
}

function dropLang(dataDir) { for (const k of [...cache.keys()]) if (k.startsWith(dataDir + '|')) cache.delete(k); }
module.exports = { openLang, availableLangs, dropLang };
