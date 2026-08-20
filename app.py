"""
================================================================
REHABOPT — app.py  (Browser-Side MediaPipe Version)
Run:  python app.py   ->   http://localhost:8000

This version runs MediaPipe in the BROWSER (JavaScript).
The server only handles:
  - Login / Register (Session 1)
  - Dashboard (Session 2)
  - AI Chat with Gemini
  - Reports + PDF (Session 4)
  - Saving session data from browser

The webcam + skeleton + exercise/game/drawing engines all run
in the user's browser using JavaScript MediaPipe.
================================================================
"""
import json
import logging
import os
import sys
import threading
import time
from functools import wraps

from flask import (Flask, Response, jsonify, redirect, render_template,
                   request, session, url_for)

from config import get_config
import database as db
from modules import gemini_chat
from modules.report import generate_daily_pdf

# ------------------------------------------------------------------
# Logging
# ------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("rehabopt")

# ------------------------------------------------------------------
# Flask app
# ------------------------------------------------------------------
app = Flask(__name__)
config = get_config()
app.config.from_object(config)
os.makedirs(config.UPLOAD_DIR, exist_ok=True)

# ------------------------------------------------------------------
# Security headers
# ------------------------------------------------------------------
@app.after_request
def add_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response

# ------------------------------------------------------------------
# Rate limiting (in-memory)
# ------------------------------------------------------------------
_rate_limits = {}
_rate_lock = threading.Lock()

def rate_limit(max_requests=60, window=60):
    def decorator(f):
        @wraps(f)
        def wrapped(*args, **kwargs):
            client_ip = request.remote_addr or "unknown"
            key = f"{f.__name__}:{client_ip}"
            now = time.time()
            with _rate_lock:
                if key not in _rate_limits:
                    _rate_limits[key] = []
                _rate_limits[key] = [t for t in _rate_limits[key] if now - t < window]
                if len(_rate_limits[key]) >= max_requests:
                    return jsonify({"error": "Too many requests"}), 429
                _rate_limits[key].append(now)
            return f(*args, **kwargs)
        return wrapped
    return decorator

# ------------------------------------------------------------------
# Init
# ------------------------------------------------------------------
db.init_db()

# ------------------------------------------------------------------
# Login helpers
# ------------------------------------------------------------------
def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("user_id"):
            return redirect(url_for("login_page"))
        return fn(*args, **kwargs)
    return wrapper

# ------------------------------------------------------------------
# Health check
# ------------------------------------------------------------------
@app.route("/health")
def health_check():
    return jsonify({"status": "healthy", "service": "rehabopt", "version": "2.0.0"})

@app.route("/ready")
def readiness_check():
    try:
        db.get_user(1)
        return jsonify({"status": "ready"}), 200
    except Exception as e:
        return jsonify({"status": "not ready", "error": str(e)}), 503

# ==================================================================
# SESSION 1 — Login / Register
# ==================================================================
@app.route("/")
def index():
    if session.get("user_id"):
        return redirect(url_for("dashboard"))
    return redirect(url_for("login_page"))

@app.route("/login", methods=["GET", "POST"])
@rate_limit(max_requests=10, window=60)
def login_page():
    error = None
    if request.method == "POST":
        pid = request.form.get("patient_id", "").strip()
        pw = request.form.get("password", "")
        if not pid or not pw:
            error = "Please enter both Patient ID and password"
        elif len(pw) < 4:
            error = "Password must be at least 4 characters"
        else:
            try:
                ok, msg, user = db.login_user(pid, pw)
                if ok and user is not None:
                    session["user_id"] = user["id"]
                    session["patient_id"] = user["patient_id"]
                    return redirect(url_for("dashboard"))
                error = msg
            except Exception as e:
                logger.error(f"Login error: {e}")
                error = "An error occurred"
    return render_template("login.html", error=error)

@app.route("/register", methods=["GET", "POST"])
@rate_limit(max_requests=5, window=60)
def register_page():
    error = None
    success = None
    if request.method == "POST":
        email = request.form.get("email", "").strip()
        pw = request.form.get("password", "")
        pw2 = request.form.get("confirm", "")
        if not email or "@" not in email:
            error = "Please enter a valid email address"
        elif not pw or len(pw) < 4:
            error = "Password must be at least 4 characters"
        elif pw != pw2:
            error = "Passwords do not match"
        else:
            try:
                ok, msg, pid = db.register_user(email, pw)
                if ok:
                    success = msg
                else:
                    error = msg
            except Exception as e:
                logger.error(f"Registration error: {e}")
                error = "An error occurred"
    return render_template("register.html", error=error, success=success)

