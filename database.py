"""
================================================================
REHABOPT — database.py
SQLite data layer (Session 1 + reports + streaks)

Stores:
  users      -> patient accounts (auto-ID SP-000000001 ...), password, streak
  sessions   -> every completed exercise/game/drawing session (for report cards)
  rep_logs   -> per-rep metrics (for the maths graphs: speed, ROM, smoothness)
  settings   -> app settings (Gemini API key etc.)

Every function is small, commented, and safe to call from Flask routes.
================================================================
"""
import logging
import os
import sqlite3
import threading
import datetime
from contextlib import contextmanager

from werkzeug.security import generate_password_hash, check_password_hash

logger = logging.getLogger("rehabopt.database")

# ---------- paths -----------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "rehab.db")

os.makedirs(DATA_DIR, exist_ok=True)

# ---------- connection pool --------------------------------------------------
_local = threading.local()

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id    TEXT UNIQUE NOT NULL,      -- e.g. SP-000000001
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    last_login    TEXT,                      -- last day the patient logged in
    streak        INTEGER DEFAULT 0          -- consecutive daily logins
);

CREATE TABLE IF NOT EXISTS sessions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    session_type  TEXT NOT NULL,             -- 'exercise' | 'game' | 'drawing'
    exercise      TEXT,                      -- name of exercise/game/shape
    date          TEXT NOT NULL,
    duration_s    REAL DEFAULT 0,
    reps_done     INTEGER DEFAULT 0,
    sets_done     INTEGER DEFAULT 0,
    score         REAL DEFAULT 0,            -- game score / avg similarity
    metrics_json  TEXT DEFAULT '{}',        -- avg ROM, smoothness, tremor, speed
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS rep_logs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    INTEGER NOT NULL,
    rep_no        INTEGER NOT NULL,
    rom           REAL,                      -- peak ROM of the rep (C1)
    smoothness    REAL,                      -- 0-100 smoothness (S1+S2)
    speed         REAL,                      -- avg wrist speed px/s (S1)
    tremor_hz     REAL,                      -- tremor frequency (C4)
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""


