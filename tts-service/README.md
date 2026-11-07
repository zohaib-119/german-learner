# tts-service

Tiny local text-to-speech server for the German learner app. Engines:

| Engine | Offline | Notes |
|---|---|---|
| `piper` (default) | yes | Voice `de_DE-thorsten-high`, WAV output |
| `edge` | no | Microsoft Edge neural voices via `edge-tts` (unofficial API), MP3 output |

Audio is cached in `cache/` keyed by `sha1(engine|voice|text)`, so each text is synthesized once.

## Setup (once)

The system Python here (3.14) lacks `ensurepip`, so the venv is created with [uv](https://docs.astral.sh/uv/):

```bash
uv venv --python 3.12 .venv                      # from the project root
uv pip install --python .venv/bin/python -r tts-service/requirements.txt
cd tts-service && mkdir -p voices
../.venv/bin/python -m piper.download_voices de_DE-thorsten-high --data-dir voices
```

## Run

```bash
cd tts-service
../.venv/bin/uvicorn app:app --port 8787
```

Or from the project root: `npm run tts`.

## API

- `GET /health` – engines, installed voices, cache size
- `GET /tts?text=Brot&engine=piper&voice=de_DE-thorsten-high` – audio (cached, immutable)

CORS only allows `localhost` / `127.0.0.1` origins. The service binds to 127.0.0.1 by default.
