// Aplicativo instalável: registro do service worker, aviso de versão nova,
// botão "Instalar" e tema claro/escuro.

import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';

interface EventoInstalar extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface EstadoPwa {
  /** Há versão nova baixada, esperando o usuário tocar em "Atualizar". */
  atualizacao: boolean;
  /** O navegador oferece instalar o aplicativo. */
  instalavel: boolean;
}

let estado: EstadoPwa = { atualizacao: false, instalavel: false };
const ouvintes = new Set<() => void>();
let aplicarAtualizacao: ((recarregar?: boolean) => Promise<void>) | null = null;
let eventoInstalar: EventoInstalar | null = null;

function definir(parcial: Partial<EstadoPwa>): void {
  estado = { ...estado, ...parcial };
  ouvintes.forEach((f) => f());
}

export function usePwa(): EstadoPwa {
  return useSyncExternalStore(
    (f) => { ouvintes.add(f); return () => ouvintes.delete(f); },
    () => estado,
  );
}

export function iniciarPwa(): void {
  aplicarAtualizacao = registerSW({
    onNeedRefresh: () => definir({ atualizacao: true }),
  });
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    eventoInstalar = e as EventoInstalar;
    definir({ instalavel: true });
  });
  window.addEventListener('appinstalled', () => {
    eventoInstalar = null;
    definir({ instalavel: false });
  });
}

export function atualizarAgora(): void {
  void aplicarAtualizacao?.(true);
}

export async function instalar(): Promise<void> {
  if (!eventoInstalar) return;
  await eventoInstalar.prompt();
  await eventoInstalar.userChoice.catch(() => null);
  eventoInstalar = null;
  definir({ instalavel: false });
}

// ------------------------------------------------------------------ tema

export type Tema = 'auto' | 'light' | 'dark';
const CHAVE_TEMA = 'diario-skin:tema';

export function lerTema(): Tema {
  try {
    const t = localStorage.getItem(CHAVE_TEMA);
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch {
    return 'auto';
  }
}

export function aplicarTema(tema: Tema): void {
  try {
    if (tema === 'auto') localStorage.removeItem(CHAVE_TEMA);
    else localStorage.setItem(CHAVE_TEMA, tema);
  } catch {
    /* sem armazenamento: vale só nesta sessão */
  }
  if (tema === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', tema);
}
