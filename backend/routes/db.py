from __future__ import annotations
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from contextlib import asynccontextmanager  # noqa: F401
    from routes.config import ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_USERNAME  # noqa: F401
    from routes.auth_helpers import db_conn, hash_password  # noqa: F401


def init_db():
    """Create all tables and sync admin account from .env."""
    con = db_conn(); cur = con.cursor()

    cur.execute("""
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
        )
    """)
    for _col_sql in [
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS security_q1         TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS security_a1         TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS security_q2         TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS security_a2         TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_hash TEXT",
    ]:
        try:
            cur.execute(_col_sql); con.commit()
        except Exception as _e:
            con.rollback(); print(f"[EmotionAI] users migration skipped: {_e}")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS detections (
            id         BIGSERIAL    PRIMARY KEY,
            user_id    BIGINT       REFERENCES users(id) ON DELETE SET NULL,
            emotion    VARCHAR(40)  NOT NULL,
            confidence REAL         NOT NULL,
            engagement REAL         NOT NULL,
            source     VARCHAR(20)  NOT NULL DEFAULT 'webcam',
            all_probs  TEXT,
            created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_det_user    ON detections(user_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_det_created ON detections(created_at)")

    cur.execute("""
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
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_stl_session ON session_timeline(session_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_stl_user    ON session_timeline(user_id)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS feedback (
            id         BIGSERIAL    PRIMARY KEY,
            user_id    BIGINT       REFERENCES users(id) ON DELETE SET NULL,
            username   VARCHAR(80)  NOT NULL DEFAULT 'Guest',
            email      VARCHAR(254),
            rating     SMALLINT     CHECK (rating BETWEEN 1 AND 5),
            category   VARCHAR(60)  NOT NULL DEFAULT 'General',
            message    TEXT         NOT NULL,
            created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
    """)
    for _sql in [
        "ALTER TABLE feedback ADD COLUMN IF NOT EXISTS username  VARCHAR(80)  NOT NULL DEFAULT 'Guest'",
        "ALTER TABLE feedback ADD COLUMN IF NOT EXISTS email     VARCHAR(254)",
        "ALTER TABLE feedback ADD COLUMN IF NOT EXISTS rating    SMALLINT",
        "ALTER TABLE feedback ADD COLUMN IF NOT EXISTS category  VARCHAR(60)  NOT NULL DEFAULT 'General'",
    ]:
        try:
            cur.execute(_sql); con.commit()
        except Exception as _e:
            con.rollback(); print(f"[EmotionAI] feedback migration skipped: {_e}")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_fb_user    ON feedback(user_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_fb_created ON feedback(created_at)")

    cur.execute("""
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
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_prl_user  ON password_reset_log(user_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_prl_step1 ON password_reset_log(step1_at)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS faq_feedback (
            id            BIGSERIAL    PRIMARY KEY,
            user_id       BIGINT       REFERENCES users(id) ON DELETE SET NULL,
            faq_question  TEXT         NOT NULL,
            vote          VARCHAR(10)  NOT NULL CHECK(vote IN ('liked','disliked')),
            complaint     TEXT,
            created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_faqfb_vote    ON faq_feedback(vote)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_faqfb_created ON faq_feedback(created_at)")
    con.commit()

    admin_email_clean = ADMIN_EMAIL.strip().lower()
    cur.execute(
        "SELECT id FROM users WHERE is_admin=TRUE AND (username=%s OR LOWER(email)=%s) LIMIT 1",
        (ADMIN_USERNAME, admin_email_clean)
    )
    existing_admin = cur.fetchone()
    if not existing_admin:
        cur.execute(
            "INSERT INTO users (username, email, password_hash, is_admin) VALUES (%s,%s,%s,TRUE)",
            (ADMIN_USERNAME, admin_email_clean, hash_password(ADMIN_PASSWORD))
        )
        print(f"[EmotionAI] Default admin created -> email: {admin_email_clean}")
        print("[EmotionAI] Please change the admin password after first login!")
    else:
        cur.execute(
            "UPDATE users SET password_hash=%s, email=%s WHERE id=%s",
            (hash_password(ADMIN_PASSWORD), admin_email_clean, existing_admin[0])
        )
        print(f"[EmotionAI] Admin credentials synced -> email: {admin_email_clean}")

    con.commit(); cur.close(); con.close()
    print("[EmotionAI] Database initialised")


# =============================================================================
#  LIFESPAN  (decorator only — function body continues in main.py / app_setup.py)
# =============================================================================