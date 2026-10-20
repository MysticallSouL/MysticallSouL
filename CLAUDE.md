# CLAUDE.md — Mysticall Soul (edição de vídeo para TikTok)

Regras técnicas e editoriais deste repositório. Valem para todas as sessões. Em caso de conflito
com um pedido explícito do usuário, o pedido vence; avise qual regra foi afetada.

## Honestidade sobre o material (inegociável)

- **Nunca invente** vídeos, falas, legendas, textos de gancho/CTA, notas de revisão ou resultados
  de renderização. Texto na tela vem do briefing ou dos próprios vídeos; legendas vêm de arquivos
  fornecidos ou de transcrição revisada por uma pessoa.
- Transcrição automática (`scripts/transcrever.py`) sai com `"reviewed": false` e não é final até
  revisão humana. Não "corrija" falas por conta própria: só transcreva o que é dito. Correções
  aceitáveis: grafia verificada de nomes, caixa e pontuação nos pontos de corte. Palavras incertas
  ficam fora da montagem, não são adivinhadas.
- No ambiente em nuvem o Hugging Face é bloqueado; a transcrição usada foi o Whisper small ONNX do
  pacote npm `sts-whisper-small` (terceiro, instalado com `--ignore-scripts` fora do repositório,
  com autorização explícita do usuário) rodando em `@huggingface/transformers`. Não instale de novo
  sem nova autorização.
- Conteúdo político: preservar posição e tom do autor, não atribuir falas a terceiros, não tirar
  de contexto, não apresentar alegações como fatos verificados. Detalhes em `projeto/briefing.md`.
- O material de teste (`test/helpers/fixtures.mjs`) é sintético e não pode ser apresentado como
  trabalho real.
- `projeto/briefing.md` com `STATUS: PENDENTE` significa que **não há decisão editorial**: corte
  só o que for tecnicamente necessário e pergunte o resto.

## Contrato de renderização

- Cada filme é uma função pura do tempo: `window.seek(t)` pinta o quadro `t`
  (`composition/composition.js`). Cada chamada redefine **todo** o estado visual.
- Proibido na composição: transições/animações CSS, `@keyframes`, `setTimeout`/`setInterval`,
  `requestAnimationFrame`, `Math.random`, leitura de relógio, estado carregado entre quadros.
  `npm run verificar` e `node render.mjs` rodam um lint (`lib/lint.mjs`) que bloqueia isso.
  A única exceção é `composition/preview.js`, que só roda no modo de pré-visualização.
- Ruído só com semente: `mulberry32` / `noiseAt` de `composition/lib/noise.js`.
- Renderize com `node render.mjs`. Saída em H.264 High, yuv420p, BT.709, CFR, 1080×1920,
  AAC 48 kHz, faststart. O contrato define **CFR 16**; o projeto atual usa **30 fps** porque o
  briefing pediu a taxa da gravação original (`format.fps` em `projeto/config.json`).
- O render final entrega `saida/<nome>.mp4`, `<nome>-sem-legendas.mp4`, `<nome>.srt`,
  `<nome>-edl.json` e `<nome>.json` (verificações).
- Eventos visuais caem no quadro que contém o instante (`floor(t·fps)/fps`). As fronteiras de
  clipe ficam na grade de quadros.

## Recursos de edição (EDL)

- Clipes: `in`/`out` na fonte, `focus` (origem do zoom), `zoom` → `zoomEnd` (aproximação lenta),
  `transitionIn` (`cut`/`whip`), `punches`. Vários clipes podem vir da mesma fonte (trocar o
  enquadramento sem cortar a fala).
- Tempos de textos e efeitos aceitam âncoras `{"clip": "<id>", "t": <segundos na fonte>}`, que
  acompanham a fala quando os cortes mudam.
- `texts`: `hook`/`cta` (palavras cinéticas) e `card` (linhas em blocos sólidos no topo, cada uma
  com `at` e `accent` opcionais; tamanho ajustado para caber numa linha).
- `emphasis`: `[{clip, word}]` — destaque pontual da palavra na legenda (bloco na cor de destaque).
- Cortes de fala: escolha pontos de corte na forma de onda (silêncio) e confira a emenda
  retranscrevendo a voz montada (`build/audio/voz.wav`) — repetições e sílabas cortadas aparecem.

## Visual

- Proibidos os padrões genéricos: título centralizado sobre degradê, tudo entrando com fade,
  rótulos de canto e molduras, brilho (glow) em elementos de interface, explosões genéricas de
  partículas.
- Uma fonte display (`brand.fonts.display`) e uma de interface (`brand.fonts.ui`). Uma única cor
  de destaque (`brand.accent`), salvo se o briefing disser outra coisa. A cor atual é
  **provisória** (`accentProvisional: true`) até a identidade da marca chegar.
