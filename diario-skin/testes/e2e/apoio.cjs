// Apoio aos testes de navegador: servidor de arquivos para dist/, verificações
// e medidas de layout (rolagem horizontal e alvos de toque).
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

let playwright;
try { playwright = require('playwright'); } catch (e) { playwright = require('/opt/node22/lib/node_modules/playwright'); }

const RAIZ = path.resolve(__dirname, '..', '..');
const CAPTURAS = path.join(__dirname, 'capturas');
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json',
};

/** Serve a pasta do build numa porta livre. */
function servirPasta(pasta) {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const arq = path.join(pasta, path.normalize(p).replace(/^([/\\])+/, ''));
      if (!arq.startsWith(pasta) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) { res.writeHead(404); res.end('404'); return; }
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arq)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(arq).pipe(res);
    });
    s.listen(0, '127.0.0.1', () => ok(s));
  });
}

let falhas = 0;
function verificar(cond, msg) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + msg);
  if (!cond) falhas++;
  return cond;
}
const totalFalhas = () => falhas;

/** Uma foto de teste (JPEG de 2400×1800 gerado no próprio navegador), como se viesse da câmera. */
async function fotoDeTeste(pagina, texto) {
  const base64 = await pagina.evaluate(async (t) => {
    const c = document.createElement('canvas');
    c.width = 2400; c.height = 1800;
    const x = c.getContext('2d');
    x.fillStyle = '#d8dde0'; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#14202a'; x.font = 'bold 220px sans-serif'; x.fillText(t, 160, 900);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  }, texto);
  return { name: `${texto}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(base64, 'base64') };
}

/** Largura da página não passa da tela (sem rolagem horizontal). */
async function semRolagemHorizontal(pagina) {
  return pagina.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

/**
 * Controles visíveis com alvo de toque menor que o mínimo (48 px).
 * Campo de arquivo conta pelo botão que o envolve; caixa de seleção, pelo rótulo.
 */
async function alvosPequenos(pagina, minimo = 48) {
  return pagina.evaluate((min) => {
    const ruins = [];
    const aberto = document.querySelector('dialog[open]');
    const escopo = aberto || document;
    for (const el of escopo.querySelectorAll('button, a[href], input, select, textarea, [role="button"]')) {
      if (!aberto && el.closest('dialog')) continue;
      let alvo = el;
      if (el.matches('input[type="file"]')) alvo = el.closest('.filebtn') || el;
      else if (el.matches('input[type="checkbox"], input[type="radio"]')) alvo = el.closest('label') || el;
      else if (el.closest('.filebtn') && el.tagName === 'BUTTON') continue;
      if (el.closest('svg')) alvo = el.querySelector('circle') || el;
      const r = alvo.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const estilo = getComputedStyle(el);
      if (estilo.visibility === 'hidden' || estilo.display === 'none') continue;
      if (r.height < min - 0.5 || r.width < min - 0.5) {
        ruins.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} "${(el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().slice(0, 30)}" ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    }
    return ruins;
  }, minimo);
}

module.exports = { playwright, RAIZ, CAPTURAS, servirPasta, verificar, totalFalhas, fotoDeTeste, semRolagemHorizontal, alvosPequenos };
