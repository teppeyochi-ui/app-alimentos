import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Fontes embutidas no aplicativo (funcionam sem internet).
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './estilos.css';
import { App } from './App';
import { pedirArmazenamentoPersistente } from './lib/banco-local';
import { MODO_LOCAL } from './lib/config';
import { iniciarLoja } from './lib/loja';
import { iniciarPwa } from './lib/pwa';
import { servidorSupabase } from './lib/servidor';
import { iniciarSessao } from './lib/sessao';
import { ligarSincronizacaoAutomatica, sincronizar } from './lib/sincronizacao';

async function iniciar(): Promise<void> {
  iniciarPwa();
  pedirArmazenamentoPersistente();
  await iniciarLoja({ servidor: MODO_LOCAL ? null : servidorSupabase() });
  ligarSincronizacaoAutomatica();
  iniciarSessao();
  if (!MODO_LOCAL) void sincronizar();
}

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

void iniciar();
