# Mysticall Soul: edição de vídeo para TikTok

Pipeline determinístico que monta, legenda, sonoriza e renderiza vídeos verticais
(1080 × 1920, H.264) a partir dos vídeos originais, usando Node.js, FFmpeg e Chromium (Playwright).

> **Atenção:** este repositório é público. Vídeos, legendas, EDL, briefing e revisões de um
> projeto real ficam fora do git (`.gitignore`) a menos que o dono decida publicá-los.

## 1. Onde colocar os vídeos

```
entrada/
├── videos/     ← COLOQUE AQUI os 3 vídeos originais (.mp4, .mov, .m4v, .mkv, .webm, .avi)
├── legendas/   ← opcional: uma legenda por vídeo, com o MESMO nome (video1.mp4 → video1.srt)
├── musica/     ← opcional: trilha própria (senão a trilha é sintetizada em código)
└── marca/      ← opcional: logo e fontes da marca
```

Não é preciso mexer no código. Os vídeos podem ter qualquer nome; a ordem inicial é alfabética.

Para colocar os arquivos no repositório:

- **Na sessão do Claude Code:** anexe os vídeos na conversa e peça para movê-los para
  `entrada/videos/`.
- **Pelo git (recomendado para arquivos grandes):** vídeos e músicas usam o **Git LFS**
  (`.gitattributes`).
  ```bash
  git lfs install
  cp ~/Downloads/*.mp4 entrada/videos/
  git add entrada/videos && git commit -m "Adiciona vídeos originais" && git push
  ```
  Sem LFS, o GitHub recusa arquivos acima de 100 MB, e o upload pelo navegador aceita até 25 MB.

## 2. Instalação

Requisitos: Node.js ≥ 20 e FFmpeg com libx264, além do Chromium do Playwright.

```bash
npm install
npx playwright install chromium   # não é necessário no ambiente em nuvem do Claude Code
npm run verificar                 # confere ferramentas, configuração e material
```

## 3. Como iniciar a edição

```bash
npm run preparar                  # analisa os vídeos e gera tudo em build/
node render.mjs --contact-sheet   # folhas de contato para revisão (um quadro por batida)
# … revisar, registrar notas em revisao/scorecard.json, corrigir, repetir até todas >= 8 …
node render.mjs                   # render final → saida/mysticall-soul-final.mp4
```

Na primeira preparação é criada a `projeto/edl.json` como **rascunho**: cada vídeo entra inteiro e
em ordem. Os cortes, a ordem, o enquadramento, os punches, as transições e os textos são editados
nesse arquivo depois de assistir ao material. Nada editorial é decidido automaticamente.

O render final só roda depois do ciclo de revisão do contrato: a última rodada em
`revisao/scorecard.json` precisa ter o hash do corte atual e notas ≥ 8 em gancho, legibilidade,
movimento, variedade, marca e sincronia. Veja `revisao/README.md`.

### Legendas em português do Brasil

O pipeline usa, nesta ordem de prioridade, `entrada/legendas/<video>.json`, `.srt` ou `.vtt`.

- **SRT/VTT fornecidos:** o tempo de cada palavra é estimado dentro do segmento.
- **Transcrição automática** com tempo por palavra (faster-whisper, roda fora do Node):
  ```bash
  pip install -r requirements-transcricao.txt
  python3 scripts/transcrever.py
  ```
  O script gera `<video>.json` com `"reviewed": false`. Revise o texto e troque para `true`.
  O modelo é baixado do Hugging Face, que hoje está **bloqueado** na rede do ambiente em nuvem;
  rode localmente ou libere `huggingface.co` na política de rede do ambiente.

Na tela, as legendas aparecem em caixa alta com acentos preservados, até 3 palavras por página,
com a palavra falada destacada e posicionadas dentro da zona segura do TikTok.

## 4. O que o pipeline faz

| Etapa | Detalhes |
|---|---|
| Análise | ffprobe: dimensões com rotação do celular, fps, áudio, HDR (convertido para SDR BT.709) |
| Montagem | EDL com cortes por `in`/`out`, velocidade, ponto de foco do recorte 9:16, zoom, punches, whip pan |
| Quadros | Extração na grade de 16 fps, recorte 9:16 a partir do foco, cache por conteúdo |
| Composição | `window.seek(t)` no Chromium: vídeo, legendas, gancho cinético e CTA, sem estado entre quadros |
| Áudio | Voz: passa-altas, redução de ruído, de-esser e compressor. Trilha sintetizada ou fornecida, com ducking pela voz |
| Batidas | Grade medida do áudio (`build/beats.json`); cortes e efeitos alinhados a ela |
| Loudness | −14 LUFS integrado, true peak ≤ −1 dBTP (duas passagens + verificação EBU R128) |
| Saída | H.264 High, yuv420p, BT.709, CFR (30 fps neste projeto), AAC 48 kHz, faststart, versão sem legendas, `.srt`, cópia da EDL e relatório de verificação |

Outros comandos:

```bash
node render.mjs --frame 2.5     # um quadro em PNG (build/quadros/)
node render.mjs --range 0:4     # trecho em MP4 para conferir movimento
npm run preview                 # pré-visualização no navegador (depois de "preparar")
npm test                        # testes unitários + ponta a ponta com material sintético
```

## 5. Configuração

`projeto/config.json` só contém o que difere dos padrões de `lib/config.mjs`. Ele não vai para o git
(repositório público): crie-o copiando `projeto/config.exemplo.json`, e o briefing a partir de
`projeto/briefing.exemplo.md`. Itens a definir:

- `brand.name`, `brand.logo` e as fontes da marca.
- `brand.accent`: a cor `#9D5CFF` é **provisória**.
- `format.fps = 16` vem do contrato técnico. O padrão do TikTok é 30; altere se o briefing pedir.
- Duração alvo, gancho e CTA: dependem do briefing (`projeto/briefing.md`, ainda **pendente**).

## 6. O que depende dos vídeos e do briefing

| Item | Depende de |
|---|---|
| Cortes, ordem e duração | Vídeos + briefing |
| Texto do gancho e do CTA | Briefing |
| Legendas | Arquivos de legenda ou transcrição revisada |
| Enquadramento (`focus`) e punches | Assistir aos vídeos |
| Cor, logo e fontes definitivas | Identidade da marca |
| Notas de revisão e render final | Tudo acima |
