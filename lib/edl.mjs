// EDL (edit decision list): o roteiro de montagem em projeto/edl.json.
// Os clipes são sequenciais (sem lacunas); a posição na linha do tempo é derivada da ordem.

export const TEXT_TYPES = ['hook', 'cta'];
export const TRANSITIONS = ['cut', 'whip'];
export const SFX_TYPES = ['whoosh', 'hit', 'pop', 'riser'];

// Rascunho inicial: cada vídeo entra inteiro, na ordem dos nomes de arquivo.
// Não cria textos, legendas nem cortes: isso depende de assistir aos vídeos.
export function draftEdl(probes) {
  return {
    version: 1,
    status: 'draft',
    $comment:
      'Rascunho automático: cada vídeo inteiro, em ordem alfabética. Edite cortes (in/out), ordem, enquadramento (focus), punches, transições e textos após assistir ao material.',
    clips: probes.map((p, i) => ({
      id: `c${String(i + 1).padStart(2, '0')}`,
      source: p.name,
      in: 0,
      out: Math.floor(p.duration * 1000) / 1000,
      speed: 1,
      focus: { x: 0.5, y: 0.5 },
      zoom: 1,
      transitionIn: 'cut',
      volume: 1,
      punches: [],
    })),
    texts: [],
    sfx: [],
  };
}

const num = (v) => typeof v === 'number' && Number.isFinite(v);

export function validateEdl(edl, probesByName) {
  const errors = [];
  const warnings = [];
  if (!edl || !Array.isArray(edl.clips) || edl.clips.length === 0) {
    errors.push('A EDL precisa de pelo menos um clipe em "clips".');
    return { errors, warnings };
  }
  const ids = new Set();
  edl.clips.forEach((c, i) => {
    const tag = `clips[${i}] (${c.id ?? 'sem id'})`;
    if (!c.id) errors.push(`${tag}: falta "id".`);
    else if (ids.has(c.id)) errors.push(`${tag}: id repetido.`);
    ids.add(c.id);
    const p = probesByName[c.source];
    if (!p) errors.push(`${tag}: fonte "${c.source}" não encontrada em entrada/videos/.`);
    if (!num(c.in) || !num(c.out) || c.in < 0 || c.out <= c.in) errors.push(`${tag}: precisa de 0 <= in < out.`);
    else if (p && c.out > p.duration + 0.05) errors.push(`${tag}: out (${c.out}s) passa da duração da fonte (${p.duration.toFixed(3)}s).`);
    const speed = c.speed ?? 1;
    if (!num(speed) || speed < 0.5 || speed > 2) errors.push(`${tag}: speed deve estar entre 0.5 e 2.`);
    for (const axis of ['x', 'y']) {
      const v = c.focus?.[axis] ?? 0.5;
      if (!num(v) || v < 0 || v > 1) errors.push(`${tag}: focus.${axis} deve estar entre 0 e 1.`);
    }
    const zoom = c.zoom ?? 1;
    if (!num(zoom) || zoom < 1 || zoom > 2) errors.push(`${tag}: zoom deve estar entre 1 e 2.`);
    if (c.transitionIn && !TRANSITIONS.includes(c.transitionIn)) errors.push(`${tag}: transitionIn deve ser ${TRANSITIONS.join(' ou ')}.`);
    if (i === 0 && c.transitionIn === 'whip') warnings.push(`${tag}: transição no primeiro clipe é ignorada.`);
    const dur = num(c.in) && num(c.out) ? (c.out - c.in) / speed : 0;
    for (const [k, pu] of (c.punches || []).entries()) {
      if (!num(pu.at) || pu.at < 0 || pu.at > dur) errors.push(`${tag}: punches[${k}].at deve estar dentro do clipe (0..${dur.toFixed(2)}s, relativo ao início do clipe).`);
      if (pu.scale !== undefined && (!num(pu.scale) || pu.scale < 1 || pu.scale > 1.5)) errors.push(`${tag}: punches[${k}].scale deve estar entre 1 e 1.5.`);
    }
    if (dur > 0 && dur < 0.25) warnings.push(`${tag}: clipe muito curto (${dur.toFixed(2)}s).`);
  });
  const total = edl.clips.reduce((s, c) => s + (num(c.in) && num(c.out) ? (c.out - c.in) / (c.speed ?? 1) : 0), 0);
  for (const [i, tx] of (edl.texts || []).entries()) {
    if (!TEXT_TYPES.includes(tx.type)) errors.push(`texts[${i}]: type deve ser ${TEXT_TYPES.join(' ou ')}.`);
    if (typeof tx.text !== 'string' || !tx.text.trim()) errors.push(`texts[${i}]: text vazio.`);
    if (!num(tx.start) || !num(tx.end) || tx.end <= tx.start || tx.start < 0) errors.push(`texts[${i}]: precisa de 0 <= start < end.`);
    else if (tx.start > total) errors.push(`texts[${i}]: começa depois do fim do vídeo (${total.toFixed(2)}s).`);
  }
  for (const [i, s] of (edl.sfx || []).entries()) {
    if (!SFX_TYPES.includes(s.type)) errors.push(`sfx[${i}]: type deve ser ${SFX_TYPES.join(', ')}.`);
    if (!num(s.at) || s.at < 0 || s.at > total) errors.push(`sfx[${i}]: at fora do vídeo.`);
  }
  if (total > 180) warnings.push(`Duração total ${total.toFixed(1)}s: longa para TikTok; confirme com o briefing.`);
  if (edl.status === 'draft') warnings.push('EDL ainda é rascunho automático (status "draft"): nenhum corte editorial foi feito.');
  return { errors, warnings };
}

// Posiciona os clipes na linha do tempo, com fronteiras alinhadas à grade de quadros.
export function resolveClips(edl, fps) {
  let cursor = 0;
  return edl.clips.map((c, index) => {
    const speed = c.speed ?? 1;
    const exactEnd = cursor + (c.out - c.in) / speed;
    const start = Math.round(cursor * fps) / fps;
    const end = Math.round(exactEnd * fps) / fps;
    cursor = exactEnd;
    return {
      index,
      id: c.id,
      source: c.source,
      in: c.in,
      out: c.out,
      speed,
      start,
      end,
      duration: end - start,
      focus: { x: c.focus?.x ?? 0.5, y: c.focus?.y ?? 0.5 },
      zoom: c.zoom ?? 1,
      transitionIn: index === 0 ? 'cut' : c.transitionIn ?? 'cut',
      volume: c.volume ?? 1,
      punches: (c.punches || []).map((p) => ({ at: start + p.at, scale: p.scale ?? 1.1 })),
    };
  });
}

export function nearestBeat(t, beats) {
  let best = null;
  for (const b of beats) if (best === null || Math.abs(b - t) < Math.abs(best - t)) best = b;
  return best;
}

// Cortes fora da grade de batidas viram avisos (o contrato pede eventos no grid medido).
export function offBeatCuts(clips, beats, tolerance) {
  if (!beats.length) return [];
  return clips.slice(1).flatMap((c) => {
    const b = nearestBeat(c.start, beats);
    return Math.abs(b - c.start) > tolerance ? [{ clip: c.id, cut: c.start, nearestBeat: b }] : [];
  });
}
