'use strict';
// Strumento di sviluppo: raccoglie i testi visibili dell'interfaccia (per le traduzioni)
const { BrowserWindow } = require('electron');
const fs = require('fs');
module.exports = async function collect(list, out) {
  const w = new BrowserWindow({ show: false, width: 1400, height: 1000 });
  const all = {};
  for (const url of list) {
    try {
      await Promise.race([w.loadURL(url), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 15000))]);
      await new Promise((r) => setTimeout(r, 1500));
      const got = await w.webContents.executeJavaScript(`(function(){
        var out=[];
        function walk(doc){
          var tw=doc.createTreeWalker(doc.body||doc.documentElement,NodeFilter.SHOW_TEXT);var n;
          while((n=tw.nextNode())){var p=n.parentNode;if(!p||/^(SCRIPT|STYLE)$/.test(p.nodeName))continue;var t=n.nodeValue.replace(/\\s+/g,' ').trim();if(t&&/[A-Za-zÀ-ÿ]{2}/.test(t))out.push(t);}
          doc.querySelectorAll('[title],[placeholder]').forEach(function(e){['title','placeholder'].forEach(function(a){var v=e.getAttribute(a);if(v&&/[A-Za-zÀ-ÿ]{2}/.test(v))out.push(v.trim())})});
          if(doc.title)out.push(doc.title);
          doc.querySelectorAll('iframe,frame').forEach(function(f){try{if(f.contentDocument)walk(f.contentDocument)}catch(e){}});
        }
        walk(document);return out;})()`);
      for (const t of got) (all[t] = all[t] || []).includes(url) || all[t].push(url);
    } catch (e) {
      all['!!ERR ' + url] = [String(e.message || e)];
    }
  }
  fs.writeFileSync(out, JSON.stringify(all, null, 1));
  w.destroy();
};
