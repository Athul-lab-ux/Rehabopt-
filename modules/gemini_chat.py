"""
================================================================
REHABOPT — modules/gemini_chat.py
AI assistant chat (Session 2) — powered by the Gemini API.

Uses the NEW google-genai SDK (NOT the deprecated google-generativeai).
The assistant ONLY answers questions about our three sessions
(exercise, game, drawing) and the maths behind them. The API key is
stored in the database settings (add it in the Settings page).

If no key is set, or the API errors, we return a friendly offline
message instead of crashing the page.

NOTE on "NotFound" errors: Google renames / retires Gemini models
over time. A retired name makes the API return HTTP 404 "NotFound".
So we FIRST ask the API which models are actually available
(client.models.list()) and only fall back to a hardcoded list.
If a request still 404s, we forget that model and retry once
with the next available one.
================================================================
"""

# --- NEW SDK (no deprecation warning) ---
from google import genai
from google.genai import errors as genai_errors

SYSTEM_PROMPT = """You are the RehabOpt assistant, part of a stroke-recovery
rehabilitation system that tracks a patient's arm, wrist and fingers with a
webcam + MediaPipe Holistic and guides them through:

1) EXERCISE SESSION — 10 guided exercises (Fist Clench, Finger Spread, Wrist
   Flexion, Wrist Extension, Thumb Touch, Finger Pinch, Elbow Flexion,
   Forward Reach, Shoulder Raise, Shoulder Reach). Reps are counted only when
   all 4 steps are done correctly in order (no overcounting).
2) GAME SESSION — 9 hand-driven games (Star Catch, Bubble Pop, Balance Beam,
   Track the Dot, Flappy Reach, Fist Pop, Wrist Hammer, Elbow Crusher,
   Pinch Pop).
3) DRAWING SESSION — 9 trace shapes (Circle, Square, Triangle, Rectangle,
   Star, Heart, Pentagon, Hexagon, Diamond) plus a custom drawing canvas.

The system uses 7 mathematical concepts:
C1 vector geometry (joint angles), C2 L2 distance (targets/collisions),
C3 spatial variance (fist vs spread), C4 FFT (tremor 4-12 Hz),
S1 central finite differences (velocity/acceleration/jerk),
S2 Savitzky-Golay filter (noise removal), S3 quadratic programming
(minimum-jerk optimal trajectory).

Answer ONLY questions related to these sessions, the exercises, the games,
the drawing, the maths concepts, or rehabilitation guidance. Keep answers
short (max ~120 words), simple, and encouraging. If asked something unrelated,
politely steer back to the rehabilitation topics."""

_client = None   # genai.Client instance
_configured = False


def configure(api_key):
    """Call once with the patient's API key."""
    global _client, _configured
    if api_key:
        _client = genai.Client(api_key=api_key)
        _configured = True
    else:
        _client = None
        _configured = False


def is_ready():
    return _configured


# ------------------------------------------------------------------
# Model-name discovery (new SDK)
# ------------------------------------------------------------------
# Current, working Gemini model IDs (kept up to date; only used when
# the live list_models() call fails, e.g. offline or old SDK).
_FALLBACK_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.5-pro",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
]


def _available_flash_models(skip=()):
    """Ask the Gemini API which chat models actually exist right now.

    Returns model names (newest flash first). Anything preview/experimental
    or specialised (image / live / tts / audio / embedding) is skipped.
    On any API error we return [] and the caller uses the fallback list.
    """
    if _client is None:
        return []
    try:
        names = []
        for m in _client.models.list():
            methods = getattr(m, "supported_generation_methods", ()) or ()
            if "generateContent" not in methods:
                continue
            nm = getattr(m, "name", "") or ""
            # new SDK returns full path like "models/gemini-2.5-flash"
            if nm.startswith("models/"):
                nm = nm[len("models/"):]
            if not nm or nm in skip:
                continue
            low = nm.lower()
            if any(k in low for k in ("preview", "exp", "image", "live",
                                      "tts", "audio", "embed", "omni",
                                      "computer-use")):
                continue
            if "flash" in low or "pro" in low:
                names.append(nm)

        def rank(nm):
            low = nm.lower()
            digits = [p for p in low.replace("-", ".").split(".") if p.isdigit()]
            ver = tuple(int(p) for p in digits) if digits else (0,)
            return (0 if "flash" in low else 1, -ver)

        names.sort(key=rank)
        return names
    except Exception:
        return []