# ---------- helpers ---------------------------------------------------------
@contextmanager
def get_db():
    """Context manager for database connections.
    
    Ensures proper connection cleanup and handles errors gracefully.
    Yields a connection with row access by column name.
    """
    conn = None
    try:
        conn = sqlite3.connect(DB_PATH, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")  # Better concurrency
        conn.execute("PRAGMA busy_timeout=5000")  # Wait up to 5s on lock
        yield conn
    except sqlite3.Error as e:
        logger.error(f"Database error: {e}")
        if conn:
            conn.rollback()
        raise
    finally:
        if conn:
            conn.close()


def init_db():
    """Create tables if they don't exist. Called once at server start."""
    try:
        with get_db() as conn:
            conn.executescript(SCHEMA)
            logger.info("Database initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        raise


def next_patient_id():
    """Return the next auto-assigned patient ID (Session 1 rule).

    First patient -> SP-000000001, second -> SP-000000002, ...
    """
    try:
        with get_db() as conn:
            row = conn.execute("SELECT MAX(id) AS m FROM users").fetchone()
            n = 1 if row["m"] is None else row["m"] + 1
            return f"SP-{n:09d}"
    except Exception as e:
        logger.error(f"Get next patient ID error: {e}")
        return "SP-000000001"


# ---------- users (Session 1: register / login) -------------------------------
def register_user(email, password):
    """Register a new patient. Returns (ok, message, patient_id)."""
    email = (email or "").strip().lower()
    if "@" not in email or not email.endswith((".com", ".in", ".org", ".net")):
        return False, "Enter a valid email like name@gmail.com", None
    if not password or len(password) < 4:
        return False, "Password must be at least 4 characters", None

    try:
        with get_db() as conn:
            if conn.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone():
                return False, "This email is already registered — login instead", None

            patient_id = next_patient_id()
            conn.execute(
                "INSERT INTO users (patient_id, email, password_hash, created_at) VALUES (?,?,?,?)",
                (patient_id, email, generate_password_hash(password),
                 datetime.date.today().isoformat()),
            )
            conn.commit()
            logger.info(f"New user registered: {patient_id}")
            return True, f"Registered! Your ID is {patient_id}", patient_id
    except Exception as e:
        logger.error(f"Registration error: {e}")
        return False, "Registration failed. Please try again.", None


def login_user(patient_id, password):
    """Check login. Updates the daily-login streak on success.
    Returns (ok, message, user_row)."""
    patient_id = (patient_id or "").strip().lower()
    
    try:
        with get_db() as conn:
            user = conn.execute(
                "SELECT * FROM users WHERE lower(patient_id)=?", (patient_id,)
            ).fetchone()
            if user is None:
                return False, "Patient ID not found — register first", None
            if not check_password_hash(user["password_hash"], password or ""):
                return False, "Wrong password — try again", None

            # ---- daily streak (Session 2 feature) ----
            today = datetime.date.today().isoformat()
            if user["last_login"] == today:
                pass  # already logged in today -> streak unchanged
            else:
                yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
                streak = user["streak"] + 1 if user["last_login"] == yesterday else 1
                conn.execute(
                    "UPDATE users SET last_login=?, streak=? WHERE id=?",
                    (today, streak, user["id"]),
                )
                conn.commit()
                user = conn.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
            return True, "Welcome back!", user
    except Exception as e:
        logger.error(f"Login error: {e}")
        return False, "Login failed. Please try again.", None


def get_user(user_id):
    """Get user by ID. Returns user dict or None."""
    try:
        with get_db() as conn:
            return conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    except Exception as e:
        logger.error(f"Get user error: {e}")
        return None


# ---------- sessions + rep logs (report cards, Session 4) ---------------------
def save_session(user_id, session_type, exercise, duration_s, reps_done,
                 sets_done, score, metrics_json=None):
    """Save one finished session. Returns the new session id."""
    try:
        with get_db() as conn:
            cur = conn.execute(
                """INSERT INTO sessions (user_id, session_type, exercise, date, duration_s,
                                         reps_done, sets_done, score, metrics_json)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (user_id, session_type, exercise, datetime.datetime.now().isoformat(timespec="seconds"),
                 duration_s, reps_done, sets_done, score, metrics_json or "{}"),
            )
            conn.commit()
            logger.info(f"Session saved: user={user_id}, type={session_type}")
            return cur.lastrowid
    except Exception as e:
        logger.error(f"Save session error: {e}")
        return None


def save_rep_log(session_id, rep_no, rom, smoothness, speed, tremor_hz):
    """Save rep log for a session."""
    try:
        with get_db() as conn:
            conn.execute(
                "INSERT INTO rep_logs (session_id, rep_no, rom, smoothness, speed, tremor_hz) VALUES (?,?,?,?,?,?)",
                (session_id, rep_no, rom, smoothness, speed, tremor_hz),
            )
            conn.commit()
    except Exception as e:
        logger.error(f"Save rep log error: {e}")


def get_sessions(user_id, limit=200):
    """All sessions of one patient (newest first) — for the report card."""
    try:
        with get_db() as conn:
            return conn.execute(
                "SELECT * FROM sessions WHERE user_id=? ORDER BY id DESC LIMIT ?",
                (user_id, limit),
            ).fetchall()
    except Exception as e:
        logger.error(f"Get sessions error: {e}")
        return []


def get_rep_logs(session_id):
    """Get rep logs for a session."""
    try:
        with get_db() as conn:
            return conn.execute(
                "SELECT * FROM rep_logs WHERE session_id=? ORDER BY rep_no", (session_id,)
            ).fetchall()
    except Exception as e:
        logger.error(f"Get rep logs error: {e}")
        return []


# ---------- settings (Gemini API key etc.) -----------------------------------
def get_setting(key, default=""):
    """Get a setting value by key."""
    try:
        with get_db() as conn:
            row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
            return row["value"] if row else default
    except Exception as e:
        logger.error(f"Get setting error: {e}")
        return default


def set_setting(key, value):
    """Set a setting value."""
    try:
        with get_db() as conn:
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, value),
            )
            conn.commit()
    except Exception as e:
        logger.error(f"Set setting error: {e}")