- A cada 2–4 s algo novo precisa acontecer na tela: corte, punch, página de legenda, palavra de
  texto. O relatório da folha de contato aponta intervalos acima de 4 s.
- Zona segura do TikTok (`safeZone`): topo 160 px, base 480 px, esquerda 64 px, direita 150 px.
  Texto importante fica dentro dela.
- Legendas pt-BR: caixa alta com `toLocaleUpperCase('pt-BR')` (acentos preservados), até 3
  palavras / 18 caracteres por página. A página não termina em artigo, preposição ou conjunção,
  não atravessa um corte e não junta dois segmentos. Palavra ativa na cor de destaque. Contorno
  sólido e sombra dura, nunca brilho.

## Som

- Trilha e efeitos são sintetizados em código (`lib/synth.mjs`), a menos que uma trilha seja
  fornecida em `entrada/musica/` com `audio.music.mode = "file"`.
- A grade de batidas é **medida** do áudio da trilha (`lib/beats.mjs`) e gravada em
  `build/beats.json`. Os efeitos encaixam na batida medida mais próxima (tolerância
  `audio.sfx.snapTolerance`). Cortes devem cair em batidas; os que não caem viram aviso.
- Voz: passa-altas 80 Hz, redução de ruído (afftdn), de-esser e compressor. A trilha sofre
  ducking pela voz (sidechain).
- Master em **−14 LUFS** integrado, true peak ≤ −1 dBTP, com loudnorm em duas passagens e
  verificação EBU R128 (`build/audio/loudness.json`).

## Ciclo obrigatório antes de mostrar qualquer coisa

1. `node render.mjs --contact-sheet`: um quadro por batida em `build/review/contact-sheet-*.png`.
   **Abra e olhe** cada folha (ferramenta Read na imagem). Também existe `--frame <s>` para ver um
   quadro em tamanho real e `--range a:b` para conferir movimento.
2. Dê notas de 1 a 10 para `hook`, `readability`, `motion`, `variety`, `brand` e `sync` e registre
   a rodada em `revisao/scorecard.json`, com o `hash` impresso. Veja `revisao/README.md`.
3. Corrija os 3 piores problemas. Repita até todas as notas serem ≥ 8.
4. Só então rode `node render.mjs`. Ele **recusa** o render (código 2) se a última rodada não
   tiver o hash do corte atual ou se houver nota < 8. Nunca contorne essa trava.

## Mapa do repositório

| Caminho | Papel |
|---|---|
| `entrada/videos/` | Os 3 vídeos originais (Git LFS) |
| `entrada/legendas/` | `<nome-do-video>.srt\|.vtt\|.json` |
| `entrada/musica/`, `entrada/marca/` | Trilha opcional; logo e fontes |
| `projeto/config.json` | Formato, marca, legendas, movimento, áudio (padrões em `lib/config.mjs`) |
| `projeto/edl.json` | Montagem: clipes (`source`, `in`, `out`, `focus`, `zoom`, `speed`, `transitionIn`, `punches`), `texts` (`hook`/`cta`) e `sfx`. Criada como rascunho (vídeos inteiros) na primeira preparação |
| `projeto/briefing.md` | Briefing editorial |
| `revisao/scorecard.json` | Rodadas de revisão (trava do render final) |
| `composition/` | Página renderizada pelo Chromium (`seek(t)`) |
| `lib/` | Pipeline: probe, EDL, quadros, legendas, áudio, batidas, render, codificação, revisão |
| `render.mjs` | Ponto de entrada da renderização |
| `build/` | Intermediários: quadros, áudio, `beats.json`, `timeline.json`, revisão (ignorado pelo git) |
| `saida/` | Vídeo final + relatório JSON (ignorado pelo git) |

## Comandos

```
npm install                       # dependências (Playwright 1.56.1 + fontes Anton/Inter)
npm run verificar                 # diagnóstico do ambiente e do material
npm run preparar                  # análise, EDL, quadros, legendas, áudio, beats.json
node render.mjs --contact-sheet   # revisão: um quadro por batida
node render.mjs --frame 2.5       # um quadro em PNG
node render.mjs --range 0:4       # trecho MP4 para conferir movimento (não é entrega)
node render.mjs                   # render final (exige revisão aprovada)
npm test                          # unitários + ponta a ponta com fixtures sintéticas (~35 s)
```

## Convenções de código

- Node ESM, sem dependências além do Playwright e das fontes. Identificadores em inglês;
  mensagens, documentação e comentários em português do Brasil.
- Toda mudança na composição ou no pipeline deve manter `npm test` verde. O teste de integração
  verifica que `seek(t)` dá a mesma imagem em qualquer ordem e em qualquer aba, e que o MP4 final
  cumpre o contrato.
- No Chromium do ambiente em nuvem, o Playwright está fixado em 1.56.1 para casar com o navegador
  pré-instalado (`/opt/pw-browsers`). Não rode `playwright install` lá.
