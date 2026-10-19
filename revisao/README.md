# Revisão (rodadas do contrato)

`scorecard.json` registra cada rodada de revisão. O render final (`node render.mjs`) só roda quando a
**última** rodada tem o mesmo `hash` do corte atual e todas as notas são >= 8.

```json
{
  "rounds": [
    {
      "round": 1,
      "hash": "<hash impresso por node render.mjs --contact-sheet>",
      "date": "AAAA-MM-DD",
      "sheets": ["build/review/contact-sheet-01.png"],
      "scores": { "hook": 6, "readability": 8, "motion": 7, "variety": 5, "brand": 8, "sync": 9 },
      "worstProblems": ["…", "…", "…"],
      "fixes": ["…", "…", "…"]
    }
  ]
}
```

Critérios: `hook` (gancho nos primeiros 2 s), `readability` (legibilidade em tela de celular),
`motion` (qualidade do movimento), `variety` (algo novo a cada 2–4 s), `brand` (fidelidade à marca),
`sync` (sincronia com o som). As notas vêm de **olhar** as folhas de contato, nunca de suposição.
