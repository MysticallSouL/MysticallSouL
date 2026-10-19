// Pré-visualização interativa (somente modo "preview"; nunca carregado na renderização).
// Aqui requestAnimationFrame é permitido: ele só decide QUAL t mostrar; o quadro é pintado por seek(t).
const TL = await fetch(new URLSearchParams(location.search).get('timeline') || '/proj/build/timeline.json').then((r) => r.json());
const audio = new Audio(TL.audio.url);
const bar = document.createElement('div');
bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;padding:16px;font:600 28px system-ui;color:#fff;background:#000c;z-index:9';
bar.textContent = 'Clique para tocar / pausar · ← → para navegar quadro a quadro';
document.body.append(bar);
let t = 0;
const fps = TL.format.fps;
const show = async () => {
  await window.seek(t);
  bar.textContent = `${t.toFixed(3)}s · quadro ${Math.floor(t * fps)} · ${audio.paused ? 'pausado' : 'tocando'}`;
};
const loop = () => {
  if (!audio.paused) {
    t = Math.floor(audio.currentTime * fps) / fps;
    show();
    requestAnimationFrame(loop);
  }
};
document.addEventListener('click', () => {
  if (audio.paused) {
    audio.currentTime = t;
    audio.play();
    requestAnimationFrame(loop);
  } else audio.pause();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') t = Math.min(TL.duration, t + 1 / fps);
  if (e.key === 'ArrowLeft') t = Math.max(0, t - 1 / fps);
  show();
});
show();
