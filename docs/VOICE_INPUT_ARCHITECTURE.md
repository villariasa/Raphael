# Raphael — Voice Input (Listening) Architecture

**Status:** DRAFT for review — no code written yet.
**Goal:** Give Raphael real local speech-to-text so My Liege can *optionally* speak
commands, with low perceived latency, fully local-first (§22), wired into the
existing planner → permission → executor pipeline without rewriting it.

### Guiding principle: typing stays primary
The **text box is the primary chat and always works** — unchanged. Voice (SenseVoice
listening) is an **additional, opt-in input**, off by default. It never replaces
typing, never becomes required, and if it's unavailable (no runtime, no model, mic
denied, sidecar crash) the app behaves exactly as it does today. Both inputs produce
the same thing — text that enters `submitCommand` — so everything downstream is
identical whether My Liege typed or spoke.

---

## 0. What SenseVoice is (and isn't)

- **STT only.** It transcribes audio → text (+ language ID, emotion, audio events).
  It does **not** speak. Speaking stays with the existing `TtsManager`.
- Model: **SenseVoiceSmall** (`iic/SenseVoiceSmall`), auto-downloads on first load.
- Languages: Mandarin, Cantonese, **English, Japanese**, Korean.
- **Utterance-based, not streaming.** ≤30s audio per call; longer needs VAD
  segmentation. So the unit of work is "one spoken utterance," not a live stream.
- ~5× faster than Whisper-Small. Runs on **GPU (CUDA)** or **CPU**.
- Canonical repo: `github.com/FunAudioLLM/SenseVoice` (MIT license for code).
- Two runtimes exist:
  - **(A) Python + funasr** (`pip install "funasr>=1.3.26"`, `AutoModel`) — full-featured.
  - **(B) llama.cpp single binary** — CPU, no Python. Lighter to bundle, fewer features.

---

## 1. High-level component diagram

