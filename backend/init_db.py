"""
init_db.py — EmotionAI database initialiser
Run once (or re-run safely — all CREATE TABLE statements use IF NOT EXISTS).

Usage:
    python init_db.py

Reads DATABASE_URL from .env (defaults to SQLite: emotionai.db).
Set DATABASE_URL=postgresql://user:pass@host/db for Postgres.
"""

import os
import re as _re
from dotenv import load_dotenv
from passlib.context import CryptContext

load_dotenv()

DATABASE_URL:   str = os.getenv("DATABASE_URL",   "sqlite:///emotionai.db")
ADMIN_USERNAME: str = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD: str = os.getenv("ADMIN_PASSWORD", "Admin@1234")
ADMIN_EMAIL:    str = os.getenv("ADMIN_EMAIL",    "admin@emotionai.local").strip().lower()

_pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

def _hash(pw: str) -> str:
    return _pwd_ctx.hash(pw)

IS_SQLITE   = DATABASE_URL.startswith("sqlite")
IS_POSTGRES = DATABASE_URL.startswith("postgresql") or DATABASE_URL.startswith("postgres")

print(f"[init_db] Connecting to: {DATABASE_URL}")

if IS_SQLITE:
    import sqlite3, re
    _db_path = re.sub(r"^sqlite:///", "", DATABASE_URL)

    con = sqlite3.connect(_db_path)
    cur = con.cursor()
    cur.executescript("""
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- 1. users
CREATE TABLE IF NOT EXISTS users (
    id                INTEGER  PRIMARY KEY AUTOINCREMENT,
    username          TEXT     NOT NULL UNIQUE,
    email             TEXT     NOT NULL UNIQUE,
    password_hash     TEXT     NOT NULL,
    is_admin          INTEGER  NOT NULL DEFAULT 0,
    created_at        TEXT     NOT NULL DEFAULT (datetime('now')),
    last_login        TEXT,
    security_q1       TEXT,
    security_a1       TEXT,
    security_q2       TEXT,
    security_a2       TEXT,
    password_reset_hash TEXT
);

-- 2. detections
CREATE TABLE IF NOT EXISTS detections (
    id            INTEGER  PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER  REFERENCES users(id) ON DELETE SET NULL,
    emotion       TEXT     NOT NULL,
    confidence    REAL     NOT NULL,
    engagement    REAL     NOT NULL,
    source        TEXT     NOT NULL DEFAULT 'webcam',
    all_probs     TEXT,
    created_at    TEXT     NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_detections_user    ON detections(user_id);
CREATE INDEX IF NOT EXISTS idx_detections_created ON detections(created_at);

-- 3. feedback
CREATE TABLE IF NOT EXISTS feedback (
    id            INTEGER  PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER  REFERENCES users(id) ON DELETE SET NULL,
    username      TEXT     NOT NULL DEFAULT 'Guest',
    email         TEXT,
    rating        INTEGER,
    category      TEXT     NOT NULL DEFAULT 'General',
    message       TEXT     NOT NULL,
    created_at    TEXT     NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_user    ON feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at);

-- 4. session_timeline
CREATE TABLE IF NOT EXISTS session_timeline (
    id                INTEGER  PRIMARY KEY AUTOINCREMENT,
    session_id        TEXT     NOT NULL,
    user_id           INTEGER  REFERENCES users(id) ON DELETE SET NULL,
    source            TEXT     NOT NULL DEFAULT 'webcam',
    time_offset       REAL     NOT NULL DEFAULT 0.0,
    emotion           TEXT     NOT NULL,
    engagement        REAL     NOT NULL,
    average_engagement REAL,
    dominant_emotion  TEXT,
    frame_count       INTEGER  NOT NULL DEFAULT 1,
    started_at        TEXT     NOT NULL DEFAULT (datetime('now')),
    ended_at          TEXT
);

CREATE INDEX IF NOT EXISTS idx_stl_session ON session_timeline(session_id);
CREATE INDEX IF NOT EXISTS idx_stl_user    ON session_timeline(user_id);
CREATE INDEX IF NOT EXISTS idx_stl_started ON session_timeline(started_at);

-- 5. password_reset_log
CREATE TABLE IF NOT EXISTS password_reset_log (
    id           INTEGER  PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER  REFERENCES users(id) ON DELETE SET NULL,
    email        TEXT     NOT NULL,
    security_q1  TEXT,
    security_q2  TEXT,
    step1_at     TEXT,
    step2_at     TEXT,
    step2_passed INTEGER  NOT NULL DEFAULT 0,
    step3_at     TEXT,
    completed    INTEGER  NOT NULL DEFAULT 0,
    ip_address   TEXT
);

CREATE INDEX IF NOT EXISTS idx_prl_user   ON password_reset_log(user_id);
CREATE INDEX IF NOT EXISTS idx_prl_step1  ON password_reset_log(step1_at);

-- 6. faq_feedback
CREATE TABLE IF NOT EXISTS faq_feedback (
    id            INTEGER  PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER  REFERENCES users(id) ON DELETE SET NULL,
    username      TEXT     NOT NULL DEFAULT 'Guest',
    faq_question  TEXT     NOT NULL,
    vote          TEXT     NOT NULL CHECK(vote IN ('liked','disliked')),
    complaint     TEXT,
    created_at    TEXT     NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_faqfb_vote    ON faq_feedback(vote);
CREATE INDEX IF NOT EXISTS idx_faqfb_created ON faq_feedback(created_at);
    """)
    # ── Migrate existing tables (add columns introduced after initial deploy) ──
    sqlite_migrations = [
        "ALTER TABLE feedback ADD COLUMN username  TEXT NOT NULL DEFAULT 'Guest'",
        "ALTER TABLE feedback ADD COLUMN email     TEXT",
        "ALTER TABLE feedback ADD COLUMN rating    INTEGER",
        "ALTER TABLE feedback ADD COLUMN category  TEXT NOT NULL DEFAULT 'General'",
        # Security question columns + reset timestamp on users
        "ALTER TABLE users ADD COLUMN security_q1       TEXT",
        "ALTER TABLE users ADD COLUMN security_a1       TEXT",
        "ALTER TABLE users ADD COLUMN security_q2       TEXT",
        "ALTER TABLE users ADD COLUMN security_a2       TEXT",
        "ALTER TABLE users ADD COLUMN password_reset_hash TEXT",
        # Username column on faq_feedback (for guest/logged-in display)
        "ALTER TABLE faq_feedback ADD COLUMN username TEXT NOT NULL DEFAULT 'Guest'",
    ]
    for _sql in sqlite_migrations:
        try:
            cur.execute(_sql)
        except Exception:
            pass  # column already exists — safe to ignore
    con.commit()

    # ── Sync admin account ────────────────────────────────────────────────────
    con2 = sqlite3.connect(_db_path)
    con2.row_factory = sqlite3.Row
    cur2 = con2.cursor()
    cur2.execute(
        "SELECT id FROM users WHERE is_admin=1 AND (username=? OR LOWER(email)=?) LIMIT 1",
        (ADMIN_USERNAME, ADMIN_EMAIL)
    )
    existing = cur2.fetchone()
    pw_hash = _hash(ADMIN_PASSWORD)
    if not existing:
        cur2.execute(
            "INSERT INTO users (username, email, password_hash, is_admin) VALUES (?,?,?,1)",
            (ADMIN_USERNAME, ADMIN_EMAIL, pw_hash)
        )
        print(f"[init_db] Admin created  ->  email: {ADMIN_EMAIL}")
    else:
        cur2.execute(
            "UPDATE users SET password_hash=?, email=? WHERE id=?",
            (pw_hash, ADMIN_EMAIL, existing["id"])
        )
        print(f"[init_db] Admin synced   ->  email: {ADMIN_EMAIL}")
    con2.commit()
    con2.close()

    con.close()
    print("[init_db] SQLite tables created/verified:", _db_path)