@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login_page"))

# ==================================================================
# SESSION 2 — Dashboard
# ==================================================================
@app.route("/dashboard")
@login_required
def dashboard():
    user = db.get_user(session["user_id"])
    recovery = 0
    sessions = db.get_sessions(user["id"])[:20]
    vals = []
    for s in sessions:
        if s["session_type"] != "exercise":
            continue
        logs = db.get_rep_logs(s["id"])
        if not logs:
            continue
        sm = sum(l["smoothness"] for l in logs) / len(logs)
        rom = sum(min(l["rom"], 180) / 180 * 100 for l in logs) / len(logs)
        vals.append(sm * 0.6 + rom * 0.4)
    if vals:
        recovery = round(sum(vals) / len(vals))
    return render_template("dashboard.html", user=user, recovery=recovery)

# ==================================================================
# Settings
# ==================================================================
@app.route("/settings", methods=["GET", "POST"])
@login_required
def settings_page():
    msg = None
    if request.method == "POST":
        action = request.form.get("action", "save")
        if action == "delete":
            db.set_setting("gemini_key", "")
            gemini_chat.configure("")
            msg = "API key deleted"
        else:
            key = request.form.get("gemini_key", "").strip()
            db.set_setting("gemini_key", key)
            gemini_chat.configure(key)
            msg = "API key saved" if key else "API key cleared"
    return render_template("settings.html", msg=msg,
                           has_key=bool(db.get_setting("gemini_key")))

# ==================================================================
# AI Chat
# ==================================================================
_chats = {}
ALLOWED_UPLOAD_EXT = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".webp": "image/webp", ".pdf": "application/pdf",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".ppt": "application/vnd.ms-powerpoint",
    ".txt": "text/plain", ".md": "text/markdown",
}
UPLOAD_DIR = os.path.join(db.DATA_DIR, "uploads")

@app.route("/api/chat", methods=["POST"])
@login_required
@rate_limit(max_requests=30, window=60)
def api_chat():
    try:
        data = request.get_json(silent=True) or {}
        msg = (data.get("message") or "").strip()
        if not msg:
            return jsonify({"reply": "Type a message first."})
        if len(msg) > 2000:
            return jsonify({"reply": "Message too long (max 2000 characters)."})
        cs = _chats.get(session["user_id"])
        if cs is None:
            cs = gemini_chat.ChatSession()
            _chats[session["user_id"]] = cs
        reply = cs.send(msg)
        return jsonify({"reply": reply})
    except Exception as e:
        logger.error(f"Chat API error: {e}")
        return jsonify({"reply": "Sorry, an error occurred."})

@app.route("/api/chat_file", methods=["POST"])
@login_required
def api_chat_file():
    f = request.files.get("file")
    if f is None or not f.filename:
        return jsonify({"reply": "No file received."})
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in ALLOWED_UPLOAD_EXT:
        return jsonify({"reply": f"'{ext}' not supported."})
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    path = os.path.join(UPLOAD_DIR, f"u_{session['user_id']}_{int(time.time())}{ext}")
    f.save(path)
    prompt = request.form.get("prompt", "").strip() or \
        "Identify this file and give rehabilitation guidance. Max ~120 words."
    cs = _chats.get(session["user_id"])
    if cs is None:
        cs = gemini_chat.ChatSession()
        _chats[session["user_id"]] = cs
    reply = cs.analyze_file(path, ALLOWED_UPLOAD_EXT[ext], prompt)
    try:
        os.remove(path)
    except Exception:
        pass
    return jsonify({"reply": reply})