class ChatSession:
    """One chat conversation (per patient, kept in memory)."""

    def __init__(self):
        self.model_name = None
        self._tried = set()
        self.history = []   # list of genai.Content objects

    # -- model picking ------------------------------------------------
    def _pick_model_name(self):
        # 1) ask the API what is available right now
        for nm in _available_flash_models(skip=self._tried):
            return nm
        # 2) offline fallback list (current names only)
        for nm in _FALLBACK_MODELS:
            if nm not in self._tried:
                return nm
        return None

    # -- request wrapper with one auto-retry --------------------------
    def _call(self, fn):
        """Run fn(client, model_name, history). If the API returns 404
        NotFound (deprecated model name), drop the model, rediscover,
        and retry exactly once."""
        name = self._pick_model_name()
        if name is None:
            return None, ("⚠️ Could not find an available Gemini model — "
                          "check your API key and internet connection.")
        self._tried.add(name)
        self.model_name = name

        if _client is None:
            return None, ("⚠️ No Gemini API key set yet. Open the ⚙️ Settings "
                          "page and paste your free key from aistudio.google.com.")

        try:
            return fn(_client, name, self.history), None
        except (genai_errors.ClientError, Exception) as e:
            err_str = str(e).lower()
            if "notfound" in err_str or "404" in err_str:
                # stale name -> try the next one
                self.model_name = None
                name = self._pick_model_name()
                if name is None:
                    return None, ("⚠️ Could not find an available Gemini model — "
                                  "check your API key and internet connection.")
                self._tried.add(name)
                self.model_name = name
                try:
                    return fn(_client, name, self.history), None
                except Exception as e2:
                    return None, (f"⚠️ Gemini error: {type(e2).__name__} — "
                                  "check your API key and internet connection.")
            return None, (f"⚠️ Gemini error: {type(e).__name__} — "
                          "check your API key and internet connection.")

    # -- chat ---------------------------------------------------------
    def send(self, message):
        """Send a user message, return the assistant reply text."""
        if not _configured:
            return ("⚠️ No Gemini API key set yet. Open the ⚙️ Settings page "
                    "and paste your free key from aistudio.google.com.")

        def run(client, model_name, history):
            contents = []
            # convert our simple history to genai Content objects
            for h in history:
                role = h["role"]
                text = h["text"]
                contents.append(genai.types.Content(
                    role=role,
                    parts=[genai.types.Part.from_text(text)]
                ))
            # add the new user message
            contents.append(genai.types.Content(
                role="user",
                parts=[genai.types.Part.from_text(message)]
            ))
            response = client.models.generate_content(
                model=model_name,
                contents=contents,
                config=genai.types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT
                )
            )
            return response.text

        reply, err = self._call(run)
        if err:
            return err
        self.history.append({"role": "user", "text": message})
        self.history.append({"role": "model", "text": reply})
        return reply

    # -- file upload --------------------------------------------------
    def analyze_file(self, file_path, mime_type, prompt):
        """Upload a file (image / pdf / ppt / text) and ask Gemini to
        identify it and give rehabilitation guidance.

        Text files are read directly; images / PDFs / PPTs go through
        the Gemini Files API.
        """
        if not _configured:
            return ("⚠️ No Gemini API key set yet. Open the ⚙️ Settings page "
                    "and paste your free key from aistudio.google.com.")

        def run(client, model_name, history):
            if mime_type.startswith("text/"):
                # ---- text file: just read the content --------------
                with open(file_path, "r", encoding="utf-8",
                          errors="ignore") as f:
                    content = f.read()[:20000]
                response = client.models.generate_content(
                    model=model_name,
                    contents=[
                        genai.types.Part.from_text(content),
                        genai.types.Part.from_text(prompt)
                    ],
                    config=genai.types.GenerateContentConfig(
                        system_instruction=SYSTEM_PROMPT
                    )
                )
            else:
                # ---- images / pdf / ppt: Gemini Files API ----------
                uploaded = client.files.upload(
                    file=file_path,
                    config=genai.types.UploadFileConfig(
                        mime_type=mime_type
                    )
                )
                # wait for processing
                import time
                for _ in range(20):
                    info = client.files.get(name=uploaded.name)
                    if info.state.name == "ACTIVE":
                        break
                    time.sleep(0.5)
                response = client.models.generate_content(
                    model=model_name,
                    contents=[
                        uploaded,
                        genai.types.Part.from_text(prompt)
                    ],
                    config=genai.types.GenerateContentConfig(
                        system_instruction=SYSTEM_PROMPT
                    )
                )
            return response.text

        reply, err = self._call(run)
        if err:
            return f"⚠️ Could not analyze the file: {err}"
        self.history.append({"role": "user",
                             "text": f"[Uploaded file: {prompt}]"})
        self.history.append({"role": "model", "text": reply})
        return reply