elif IS_POSTGRES:
    import psycopg2

    con = psycopg2.connect(DATABASE_URL)
    con.autocommit = False
    cur = con.cursor()

    ddl = """
-- 1. users
CREATE TABLE IF NOT EXISTS users (
    id                BIGSERIAL    PRIMARY KEY,
    username          VARCHAR(80)  NOT NULL UNIQUE,
    email             VARCHAR(254) NOT NULL UNIQUE,
    password_hash     TEXT         NOT NULL,
    is_admin          BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_login        TIMESTAMPTZ,
    security_q1       TEXT,
    security_a1       TEXT,
    security_q2       TEXT,
    security_a2       TEXT,
    password_reset_hash TEXT
);

-- 2. detections
CREATE TABLE IF NOT EXISTS detections (
    id         BIGSERIAL    PRIMARY KEY,
    user_id    BIGINT       REFERENCES users(id) ON DELETE SET NULL,
    emotion    VARCHAR(40)  NOT NULL,
    confidence REAL         NOT NULL,
    engagement REAL         NOT NULL,
    source     VARCHAR(20)  NOT NULL DEFAULT 'webcam',
    all_probs  JSONB,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_detections_user    ON detections(user_id);
CREATE INDEX IF NOT EXISTS idx_detections_created ON detections(created_at);

-- 3. feedback
CREATE TABLE IF NOT EXISTS feedback (
    id         BIGSERIAL    PRIMARY KEY,
    user_id    BIGINT       REFERENCES users(id) ON DELETE SET NULL,
    username   VARCHAR(80)  NOT NULL DEFAULT 'Guest',
    email      VARCHAR(254),
    rating     SMALLINT     CHECK (rating BETWEEN 1 AND 5),
    category   VARCHAR(60)  NOT NULL DEFAULT 'General',
    message    TEXT         NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_user    ON feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at);

-- 4. session_timeline
CREATE TABLE IF NOT EXISTS session_timeline (
    id                 BIGSERIAL   PRIMARY KEY,
    session_id         TEXT        NOT NULL,
    user_id            BIGINT      REFERENCES users(id) ON DELETE SET NULL,
    source             VARCHAR(20) NOT NULL DEFAULT 'webcam',
    time_offset        REAL        NOT NULL DEFAULT 0.0,
    emotion            VARCHAR(40) NOT NULL,
    engagement         REAL        NOT NULL,
    average_engagement REAL,
    dominant_emotion   VARCHAR(40),
    frame_count        INTEGER     NOT NULL DEFAULT 1,
    started_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_stl_session ON session_timeline(session_id);
CREATE INDEX IF NOT EXISTS idx_stl_user    ON session_timeline(user_id);
CREATE INDEX IF NOT EXISTS idx_stl_started ON session_timeline(started_at);

-- 5. password_reset_log
CREATE TABLE IF NOT EXISTS password_reset_log (
    id           BIGSERIAL    PRIMARY KEY,
    user_id      BIGINT       REFERENCES users(id) ON DELETE SET NULL,
    email        VARCHAR(254) NOT NULL,
    security_q1  TEXT,
    security_q2  TEXT,
    step1_at     TIMESTAMPTZ,
    step2_at     TIMESTAMPTZ,
    step2_passed BOOLEAN      NOT NULL DEFAULT FALSE,
    step3_at     TIMESTAMPTZ,
    completed    BOOLEAN      NOT NULL DEFAULT FALSE,
    ip_address   TEXT
);

CREATE INDEX IF NOT EXISTS idx_prl_user  ON password_reset_log(user_id);
CREATE INDEX IF NOT EXISTS idx_prl_step1 ON password_reset_log(step1_at);

-- 6. faq_feedback
CREATE TABLE IF NOT EXISTS faq_feedback (
    id            BIGSERIAL    PRIMARY KEY,
    user_id       BIGINT       REFERENCES users(id) ON DELETE SET NULL,
    username      VARCHAR(80)  NOT NULL DEFAULT 'Guest',
    faq_question  TEXT         NOT NULL,
    vote          VARCHAR(10)  NOT NULL CHECK(vote IN ('liked','disliked')),
    complaint     TEXT,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_faqfb_vote    ON faq_feedback(vote);
CREATE INDEX IF NOT EXISTS idx_faqfb_created ON faq_feedback(created_at);
    """

    cur.execute(ddl)
    con.commit()

    # ── Migrate existing tables (add columns introduced after initial deploy) ──
    pg_migrations = [
        "ALTER TABLE feedback ADD COLUMN IF NOT EXISTS username  VARCHAR(80)  NOT NULL DEFAULT 'Guest'",
        "ALTER TABLE feedback ADD COLUMN IF NOT EXISTS email     VARCHAR(254)",
        "ALTER TABLE feedback ADD COLUMN IF NOT EXISTS rating    SMALLINT",
        "ALTER TABLE feedback ADD COLUMN IF NOT EXISTS category  VARCHAR(60)  NOT NULL DEFAULT 'General'",
        # Security question columns on users (added for password reset flow)
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS security_q1 TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS security_a1 TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS security_q2 TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS security_a2 TEXT",
        # Tracks when password was last reset (NULL = never reset, only registered)
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_hash TEXT",
        # Username column on faq_feedback (for guest/logged-in display)
        "ALTER TABLE faq_feedback ADD COLUMN IF NOT EXISTS username VARCHAR(80) NOT NULL DEFAULT 'Guest'",
    ]
    for _sql in pg_migrations:
        try:
            cur.execute(_sql)
            con.commit()
        except Exception as _e:
            con.rollback()
            print(f"[init_db] migration skipped (already applied): {_e}")

    # ── Sync admin account ────────────────────────────────────────────────────
    cur.execute(
        "SELECT id FROM users WHERE is_admin=TRUE AND (username=%s OR LOWER(email)=%s) LIMIT 1",
        (ADMIN_USERNAME, ADMIN_EMAIL)
    )
    existing = cur.fetchone()
    pw_hash = _hash(ADMIN_PASSWORD)
    if not existing:
        cur.execute(
            "INSERT INTO users (username, email, password_hash, is_admin) VALUES (%s,%s,%s,TRUE)",
            (ADMIN_USERNAME, ADMIN_EMAIL, pw_hash)
        )
        print(f"[init_db] Admin created  ->  email: {ADMIN_EMAIL}")
    else:
        cur.execute(
            "UPDATE users SET password_hash=%s, email=%s WHERE id=%s",
            (pw_hash, ADMIN_EMAIL, existing[0])
        )
        print(f"[init_db] Admin synced   ->  email: {ADMIN_EMAIL}")
    con.commit()

    cur.close()
    con.close()
    print("[init_db] Postgres tables created/verified.")

else:
    raise ValueError(f"Unsupported DATABASE_URL scheme: {DATABASE_URL}")

print("[init_db] Done — all 6 tables ready: users, detections, feedback, session_timeline, password_reset_log, faq_feedback")