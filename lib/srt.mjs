// Exporta as páginas de legenda da linha do tempo final como SRT (texto das palavras exibidas).
const stamp = (t) => {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  return `${h}:${m}:${s},${String(ms % 1000).padStart(3, '0')}`;
};

export function pagesToSrt(pages) {
  return pages
    .map((p, i) => `${i + 1}\n${stamp(p.start)} --> ${stamp(p.end)}\n${p.words.map((w) => w.text).join(' ')}\n`)
    .join('\n');
}
