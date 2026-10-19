#!/usr/bin/env python3
"""Transcrição automática em pt-BR com tempos por palavra (faster-whisper).

Gera entrada/legendas/<video>.json no formato lido pelo pipeline, com "reviewed": false.
A transcrição automática PRECISA ser revisada por uma pessoa antes do render final: corrija
o texto no JSON e troque "reviewed" para true.

Requisitos (fora do Node):
    pip install -r requirements-transcricao.txt
    O modelo é baixado do Hugging Face na primeira execução (precisa de acesso a huggingface.co).

Uso:
    python3 scripts/transcrever.py                 # todos os vídeos sem legenda
    python3 scripts/transcrever.py --modelo medium --forcar
"""
import argparse
import json
import pathlib
import sys

RAIZ = pathlib.Path(__file__).resolve().parent.parent
EXTENSOES = {".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi"}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--projeto", default=str(RAIZ))
    ap.add_argument("--modelo", default="small", help="tiny, base, small, medium, large-v3")
    ap.add_argument("--forcar", action="store_true", help="sobrescreve legendas existentes")
    args = ap.parse_args()

    raiz = pathlib.Path(args.projeto)
    videos = sorted(p for p in (raiz / "entrada" / "videos").glob("*") if p.suffix.lower() in EXTENSOES)
    legendas = raiz / "entrada" / "legendas"
    legendas.mkdir(parents=True, exist_ok=True)
    if not videos:
        print("Nenhum vídeo em entrada/videos/.")
        return 3

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("faster-whisper não instalado: pip install -r requirements-transcricao.txt")
        return 1

    modelo = WhisperModel(args.modelo, device="auto", compute_type="auto")
    for video in videos:
        destino = legendas / f"{video.stem}.json"
        existentes = [legendas / f"{video.stem}{e}" for e in (".json", ".srt", ".vtt")]
        if not args.forcar and any(p.exists() for p in existentes):
            print(f"pulando {video.name}: já tem legenda")
            continue
        print(f"transcrevendo {video.name}…")
        segmentos, info = modelo.transcribe(str(video), language="pt", word_timestamps=True, vad_filter=True)
        doc = {
            "language": "pt-BR",
            "origin": f"transcricao-automatica:faster-whisper-{args.modelo}",
            "reviewed": False,
            "segments": [
                {
                    "start": round(s.start, 3),
                    "end": round(s.end, 3),
                    "text": s.text.strip(),
                    "words": [{"text": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)} for w in (s.words or [])],
                }
                for s in segmentos
            ],
        }
        destino.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"  -> {destino.relative_to(raiz)} ({len(doc['segments'])} segmentos) — REVISAR antes do render final")
    return 0


if __name__ == "__main__":
    sys.exit(main())
