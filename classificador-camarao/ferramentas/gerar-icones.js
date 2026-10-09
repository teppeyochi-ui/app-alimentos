#!/usr/bin/env node
// Gera os ícones PNG a partir de ferramentas/icone.svg usando o Chromium do Playwright.
//   node ferramentas/gerar-icones.js
'use strict';
const fs = require('fs');
const path = require('path');
let playwright;
try { playwright = require('playwright'); } catch (e) { playwright = require('/opt/node22/lib/node_modules/playwright'); }

const raiz = path.resolve(__dirname, '..');
const svg = fs.readFileSync(path.join(__dirname, 'icone.svg'), 'utf8');

// any: cantos arredondados, fundo transparente. maskable: fundo cheio e
// desenho reduzido para caber na zona segura (círculo de 80%).
const SAIDAS = [
  { arq: 'icone-192.png', tam: 192, mascara: false },
  { arq: 'icone-512.png', tam: 512, mascara: false },
  { arq: 'icone-512-maskable.png', tam: 512, mascara: true },
  { arq: 'apple-touch-icon.png', tam: 180, mascara: true },
];

(async () => {
  const nav = await playwright.chromium.launch();
  const pag = await nav.newPage();
  for (const s of SAIDAS) {
    let conteudo = svg;
    if (s.mascara) {
      conteudo = svg.replace('rx="112"', 'rx="0"').replace('<g transform="translate(256 286)">', '<g transform="translate(256 286) scale(0.78)">');
    }
    await pag.setViewportSize({ width: s.tam, height: s.tam });
    await pag.setContent('<html><body style="margin:0;background:transparent">' +
      conteudo.replace('<svg ', '<svg width="' + s.tam + '" height="' + s.tam + '" ') + '</body></html>');
    await pag.screenshot({ path: path.join(raiz, 'icones', s.arq), omitBackground: true });
    console.log('icones/' + s.arq);
  }
  await nav.close();
})();
