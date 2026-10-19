# Material de entrada

| Pasta | O que colocar | Obrigatório |
|---|---|---|
| `videos/` | Os 3 vídeos originais (`.mp4`, `.mov`, `.m4v`, `.mkv`, `.webm`, `.avi`). Qualquer nome; a ordem inicial é alfabética. | Sim |
| `legendas/` | Uma legenda por vídeo, **com o mesmo nome do vídeo**: `video1.mp4` → `video1.srt` (ou `.vtt` ou `.json`). | Para ter legendas |
| `musica/` | Trilha fornecida (`.wav`, `.mp3`, `.m4a`, `.flac`…), usada com `"audio.music.mode": "file"`. | Não |
| `marca/` | Logo e fontes da marca. | Não |

Os vídeos e as músicas vão para o Git LFS (veja `.gitattributes`).
