# Raphael — Desktop Perception & Control Engine

**Status:** Architecture plan + increment 1 (Window Manager) implemented.
**Constraint:** The engine is Windows-only and controls the *real* desktop. It
cannot be runtime-tested on the Linux dev box — verification of actual desktop
behavior happens on the Windows target. No fake cursor / fake window moves /
mock state (§19): everything reads from and acts on the real OS.

---

## 0. Inspection results (§20)

**Existing Raphael (reused, not rewritten):**
- Electron + React/TS; main↔renderer via a narrow preload IPC surface.
- AI: Ollama provider + rule-first `Planner`; structured `SafeAction` → `PermissionGate` → `Executor` → verify → broadcast status. **The Desktop Engine plugs in as new action kinds + a new subsystem — the planner/permission/executor spine is unchanged.**
- Already real: app launch + close with process-table verification (`openApp.ts`, `appLauncher.ts`), a transparent click-through `CursorOverlay` window (cosmetic today), SenseVoice **Python sidecar** pattern (`SttManager` + JSON-over-stdio) — the exact pattern the perception layer reuses.
- Permission categories, activity log, settings store, response engine — all exist.

**screen-use** (github.com/tongriyaotxt/screen-use): **Python 3.10+, Windows-only.**
UIA accessibility tree (~150 controls, ~0.1s) + Set-of-Mark screenshots (mss) +
PyAutoGUI mouse/keyboard + optional vision (Ollama/OpenAI/Qwen). Exposed as a
Python SDK (`ScreenUse`: `screenshot`, `list_ui_elements`, `find_element`,
`click_element`, `type_text`, `run_task`). → **Run it as a persistent Python
sidecar**, same as SenseVoice.

---

## 1. Module layout

```
src/main/core/desktop/
  desktopEngine.ts        # facade: owns the pieces below, exposes one API
  windowManager.ts        # ✅ increment 1 — real Win32 via PowerShell
  appLauncher.ts (exists) # application launch/close (+ discovery upgrade)
  perception/
    screenUseSidecar.ts   # JSON-over-stdio to the Python screen-use process
    screen_use_server.py  # persistent: UIA tree + screenshot + click/type
    perception.ts         # ScreenState cache + change detection + "what's on screen"
  cursorController.ts     # drives the CursorOverlay states, follows real mouse
  verification.ts         # post-action re-observe + compare
  permissions.ts          # desktop capability toggles (maps to §13 categories)
```

Everything is modular (§1) and behind TypeScript interfaces (§20).

---

## 2. Core interfaces (§20)

```ts
interface WindowState { hwnd; processId; processName; title; bounds; monitor; state }
interface ScreenState { activeApplication; windowTitle; windowBounds; monitor;
                        visibleElements: UiElement[]; screenChanged; capturedAt }
interface UiElement { element; type; bounds; center; value? }
interface DesktopAction { kind; params }            // structured, never raw coords from the LLM
interface ActionResult { success; detail; verified; before?; after? }
```

Implemented in `desktop/types.ts`.

---

## 3. SEE → THINK → ACT → VERIFY loop (§8)

```
OBSERVE  perception.getScreenState()  (UIA/OCR; vision only when needed §2/§16)
   ↓
PLAN     planner → structured DesktopAction (never guessed pixels §5/§20)
   ↓
PERMIT   permission gate (READ_SCREEN / MOVE_WINDOWS / CONTROL_MOUSE … §13)
   ↓
MOVE     cursorController shows Raphael cursor, moves to element.center (§3/§10)
   ↓
ACT      windowManager / screenUseSidecar performs the real action
   ↓
OBSERVE  re-read state
   ↓
VERIFY   verification.ts compares expected vs actual (§8/§18) — no fake success
```

---

## 4. The visible Raphael cursor (§3)

Upgrade the existing `CursorOverlay` (already a transparent, click-through,
always-on-top window) into a **state machine**: IDLE / THINKING / MOVING /
TARGETING / CLICKING / DRAGGING / EXECUTING / SUCCESS / ERROR. It *follows the
real mouse position* (polled from the OS) and animates to targets — it never
replaces the system cursor and never blocks the user's real mouse. Disappears
when idle. Driven by actual action events, not faked (§3/§4/§19).

---

## 5. User override / safety (§12/§13/§15)

- STOP / PAUSE / CANCEL / EMERGENCY-STOP already exist via `taskManager` + the
  existing stop paths; extended to abort desktop actions mid-flight.
- **Manual-intervention detection:** while Raphael drives the mouse, poll the
  real cursor; if it jumps somewhere Raphael didn't command → **pause**, release
  control, "Paused. You have control."
- Permission categories gate every capability; high-risk (install / admin /
  delete / unknown-exe) always confirm (§7/§13).
- Failure recovery: re-observe → recompute target → retry up to N; never
  blind-repeat the same click; if unsure → pause and hand control back (§15).

---

## 6. Privacy (§17)

Screenshots/UIA stay local. Vision model is **off by default**; only invoked
when UIA/OCR can't resolve a target. Toggles: Screen Monitoring / Vision
Analysis / Cloud Vision — cloud clearly flagged before any upload.

---

## 7. Increment plan (§20 "implement incrementally")

- **✅ Increment 1 — Window Manager (this turn).** Real Win32 via PowerShell:
  enumerate windows, read bounds, move (snap left/right), resize, maximize,
  minimize, restore, center, focus, close, move-to-monitor — each **verified**
  by reading `GetWindowRect` back. Needs **no native modules** and is testable
  on Windows immediately. Wired as new action kinds + planner intents +
  permission category + executor handlers.
- **Increment 2 — Perception sidecar.** `screen_use_server.py` (clone/point at
  screen-use) + `screenUseSidecar.ts` + `ScreenState` cache/change-detection +
  "what's on screen?" answer.
- **Increment 3 — Cursor controller.** Overlay state machine following the real
  mouse; manual-intervention pause.
- **Increment 4 — UI interaction.** click_element / type_text / drag via the
  sidecar, targeting UIA element centers, with verification.
- **Increment 5 — App discovery + setup/bootstrapping** (§6/§7), with the
  understand-before-clicking safety gate on privileged dialogs.
- **Increment 6 — Desktop permission UI + vision/privacy toggles** (§13/§17).

---

## 8. Why window management is increment 1

It's the only large desktop-control surface that is **real, verifiable, and
needs zero native modules or Python** — pure Win32 through PowerShell, the same
mechanism the existing app launcher already uses. It delivers "move Chrome left
/ maximize VS Code / put the terminal 800×600" on day one, and proves the
OBSERVE→ACT→VERIFY loop end-to-end before the heavier perception sidecar lands.