```
┌─────────────────────────────── RENDERER (React) ───────────────────────────────┐
│                                                                                 │
│   🎙 Mic button / hotkey / (wake word)                                          │
│            │ getUserMedia                                                       │
│            ▼                                                                     │
│   MicCapture  ──▶  VAD (voice activity detection)  ──▶  utterance WAV (16kHz)   │
│            │              (detect speech start/end)            │                 │
│            │  state: LISTENING  ──────────────────────────────┼─▶ Visualizer    │
│            │                                                   │                 │
└────────────┼───────────────────────────────────────────────── │ ───────────────┘
             │  IPC: stt:transcribe(wavBytes)                    │
             ▼                                                    ▼
┌─────────────────────────────── MAIN (Node/Electron) ───────────────────────────┐
│                                                                                 │
│   SttManager  ◀── owns ──▶  SenseVoice Sidecar (persistent, model warm)         │
│      │  (setup/lifecycle)        │  stdin/stdout JSON  OR  127.0.0.1 socket     │
│      │                           ▼                                              │
│      │                     [ SenseVoiceSmall ]  → transcript text               │
│      ▼                                                                          │
│   transcript ──▶ (same path as typed text) ──▶ Planner → PermissionGate →       │
│                                                 Executor → verify → broadcast   │
│                                                        │                        │
│                                                        ▼                        │
│                                          TTS reply + live subtitle (existing)   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

Key idea: **the transcript re-enters the EXACT pipeline a typed command uses**
(`submitCommand`). Listening is a new *front door*, not a new brain.

---

## 2. End-to-end sequence (one voice command)

```
1. My Liege triggers listening        (push-to-talk / hotkey / wake word)
2. MicCapture opens the mic           → state = LISTENING, visualizer shows it
3. VAD detects speech, then silence   → endpoint = "utterance finished"
4. Renderer encodes utterance → WAV   (16 kHz mono, the format SenseVoice wants)
5. Renderer → IPC stt:transcribe      → Main
6. Main → Sidecar (warm model)        → transcript (e.g. "open chrome")
7. Main returns transcript            → Renderer shows it in the input box
8. Auto-submit (or confirm) → submitCommand(transcript)   ← EXISTING pipeline
9. Planner → Permission → Executor → verify → status broadcast
10. Raphael speaks the result + live subtitle               ← EXISTING
11. state returns to IDLE (or back to LISTENING if "continuous" mode)
```

**Barge-in rule:** while Raphael is SPEAKING, the mic is muted/ignored by default so
Raphael doesn't transcribe its own voice. (Optional later: allow "Raphael, stop"
barge-in via a tiny always-on keyword spotter.)

---

## 3. Component breakdown

### 3.1 MicCapture + VAD  (renderer)
- `getUserMedia({ audio })` → Web Audio graph.
- **VAD** decides when an utterance starts and (critically for latency) ends.
  Options: lightweight energy/RMS threshold (cheap, MVP) or `@ricky0123/vad-web`
  (Silero VAD in WASM, much better endpointing). Endpoint detection delay is the
  single biggest driver of *perceived* speed → worth doing well.
- Produces a mono 16 kHz WAV blob per utterance.
- Owns the `LISTENING` visual state while active.

### 3.2 Audio bridge (IPC)
- Default: renderer sends the finished utterance WAV to **main** via a new
  `stt:transcribe` IPC call; main relays to the sidecar. Keeps the narrow,
  main-brokered security surface (§3/§18) — renderer never talks to a raw socket.
- Utterances are small (a few seconds of 16 kHz mono ≈ tens–hundreds of KB), so
  one-shot IPC transfer is fine. No need to stream through IPC.

### 3.3 SenseVoice Sidecar (main owns it)
- A **persistent** process started by main, model loaded **once** and kept warm
  (this is the core "fast response" decision — reloading per utterance would add
  seconds every time).
- Protocol (simple, framed JSON):
  - **Request:**  `{ id, wavPath | wavBase64, language: "auto"|"en"|"ja" }`
  - **Response:** `{ id, text, language, ms }`
- Transport: **stdin/stdout newline-JSON** (simplest, no port) *or* a localhost
  socket on a random port only main knows. Lean stdin/stdout for MVP.
- Runtime choice = Option A (Python) or Option B (llama.cpp binary) — see §10.

### 3.4 SttManager  (main) — mirrors OllamaManager
- Owns sidecar lifecycle: spawn, health-check, restart on crash, dispose on quit.
- Owns **setup**: detect runtime, install/download, fetch model, verify — emitting
  progress events to the UI exactly like `OllamaManager` already does.
- Public: `transcribe(wav): Promise<{text, language}>`, `getStatus()`, `setup()`.

### 3.5 Pipeline integration (reuse, don't rebuild)
- Transcript is handed to the **existing** `submitCommand` flow. The planner,
  permission gate, executor, verification, activity log, TTS, subtitle — all
  unchanged. Voice is purely an input source.
- Conversation memory (`ConversationStore`) records voice turns the same as typed
  ones, so history/context still works.

---

## 4. New IPC surface (additions only)

```
renderer → main
  stt:getStatus()            → { available, runtime, modelReady, setupProgress }
  stt:setup()                → triggers install/download (progress via event)
  stt:transcribe(wavBytes)   → { ok, text, language } | { ok:false, reason }
  stt:setMicEnabled(enabled) → persists the MICROPHONE permission toggle

main → renderer (events)
  stt:setupProgress          → { stage, percent, message }   (like aiSetupEvent)
  stt:vadState (optional)     → speaking/silence, for UI
```

Mic **capture** itself stays in the renderer (browser API); main handles
transcription + setup + the persisted enable/disable switch.

---

## 5. Setup & lifecycle  (the heavy part, mirror Ollama)

```
App start
   ↓
SttManager.detect()
   ├─ runtime present?  (python+funasr  OR  llama.cpp binary)
   │     └─ no → offer install (with size + consent), or mark unavailable
   ├─ model present?    (SenseVoiceSmall)
   │     └─ no → download on first use (consent; show progress)
   ├─ spawn sidecar, load model (warm)
   └─ health check → status = ready
