import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// base relativa: o app funciona na raiz do domínio ou numa subpasta.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      // 'prompt': a versão nova só entra quando o usuário toca em "Atualizar",
      // para não recarregar a página no meio de um lançamento.
      registerType: 'prompt',
      includeAssets: ['icones/apple-touch-icon.png', 'icones/icone.svg'],
      manifest: {
        name: 'Diário da Linha Skin — Frescatto P&D',
        short_name: 'Diário Skin',
        description: 'Registro das ordens de produção da termoformadora ULMA (skin pack): parâmetros, fotos e rendimento.',
        lang: 'pt-BR',
        dir: 'ltr',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#EDF1F3',
        theme_color: '#0C6A87',
        categories: ['business', 'productivity'],
        icons: [
          { src: 'icones/icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icones/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icones/icone-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 700 },
  test: {
    include: ['testes/unidade/**/*.test.ts'],
    environment: 'node',
  },
});
