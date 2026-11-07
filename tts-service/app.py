"""Tiny local TTS service: Piper (offline) and optional edge-tts (online), with a disk cache.

Run:  ../.venv/bin/uvicorn app:app --port 8787
Cache key = sha1(engine | voice | normalized text), so the same text is only synthesized once.
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import re
import threading
import wave
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

BASE = Path(__file__).parent
VOICES_DIR = Path(os.environ.get("TTS_VOICES_DIR", BASE / "voices"))
CACHE_DIR = Path(os.environ.get("TTS_CACHE_DIR", BASE / "cache"))
CACHE_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_PIPER_VOICE = "de_DE-thorsten-high"
DEFAULT_EDGE_VOICE = "de-DE-KatjaNeural"
EDGE_VOICES = ["de-DE-KatjaNeural", "de-DE-ConradNeural", "de-DE-AmalaNeural", "de-DE-KillianNeural"]
MAX_CHARS = 500
PAD_SECONDS = 0.2  # silence before/after a clip so short words are not clipped

app = FastAPI(title="German learner TTS")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["GET"],
    allow_headers=["*"],
)

_piper_voices: dict[str, object] = {}
_piper_lock = threading.Lock()  # one synthesis at a time per process


def piper_voice_names() -> list[str]:
    return sorted(p.stem for p in VOICES_DIR.glob("*.onnx"))


def edge_available() -> bool:
    try:
        import edge_tts  # noqa: F401
        return True
    except ImportError:
        return False


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def cache_path(engine: str, voice: str, text: str, ext: str) -> Path:
    key = hashlib.sha1(f"{engine}|{voice}|{text}".encode("utf-8")).hexdigest()
    return CACHE_DIR / f"{key}.{ext}"


def _pad_wav(path: Path) -> None:
    with wave.open(str(path), "rb") as r:
        params = r.getparams()
        frames = r.readframes(r.getnframes())
    silence = b"\x00" * (int(params.framerate * PAD_SECONDS) * params.sampwidth * params.nchannels)
    with wave.open(str(path), "wb") as w:
        w.setparams(params)
        w.writeframes(silence + frames + silence)


def synth_piper(text: str, voice: str, out: Path) -> None:
    from piper import PiperVoice

    model = VOICES_DIR / f"{voice}.onnx"
    if not model.exists():
        raise HTTPException(404, f"Piper voice not installed: {voice}")
    with _piper_lock:
        v = _piper_voices.get(voice)
        if v is None:
            v = PiperVoice.load(str(model))
            _piper_voices[voice] = v
        tmp = out.with_suffix(".tmp")
        with wave.open(str(tmp), "wb") as wf:
            v.synthesize_wav(text, wf)  # type: ignore[attr-defined]
    _pad_wav(tmp)
    os.replace(tmp, out)


async def synth_edge(text: str, voice: str, out: Path) -> None:
    import edge_tts

    tmp = out.with_suffix(".tmp")
    try:
        await edge_tts.Communicate(text, voice).save(str(tmp))
    except Exception as e:  # network down, service changed, ...
        tmp.unlink(missing_ok=True)
        raise HTTPException(503, f"edge-tts failed: {e}") from e
    os.replace(tmp, out)


@app.get("/health")
def health():
    return {
        "ok": True,
        "engines": {
            "piper": {"available": bool(piper_voice_names()), "voices": piper_voice_names(), "default": DEFAULT_PIPER_VOICE},
            "edge": {"available": edge_available(), "voices": EDGE_VOICES, "default": DEFAULT_EDGE_VOICE},
        },
        "cached_files": sum(1 for _ in CACHE_DIR.iterdir()),
    }


@app.get("/tts")
async def tts(
    text: str = Query(..., min_length=1),
    engine: str = Query("piper", pattern="^(piper|edge)$"),
    voice: str | None = None,
):
    text = normalize(text)
    if not text:
        raise HTTPException(400, "empty text")
    if len(text) > MAX_CHARS:
        raise HTTPException(400, f"text too long (max {MAX_CHARS} chars)")
    # Single bare words sound abrupt without sentence-final intonation.
    spoken = text if re.search(r"[.!?…:;,]$", text) else text + "."

    if engine == "piper":
        voice = voice or DEFAULT_PIPER_VOICE
        if not re.fullmatch(r"[\w.\-]+", voice):
            raise HTTPException(400, "bad voice name")
        path = cache_path("piper", voice, spoken, "wav")
        media = "audio/wav"
        if not path.exists():
            await asyncio.to_thread(synth_piper, spoken, voice, path)
    else:
        voice = voice or DEFAULT_EDGE_VOICE
        if voice not in EDGE_VOICES:
            raise HTTPException(400, "unknown edge voice")
        if not edge_available():
            raise HTTPException(503, "edge-tts not installed")
        path = cache_path("edge", voice, spoken, "mp3")
        media = "audio/mpeg"
        if not path.exists():
            await synth_edge(spoken, voice, path)

    return FileResponse(path, media_type=media, headers={"Cache-Control": "public, max-age=31536000, immutable"})