# ==================================================================
# SESSION 3 — Browser-side session pages
# ==================================================================
@app.route("/exercise")
@login_required
def exercise_page():
    exercises = [
        {"key": "fist_clench", "name": "Fist Clench", "cat": "wrist_finger"},
        {"key": "finger_spread", "name": "Finger Spread", "cat": "wrist_finger"},
        {"key": "wrist_flexion", "name": "Wrist Flexion", "cat": "wrist_finger"},
        {"key": "wrist_extension", "name": "Wrist Extension", "cat": "wrist_finger"},
        {"key": "thumb_touch", "name": "Thumb Touch", "cat": "wrist_finger"},
        {"key": "finger_pinch", "name": "Finger Pinch", "cat": "wrist_finger"},
        {"key": "elbow_flexion", "name": "Elbow Flexion", "cat": "elbow_shoulder"},
        {"key": "forward_reach", "name": "Forward Reach", "cat": "elbow_shoulder"},
        {"key": "shoulder_raise", "name": "Shoulder Raise", "cat": "elbow_shoulder"},
        {"key": "shoulder_reach", "name": "Shoulder Reach", "cat": "elbow_shoulder"},
    ]
    return render_template("exercise.html", exercises=exercises)

@app.route("/game")
@login_required
def game_page():
    games = {
        1: {"name": "Star Catch"},
        2: {"name": "Bubble Pop"},
        3: {"name": "Balance Beam"},
        4: {"name": "Track the Dot"},
        5: {"name": "Flappy Reach"},
        6: {"name": "Fist Pop"},
        7: {"name": "Wrist Hammer"},
        8: {"name": "Elbow Crusher"},
        9: {"name": "Pinch Pop"},
    }
    return render_template("game.html", games=games)

@app.route("/drawing")
@login_required
def drawing_page():
    return render_template("drawing.html")

# ==================================================================
# SESSION 4 — Reports
# ==================================================================
@app.route("/report")
@login_required
def report_page():
    user = db.get_user(session["user_id"])
    sessions = db.get_sessions(user["id"])
    rep_logs = {s["id"]: db.get_rep_logs(s["id"]) for s in sessions}
    return render_template("report.html", user=user, sessions=sessions,
                           rep_logs=rep_logs)

@app.route("/report/pdf")
@login_required
def report_pdf():
    user = db.get_user(session["user_id"])
    sessions = db.get_sessions(user["id"])
    rep_logs = {s["id"]: db.get_rep_logs(s["id"]) for s in sessions}
    out = os.path.join(db.DATA_DIR, f"report_{user['patient_id']}.pdf")
    generate_daily_pdf(user, sessions, rep_logs, out)
    return Response(open(out, "rb").read(), mimetype="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename={os.path.basename(out)}"})

# ==================================================================
# API: Save session data FROM BROWSER
# (Browser sends completed session data, server saves to DB)
# ==================================================================
@app.route("/api/save_session", methods=["POST"])
@login_required
def api_save_session():
    """Browser sends session results after completing an exercise/game/drawing.
    Server saves to SQLite for reports."""
    try:
        data = request.get_json(silent=True) or {}
        stype = data.get("type", "exercise")
        exercise = data.get("exercise", "")
        duration = data.get("duration", 0)
        reps = data.get("reps", 0)
        sets = data.get("sets", 0)
        score = data.get("score", 0)
        rep_logs = data.get("rep_logs", [])

        sid = db.save_session(session["user_id"], stype, exercise,
                              duration, reps, sets, score)
        if sid and rep_logs:
            for r in rep_logs:
                db.save_rep_log(sid, r.get("rep", 0), r.get("rom", 0),
                                r.get("smoothness", 0), r.get("speed", 0),
                                r.get("tremor_hz", 0))
        return jsonify({"ok": True, "session_id": sid})
    except Exception as e:
        logger.error(f"Save session error: {e}")
        return jsonify({"ok": False, "error": str(e)})

@app.route("/api/state")
@login_required
def api_state():
    """Return patient's session history for the browser to display."""
    user = db.get_user(session["user_id"])
    sessions = db.get_sessions(user["id"])[:10]
    return jsonify({"sessions": [dict(s) for s in sessions]})

# ==================================================================
# Main
# ==================================================================
if __name__ == "__main__":
    key = db.get_setting("gemini_key") or config.GEMINI_API_KEY
    if key:
        gemini_chat.configure(key)
        logger.info("Gemini AI configured")

    logger.info("=" * 50)
    logger.info("  REHABOPT v2 (Browser-Side)  ->  http://%s:%s", config.HOST, config.PORT)
    logger.info("=" * 50)

    app.run(host=config.HOST, port=config.PORT, debug=config.DEBUG, threaded=True)
