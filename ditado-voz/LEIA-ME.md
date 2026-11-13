# Dita — ditado por voz com IA

Você fala do jeito que pensa (hesitando, repetindo, se corrigindo) e o Dita
entrega o texto limpo, pontuado e formatado, pronto para colar em e-mail,
WhatsApp, Teams ou documento.

Depois de publicado: https://teppeyochi-ui.github.io/app-alimentos/ditado-voz/

## Como usar

1. Abra no **Chrome** ou **Edge** (celular ou computador) e permita o microfone.
2. Toque no microfone (ou aperte **Espaço**), fale e toque de novo para parar.
3. O texto limpo aparece na tela e já é copiado. Um novo ditado é acrescentado
   ao texto; **Novo** começa do zero e **Desfazer** volta ao texto anterior.

| Recurso | O que faz |
|---|---|
| Estilos | Padrão, Mensagem, E-mail, Tópicos e Formal: mudam a forma do texto final. |
| Ajustar por voz | Fale o que mudar no texto: "deixa mais curto", "traduz para inglês", "troca a reunião para quinta". |
| Polir | Limpa um texto colado ou digitado na tela. |
| Transcrição original | Mostra o que o reconhecimento de voz ouviu, antes da limpeza. |
| Dicionário pessoal | Nomes e termos seus (Ajustes) para a IA escrever com a grafia certa. |
| Histórico | Últimos 50 ditados, guardados só no aparelho. |

No celular, use "Instalar app" / "Adicionar à tela inicial" para abrir como aplicativo.

## Chave de API

A limpeza com IA usa a API do Claude e precisa de uma chave da Anthropic
(console.anthropic.com), informada em **Ajustes**. O uso é cobrado na sua
conta da Anthropic, por volume de texto.

- A chave fica guardada só no navegador do aparelho e é enviada apenas à Anthropic.
  Não use em computador compartilhado.
- Sem chave (ou se a IA falhar), o Dita aplica uma limpeza simples: tira "éé",
  "né", palavras repetidas, e entende "vírgula", "ponto", "nova linha".
- Modelos: Claude Opus 5.5 (padrão), Sonnet 5.5 ou Haiku 5.5 (mais rápido e barato).

## Limites

- A transcrição usa o reconhecimento de voz do navegador: precisa de internet
  e funciona no Chrome e no Edge (no Firefox não há reconhecimento de voz).
  No Chrome, o áudio é processado pelo serviço de voz do Google.
- É um app de navegador: o texto vai para a área de transferência e você cola
  onde quiser. Ele não digita sozinho dentro de outros programas.

## Arquivos

| Arquivo | Conteúdo |
|---|---|
| `index.html`, `styles.css`, `app.js` | Interface. |
| `core.js` | Núcleo: instruções da IA, chamada à API, streaming e limpeza simples. |
| `sw.js`, `manifest.webmanifest`, `icones/` | Instalação como app (mude `VERSION` em `sw.js` a cada atualização). |
| `teste-nucleo.js` | Testes do núcleo: `node teste-nucleo.js`. |
| `teste-interface.js` | Testes da interface no Chromium, com voz e API simuladas: `node teste-interface.js` (`--capturas` regrava as imagens de `capturas/`). |
| `ferramentas/` | Ícone em SVG e gerador dos PNG. |

Para rodar localmente: `python3 -m http.server` dentro desta pasta e abrir
`http://localhost:8000` (o microfone só funciona em `localhost` ou HTTPS).
