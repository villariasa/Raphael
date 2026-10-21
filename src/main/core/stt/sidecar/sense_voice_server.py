#!/usr/bin/env python3
"""
Raphael SenseVoice STT sidecar.

Persistent process: loads SenseVoiceSmall ONCE and keeps it warm, then reads
one JSON request per line on stdin and writes one JSON response per line on
stdout. Keeping the model resident is the whole fast-response story — a fresh
`funasr` load per utterance would cost seconds every time.

Protocol (newline-delimited JSON):
  in : {"id": "<str>", "cmd": "ping"}
       {"id": "<str>", "cmd": "transcribe", "wavPath": "<abs path>", "language": "auto"|"en"|"ja"}
  out: {"id": "<str>", "ok": true, "event": "ready"}          # emitted once at startup
       {"id": "<str>", "ok": true, "text": "<str>", "language": "<str>", "ms": <int>}
       {"id": "<str>", "ok": false, "reason": "<str>"}

All diagnostics go to stderr so stdout stays a clean JSON channel.
Local-first: audio never leaves the machine; nothing is sent over any network
beyond the one-time model download handled by funasr/ModelScope.
"""
import sys
import json
import time


def log(*a):
    print("[sense_voice_server]", *a, file=sys.stderr, flush=True)


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    # Import + model load are the slow part — do it once, up front.
    try:
        from funasr import AutoModel
        from funasr.utils.postprocess_utils import rich_transcription_postprocess
    except Exception as e:  # funasr missing / broken install
        emit({"id": "init", "ok": False, "event": "error", "reason": f"funasr import failed: {e}"})
        return 1

    device = "cpu"
    try:
        import torch  # noqa
        if torch.cuda.is_available():
            device = "cuda:0"
    except Exception:
        pass
    log(f"loading SenseVoiceSmall on {device} ...")

    try:
        model = AutoModel(
            model="iic/SenseVoiceSmall",
            trust_remote_code=True,
            disable_update=True,
            device=device,
        )
    except Exception as e:
        emit({"id": "init", "ok": False, "event": "error", "reason": f"model load failed: {e}"})
        return 1

    log("model ready")
    emit({"id": "init", "ok": True, "event": "ready", "device": device})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception as e:
            emit({"id": "?", "ok": False, "reason": f"bad json: {e}"})
            continue

        rid = req.get("id", "?")
        cmd = req.get("cmd", "transcribe")

        if cmd == "ping":
            emit({"id": rid, "ok": True, "event": "pong"})
            continue
        if cmd == "shutdown":
            emit({"id": rid, "ok": True, "event": "bye"})
            break

        wav_path = req.get("wavPath")
        language = req.get("language", "auto")
        if not wav_path:
            emit({"id": rid, "ok": False, "reason": "missing wavPath"})
            continue

        try:
            t0 = time.time()
            res = model.generate(
                input=wav_path,
                cache={},
                language=language,
                use_itn=True,
                batch_size_s=60,
            )
            text = rich_transcription_postprocess(res[0]["text"]) if res else ""
            ms = int((time.time() - t0) * 1000)
            emit({"id": rid, "ok": True, "text": text, "language": language, "ms": ms})
        except Exception as e:
            emit({"id": rid, "ok": False, "reason": f"transcribe failed: {e}"})

    return 0


if __name__ == "__main__":
    sys.exit(main())
