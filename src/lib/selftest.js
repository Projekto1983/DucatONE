'use strict';
// Verifica automatica: apre ogni pagina in una finestra nascosta e controlla immagini e schemi SVG
const { BrowserWindow } = require('electron');
const fs = require('fs');
module.exports = async function selftest(list, out, conc = 8) {
  const res = [];
  let i = 0, next = 0;
  async function worker() {
  const w = new BrowserWindow({ show: false, width: 1400, height: 1000, webPreferences: { plugins: true } });
  while (next < list.length) {
    const url = list[next++];
    i++;
    try {
      await Promise.race([w.loadURL(url), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 15000))]);
      await new Promise((r) => setTimeout(r, 120));
      const r = await w.webContents.executeJavaScript(`(async () => {
        const waitImgs = [...document.images].map(im => im.complete ? 1 : new Promise(r => { im.onload = im.onerror = r; setTimeout(r, 3000); }));
        await Promise.all(waitImgs);
        const badImg = [...document.images].filter(im => !im.naturalWidth).map(im => im.getAttribute('src'));
        const embeds = [...document.querySelectorAll('embed')];
        await new Promise(r => setTimeout(r, embeds.length ? 600 : 0));
        const badSvg = [];
        for (const e of embeds) {
          let d = null; try { d = e.getSVGDocument(); } catch (x) {}
          if (!d || !d.documentElement || d.documentElement.localName !== 'svg' || d.querySelector('parsererror')) badSvg.push(e.getAttribute('src'));
        }
        const err = /VrNav_ErrorPage/.test(document.documentElement.innerHTML);
        const xerr = [...document.querySelectorAll('p.err_msg')].map(p => p.textContent).filter(t => /error|XT/i.test(t));
        return { badImg, badSvg, err, xerr, embeds: embeds.length, imgs: document.images.length };
      })()`);
      if (process.env.ST_ALL || r.err || r.badImg.length || r.badSvg.length || r.xerr.length) res.push({ url, ...r });
    } catch (e) {
      res.push({ url, fail: String(e.message || e) });
    }
    if (i % 200 === 0) fs.writeFileSync(out, JSON.stringify({ done: i, total: list.length, problems: res }, null, 1));
  }
  w.destroy();
  }
  await Promise.all(Array.from({ length: conc }, worker));
  fs.writeFileSync(out, JSON.stringify({ done: i, total: list.length, problems: res }, null, 1));
};
