// Fotos: redução no aparelho antes de guardar/enviar e endereço para exibir.

import { useEffect, useState } from 'react';
import { bancoLocal } from './banco-local';
import { FOTO_LADO_MAX, FOTO_QUALIDADE } from './constantes';
import { lerServidor } from './loja';
import type { Foto } from './tipos';

interface Imagem {
  largura: number;
  altura: number;
  fonte: CanvasImageSource;
  soltar(): void;
}

async function abrirImagem(arquivo: Blob): Promise<Imagem> {
  if (typeof createImageBitmap === 'function') {
    try {
      // 'from-image' respeita a orientação gravada pela câmera (EXIF).
      const bmp = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
      return { largura: bmp.width, altura: bmp.height, fonte: bmp, soltar: () => bmp.close() };
    } catch {
      /* tenta pelo elemento <img> */
    }
  }
  const url = URL.createObjectURL(arquivo);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { largura: img.naturalWidth, altura: img.naturalHeight, fonte: img, soltar: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/** Reduz para no máximo 1800 px no lado maior e converte para JPEG (qualidade ~0,82). */
export async function reduzirFoto(arquivo: Blob): Promise<Blob> {
  const img = await abrirImagem(arquivo);
  try {
    const escala = Math.min(1, FOTO_LADO_MAX / Math.max(img.largura, img.altura));
    const tela = document.createElement('canvas');
    tela.width = Math.max(1, Math.round(img.largura * escala));
    tela.height = Math.max(1, Math.round(img.altura * escala));
    const ctx = tela.getContext('2d');
    if (!ctx) throw new Error('Sem canvas 2D');
    ctx.drawImage(img.fonte, 0, 0, tela.width, tela.height);
    const blob = await new Promise<Blob | null>((ok) => tela.toBlob(ok, 'image/jpeg', FOTO_QUALIDADE));
    if (!blob) throw new Error('Não foi possível converter a foto');
    return blob;
  } finally {
    img.soltar();
  }
}

/** Bytes da foto: do aparelho, se ainda estiver guardada; senão, baixa do servidor. */
export async function blobDaFoto(foto: Foto): Promise<Blob | null> {
  const guardada = await bancoLocal.lerFoto(foto.id);
  if (guardada) return new Blob([guardada.dados], { type: 'image/jpeg' });
  const url = await lerServidor()?.urlFoto(foto.caminho);
  if (!url) return null;
  try {
    const r = await fetch(url);
    return r.ok ? await r.blob() : null;
  } catch {
    return null;
  }
}

export type EstadoUrl = 'carregando' | 'ok' | 'indisponivel';

/** Endereço para mostrar a foto: cópia do aparelho ou endereço assinado do servidor. */
export function useUrlFoto(foto: Foto): { url: string | null; estado: EstadoUrl } {
  const [r, setR] = useState<{ url: string | null; estado: EstadoUrl }>({ url: null, estado: 'carregando' });

  useEffect(() => {
    let vivo = true;
    let objeto: string | null = null;
    (async () => {
      const guardada = await bancoLocal.lerFoto(foto.id).catch(() => undefined);
      if (!vivo) return;
      if (guardada) {
        objeto = URL.createObjectURL(new Blob([guardada.dados], { type: 'image/jpeg' }));
        setR({ url: objeto, estado: 'ok' });
        return;
      }
      const url = (await lerServidor()?.urlFoto(foto.caminho).catch(() => null)) ?? null;
      if (vivo) setR({ url, estado: url ? 'ok' : 'indisponivel' });
    })();
    return () => {
      vivo = false;
      if (objeto) URL.revokeObjectURL(objeto);
    };
  }, [foto.id, foto.caminho]);

  return r;
}
