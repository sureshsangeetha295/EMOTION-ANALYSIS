# =============================================================================
#  mock_db_migration.py  —  Add mock_sessions table
#  Run once:  python mock_db_migration.py
# =============================================================================

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv()

import psycopg2

DB_DSN = {
    "host":     os.getenv("DB_HOST",     "localhost"),
    "port":     int(os.getenv("DB_PORT", "5432")),
    "dbname":   os.getenv("DB_NAME",     "Emotion_Analysis"),
    "user":     os.getenv("DB_USER",     "postgres"),
    "password": os.getenv("DB_PASSWORD", ""),
}


def run_migration():
    con = psycopg2.connect(**DB_DSN)
    cur = con.cursor()

    print("[Migration] Creating mock_sessions table …")
    cur.execute("""
        CREATE TABLE IF NOT EXISTS mock_sessions (
            id                BIGSERIAL    PRIMARY KEY,
            session_id        TEXT         NOT NULL UNIQUE,
            user_id           BIGINT,
            mode              VARCHAR(30)  NOT NULL DEFAULT 'presentation',
            topic             TEXT,
            transcript        TEXT,
            duration_s        REAL         DEFAULT 0,

            -- Voice metrics (Librosa)
            speaking_rate_wpm REAL         DEFAULT 0,
            pitch_mean_hz     REAL         DEFAULT 0,
            pitch_std_hz      REAL         DEFAULT 0,
            energy_mean       REAL         DEFAULT 0,
            silence_ratio     REAL         DEFAULT 0,
            pause_count       INT          DEFAULT 0,
            avg_pause_s       REAL         DEFAULT 0,

            -- Voice scores (0-100)
            score_pace        INT          DEFAULT 0,
            score_pitch       INT          DEFAULT 0,
            score_volume      INT          DEFAULT 0,
            score_pauses      INT          DEFAULT 0,
            score_clarity     INT          DEFAULT 0,

            -- Emotion (from facial model)
            engagement_pct    INT          DEFAULT 0,
            dominant_emotion  VARCHAR(30)  DEFAULT 'Neutral',
            positive_pct      INT          DEFAULT 0,
            neutral_pct       INT          DEFAULT 0,
            negative_pct      INT          DEFAULT 0,

            -- LLM outputs
            overall_score     INT          DEFAULT 0,
            dimension_scores  JSONB,
            feedback          JSONB,
            strengths         JSONB,
            tips              JSONB,
            coach_summary     TEXT,
            overall_verdict   TEXT,
            report_html       TEXT,

            created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
    """)

    cur.execute("CREATE INDEX IF NOT EXISTS idx_mock_user ON mock_sessions(user_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_mock_mode ON mock_sessions(mode)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_mock_created ON mock_sessions(created_at)")

    con.commit()
    cur.close()
    con.close()
    print("[Migration] ✅ mock_sessions table ready.")


if __name__ == "__main__":
    run_migration()