```

- First-run download is **hundreds of MB** (model) + possibly a Python env.
  Must be **consented + progress-tracked**, never silent. Same UX as the existing
  Ollama setup banner.
- On quit / window close: kill the sidecar (no orphaned mic/transcription process),
  consistent with §2 "no automation outlives Raphael."

---

## 6. Permissions & privacy

- New permission category **MICROPHONE** (already in the §18 list).
- Mic is **off by default**; explicit user enable. A visible "mic on/off" control.
- Audio is processed **entirely locally** (sidecar on 127.0.0.1 / stdin) and never
  transmitted. WAVs are transient (temp file deleted after transcription, or
  in-memory).
- Disabling the mic must actually stop capture (`getUserMedia` track.stop()), not
  just hide a button.

---

## 7. "Faster response" strategy (your main ask)

Perceived latency = `endpoint-detection + transfer + transcription + plan + exec`.
Levers, in order of impact:

1. **Warm model in a persistent sidecar** — avoids multi-second reload per command.
2. **Good VAD endpointing** — detect end-of-speech quickly (Silero VAD) instead of a
   long fixed silence timeout.
3. **SenseVoiceSmall + correct 16 kHz mono input** — its native fast path.
4. **GPU if available, CPU fallback** — auto-detected.
5. **Overlap where safe:** the regex intents (`open chrome`, etc.) can begin the
   moment the transcript lands — no LLM round-trip for those. Only the
   conversational fallback hits Ollama.
6. **(Later) partial transcription** — SenseVoice isn't streaming, but we could
   transcribe on a short rolling window to show interim text. Deferred.

Realistic target: sub-second from end-of-speech to action start for the common
"open X" commands on a warm model.

---

## 8. State machine & visuals (reuse existing)

- `LISTENING` state (already defined, currently only reachable via debug) becomes
  real: mic active → `listening`.
- After endpoint → `thinking` (transcribing + planning) → existing states.
- The live subtitle system can optionally also render the **user's** transcript
  briefly ("heard: open chrome") — nice feedback, optional.

---

## 9. Failure modes & fallbacks

| Failure | Behavior |
|---|---|
| No Python / funasr / binary | STT marked unavailable; honest message; typing still works |
| Model not downloaded | Prompt to download (consent + progress); don't block app |
| Sidecar crash | SttManager restarts it; if repeated, degrade to unavailable |
| Empty / noise utterance | "I didn't catch that, My Liege." — no fake command |
| Low-confidence transcript | Show it in the input box for confirm instead of auto-run (configurable) |
| Mic permission denied | Honest notice; feature stays off |

Deliberately **not** defaulting to a cloud STT (e.g. browser Web Speech API) —
that would break local-first privacy. Could be an explicit opt-in later.

---

## 10. Open decisions (need your review ✍️)

1. **Runtime:** (A) Python + funasr (full features, heavier bundle, needs a Python
   env) vs (B) llama.cpp single binary (CPU-only, lighter, fewer features).
   → *My lean: start with (A) to match the ModelScope path, keep the sidecar
   protocol runtime-agnostic so (B) can swap in.*
2. **Trigger:** push-to-talk button / global hotkey (reuse Ctrl+Space idea) /
   wake word ("Raphael"). Wake word needs a separate always-on spotter
   (openWakeWord/Porcupine). → *My lean: hotkey + mic button first; wake word later.*
3. **Auto-run vs confirm:** after transcription, run immediately, or drop the text
   in the box for Enter? → *My lean: auto-run for high-confidence, confirm for low.*
4. **Model delivery:** bundle in installer (big) vs download-on-first-run (consent).
   → *My lean: download-on-first-run, like Ollama.*
5. **Barge-in:** mute mic while Raphael speaks (simple) vs allow "stop" interrupt
   (needs a mini keyword spotter). → *My lean: mute-while-speaking first.*

---

## 11. Proposed file plan (when approved)

```
src/main/core/stt/
  sttManager.ts        # lifecycle + setup + transcribe() (mirrors OllamaManager)
  senseVoiceSidecar.ts # spawn/health/JSON protocol to the python/binary process
  sidecar/
    sense_voice_server.py   # persistent: load model once, read JSON reqs on stdin
src/renderer/src/voice/
  useMicCapture.ts     # getUserMedia + encode 16kHz WAV
  useVad.ts            # endpointing (energy MVP → Silero later)
  VoiceButton.tsx      # mic toggle + LISTENING wiring
src/shared/ipc.ts      # + stt:* channels & types
src/main/index.ts      # instantiate SttManager, wire IPC, dispose on quit
```

## 12. Phased build (after you approve the flow)

- **Phase 1:** SttManager + sidecar + `transcribe()` proven on a sample WAV (no mic).
- **Phase 2:** MicCapture + simple VAD + hotkey → transcript into the input box.
- **Phase 3:** Auto-run + LISTENING state + barge-in mute + mic permission toggle.
- **Phase 4:** Setup/download UX (consent + progress), crash-restart, polish.
- **Phase 5 (optional):** wake word, interim transcript subtitle, GPU tuning.
