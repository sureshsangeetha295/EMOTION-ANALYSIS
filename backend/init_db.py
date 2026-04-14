"""
init_db.py — EmotionAI database initialiser (PostgreSQL only)
Run once (or re-run safely — all CREATE TABLE statements use IF NOT EXISTS).

Usage:
    python init_db.py

Reads DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD from .env.
"""

import os
from dotenv import load_dotenv
from passlib.context import CryptContext
import psycopg2

load_dotenv()

ADMIN_USERNAME: str = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD: str = os.getenv("ADMIN_PASSWORD", "Admin@1234")
ADMIN_EMAIL:    str = os.getenv("ADMIN_EMAIL",    "admin@emotionai.local").strip().lower()

DB_DSN = {
    "host":     os.getenv("DB_HOST",     "localhost"),
    "port":     int(os.getenv("DB_PORT", "5432")),
    "dbname":   os.getenv("DB_NAME",     "emotionai"),
    "user":     os.getenv("DB_USER",     "postgres"),
    "password": os.getenv("DB_PASSWORD", ""),
}

_pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

def _hash(pw: str) -> str:
    return _pwd_ctx.hash(pw)


print(f"[init_db] Connecting to PostgreSQL: {DB_DSN['host']}:{DB_DSN['port']}/{DB_DSN['dbname']}")

con = psycopg2.connect(**DB_DSN)
con.autocommit = False
cur = con.cursor()

ddl = """
-- 1. users
CREATE TABLE IF NOT EXISTS users (
    id                  BIGSERIAL    PRIMARY KEY,
    username            VARCHAR(80)  NOT NULL UNIQUE,
    email               VARCHAR(254) NOT NULL UNIQUE,
    password_hash       TEXT         NOT NULL,
    is_admin            BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_login          TIMESTAMPTZ,
    security_q1         TEXT,
    security_a1         TEXT,
    security_q2         TEXT,
    security_a2         TEXT,
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

# Migrate existing tables
pg_migrations = [
    "ALTER TABLE feedback ADD COLUMN IF NOT EXISTS username  VARCHAR(80)  NOT NULL DEFAULT 'Guest'",
    "ALTER TABLE feedback ADD COLUMN IF NOT EXISTS email     VARCHAR(254)",
    "ALTER TABLE feedback ADD COLUMN IF NOT EXISTS rating    SMALLINT",
    "ALTER TABLE feedback ADD COLUMN IF NOT EXISTS category  VARCHAR(60)  NOT NULL DEFAULT 'General'",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS security_q1         TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS security_a1         TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS security_q2         TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS security_a2         TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_hash TEXT",
    "ALTER TABLE faq_feedback ADD COLUMN IF NOT EXISTS username VARCHAR(80) NOT NULL DEFAULT 'Guest'",
]
for _sql in pg_migrations:
    try:
        cur.execute(_sql)
        con.commit()
    except Exception as _e:
        con.rollback()
        print(f"[init_db] migration skipped (already applied): {_e}")

# Sync admin account
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

print("[init_db] Done — all 6 tables ready: users, detections, feedback, session_timeline, password_reset_log, faq_feedback")