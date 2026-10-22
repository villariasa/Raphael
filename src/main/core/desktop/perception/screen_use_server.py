#!/usr/bin/env python3
"""
Raphael Desktop Perception sidecar (screen-use).

Persistent process: holds a warm screen-use / UIA session and answers one JSON
request per line on stdin with one JSON response per line on stdout. This is
the SEE + ACT half of the Desktop Engine (window management is Win32/TS). It
drives the REAL Windows desktop — no mock state (§19).

Protocol (newline-delimited JSON):
  in : {"id","cmd":"ping"}
       {"id","cmd":"observe"}                      -> UIA element list + active window
       {"id","cmd":"screenshot"}                   -> base64 PNG
       {"id","cmd":"find","query":"Add Product"}   -> best-matching element bounds
       {"id","cmd":"click","query":"..."|"x":..,"y":..}
       {"id","cmd":"type","text":"..."}
       {"id","cmd":"scroll","amount":-500}
       {"id","cmd":"cursor"}                        -> current real cursor pos
  out: {"id","ok":true,...} | {"id","ok":false,"reason":"..."}
       {"id":"init","ok":true,"event":"ready"}      (emitted once at startup)

Diagnostics go to stderr so stdout stays a clean JSON channel. Local-first:
screen data never leaves the machine (§17).
"""
import sys
import json
import base64
import io


def log(*a):
    print("[screen_use_server]", *a, file=sys.stderr, flush=True)


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


class Backend:
    """Wraps screen-use when available; falls back to pyautogui + pywinauto UIA.

    Either way these are REAL desktop operations. The fallback keeps Raphael
    functional if the full screen-use package isn't importable, while still
    using the same underlying Windows UIA / input stack."""

    def __init__(self):
        self.screenuse = None
        self.pyautogui = None
        self.uia = None
        try:
            # Preferred: the full screen-use SDK (UIA tree + set-of-mark + vision).
            from screen_use import ScreenUse  # type: ignore
            self.screenuse = ScreenUse()
            log("using screen-use SDK")
            return
        except Exception as e:
            log(f"screen-use SDK unavailable ({e}); using pyautogui/UIA fallback")
        import pyautogui  # type: ignore
        pyautogui.FAILSAFE = True  # slam mouse to a corner = abort (user override)
        self.pyautogui = pyautogui
        try:
            from pywinauto import Desktop  # type: ignore
            self.uia = Desktop(backend="uia")
        except Exception as e:
            log(f"pywinauto UIA unavailable ({e}); element detection limited")

    # --- perception ---
    def observe(self):
        if self.screenuse:
            els = self.screenuse.list_ui_elements()
            return {"elements": els, "activeWindow": getattr(self.screenuse, "active_window", lambda: None)()}
        elements = []
        if self.uia:
            try:
                win = self.uia.window(active_only=True)
                for c in win.descendants():
                    try:
                        r = c.rectangle()
                        name = c.window_text()
                        ctype = c.element_info.control_type
                        if not name:
                            continue
                        elements.append({
                            "element": name,
                            "type": ctype,
                            "bounds": {"x": r.left, "y": r.top, "width": r.width(), "height": r.height()},
                            "center": {"x": (r.left + r.right) // 2, "y": (r.top + r.bottom) // 2},
                        })
                    except Exception:
                        continue
            except Exception as e:
                log(f"observe error: {e}")
        return {"elements": elements[:200], "activeWindow": None}

    def find(self, query):
        els = self.observe()["elements"]
        q = (query or "").strip().lower()
        best = None
        for e in els:
            name = (e.get("element") or "").lower()
            if name == q:
                return e
            if q and q in name and best is None:
                best = e
        return best

    def screenshot(self):
        if self.pyautogui:
            img = self.pyautogui.screenshot()
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            return base64.b64encode(buf.getvalue()).decode("ascii")
        if self.screenuse:
            return self.screenuse.screenshot()
        return None

    def cursor(self):
        if self.pyautogui:
            x, y = self.pyautogui.position()
            return {"x": int(x), "y": int(y)}
        return None

    # --- action ---
    def click(self, req):
        x, y = req.get("x"), req.get("y")
        if x is None or y is None:
            el = self.find(req.get("query", ""))
            if not el:
                return {"ok": False, "reason": "element_not_found"}
            x, y = el["center"]["x"], el["center"]["y"]
        if self.screenuse:
            self.screenuse.click_element(x=x, y=y)
        elif self.pyautogui:
            # Human-like move then click (§10) rather than teleport.
            self.pyautogui.moveTo(x, y, duration=0.35)
            self.pyautogui.click()
        return {"ok": True, "x": x, "y": y}

    def type_text(self, text):
        if self.screenuse:
            self.screenuse.type_text(text)
        elif self.pyautogui:
            self.pyautogui.typewrite(text, interval=0.01)
        return {"ok": True}

    def scroll(self, amount):
        if self.pyautogui:
            self.pyautogui.scroll(int(amount))
        return {"ok": True}


def main():
    try:
        backend = Backend()
    except Exception as e:
        emit({"id": "init", "ok": False, "event": "error", "reason": f"backend init failed: {e}"})
        return 1
    emit({"id": "init", "ok": True, "event": "ready"})

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
        cmd = req.get("cmd", "")
        try:
            if cmd == "ping":
                emit({"id": rid, "ok": True, "event": "pong"})
            elif cmd == "shutdown":
                emit({"id": rid, "ok": True, "event": "bye"})
                break
            elif cmd == "observe":
                emit({"id": rid, "ok": True, **backend.observe()})
            elif cmd == "screenshot":
                emit({"id": rid, "ok": True, "pngBase64": backend.screenshot()})
            elif cmd == "find":
                el = backend.find(req.get("query", ""))
                emit({"id": rid, "ok": el is not None, "element": el})
            elif cmd == "click":
                emit({"id": rid, **backend.click(req)})
            elif cmd == "type":
                emit({"id": rid, **backend.type_text(req.get("text", ""))})
            elif cmd == "scroll":
                emit({"id": rid, **backend.scroll(req.get("amount", 0))})
            elif cmd == "cursor":
                emit({"id": rid, "ok": True, "cursor": backend.cursor()})
            else:
                emit({"id": rid, "ok": False, "reason": f"unknown cmd {cmd}"})
        except Exception as e:
            emit({"id": rid, "ok": False, "reason": f"{cmd} failed: {e}"})

    return 0


if __name__ == "__main__":
    sys.exit(main())
