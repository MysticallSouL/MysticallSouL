#!/usr/bin/env node
// Prepara tudo o que a renderização precisa: análise dos vídeos, EDL (rascunho se não existir),
// quadros, legendas, voz tratada, trilha, grade de batidas (build/beats.json), SFX e mixagem.
import { projectPaths, rootFromArgs } from '../lib/paths.mjs';
import { log } from '../lib/proc.mjs';
import { prepare, PendingInputError } from '../lib/prepare.mjs';

const paths = projectPaths(rootFromArgs());
try {
  const { timeline, warnings } = await prepare(paths, { log });
  log(`\nLinha do tempo: ${timeline.duration.toFixed(2)} s, ${timeline.frameCount} quadros @ ${timeline.format.fps} fps`);
  log(`Clipes: ${timeline.clips.length} · páginas de legenda: ${timeline.captions.length} · textos: ${timeline.texts.length}`);
  log(`Batidas: ${timeline.beats.bpm} BPM (${timeline.beats.measured ? 'medido' : 'nominal'}), ${timeline.beats.beats.length} no vídeo`);
  if (timeline.audio.loudness) log(`Loudness: ${timeline.audio.loudness.integratedLufs} LUFS, pico ${timeline.audio.loudness.truePeakDb} dBTP`);
  if (warnings.length) {
    log('\nAvisos:');
    for (const w of warnings) log(`  ! ${w}`);
  }
  log('\nPróximo passo: node render.mjs --contact-sheet');
} catch (e) {
  if (e instanceof PendingInputError) {
    log(`Aguardando material: ${e.message}`);
    process.exitCode = 3;
  } else {
    console.error(e.message);
    process.exitCode = 1;
  }
}
