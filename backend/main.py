import os
os.environ["TF_USE_LEGACY_KERAS"]  = "1"
os.environ["CUDA_VISIBLE_DEVICES"] = "-1"
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"

import io
import json
import uuid
import re
import asyncio
import psycopg2
import psycopg2.extras
import webbrowser
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Optional

import numpy as np
import uvicorn
import requests
from fastapi import FastAPI, UploadFile, File, Query, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from PIL import Image
from dotenv import load_dotenv
from passlib.context import CryptContext
from jose import JWTError, jwt


# =============================================================================
#  ENV
# =============================================================================

_ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")

print(f"[EmotionAI] Looking for .env at: {_ENV_PATH}")
if not os.path.exists(_ENV_PATH):
    print("[EmotionAI] ERROR: .env file NOT FOUND at that path.")
else:
    print("[EmotionAI] .env file found. Checking for common formatting issues...")
    try:
        raw_lines = open(_ENV_PATH, encoding="utf-8-sig").readlines()
    except UnicodeDecodeError:
        raw_lines = open(_ENV_PATH, encoding="latin-1").readlines()
    for i, line in enumerate(raw_lines, 1):
        stripped = line.rstrip("\r\n")
        if stripped and not stripped.startswith("#"):
            if "=" not in stripped:
                print(f"[EmotionAI]   Line {i}: MISSING '=' -> {stripped!r}")
            elif stripped.startswith(" ") or stripped.startswith("\t"):
                print(f"[EmotionAI]   Line {i}: LEADING WHITESPACE -> {stripped!r}")
            else:
                key = stripped.split("=", 1)[0].strip()
                val = stripped.split("=", 1)[1].strip() if "=" in stripped else ""
                masked = val[:6] + "..." if len(val) > 6 else ("(empty)" if not val else val)
                print(f"[EmotionAI]   Line {i}: {key} = {masked}")

load_dotenv(dotenv_path=_ENV_PATH, override=True)

_GROQ_KEY = os.getenv("GROQ_API_KEY", "").strip()
if not _GROQ_KEY:
    print(
        "\n[EmotionAI] WARNING: GROQ_API_KEY is not set.\n"
        f"  Looked for .env at: {_ENV_PATH}\n"
        "  Add  GROQ_API_KEY=gsk_...  to that file and restart.\n"
        "  Common causes:\n"
        "    - The .env file has Windows BOM encoding (save as UTF-8 without BOM)\n"
        "    - Value has quotes: GROQ_API_KEY=\"gsk_...\" -> remove the quotes\n"
        "    - Extra spaces:    GROQ_API_KEY = gsk_...  -> use GROQ_API_KEY=gsk_...\n"
        "    - Wrong filename:  .env.txt instead of .env\n"
    )

_DB_PASS = os.getenv("DB_PASSWORD", "")
if not _DB_PASS:
    print(
        "\n[EmotionAI] WARNING: DB_PASSWORD is not set.\n"
        "  Add  DB_PASSWORD=your_postgres_password  to your .env file.\n"
    )

APP_HOST     = os.getenv("APP_HOST", "0.0.0.0")
APP_PORT     = int(os.getenv("APP_PORT", "8000"))
SECRET_KEY   = os.getenv("SECRET_KEY", "change-me-in-production-use-a-long-random-string")
ALGORITHM    = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
REFRESH_TOKEN_EXPIRE_DAYS   = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS",   "30"))

ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "Admin@1234")
ADMIN_EMAIL    = os.getenv("ADMIN_EMAIL",    "admin@emotionai.local")

DB_DSN = {
    "host":     os.getenv("DB_HOST",     "localhost"),
    "port":     int(os.getenv("DB_PORT", "5432")),
    "dbname":   os.getenv("DB_NAME",     "emotionai"),
    "user":     os.getenv("DB_USER",     "postgres"),
    "password": os.getenv("DB_PASSWORD", ""),
}


# =============================================================================
#  ML CONFIG  —  Engagement weights, EMA tracker, tone aggregation
# =============================================================================

EMOTION_LABELS = ["Anger", "Disgust", "Fear", "Happiness", "Neutral", "Sadness", "Surprise"]

# ── Research-grounded 3-tier engagement weights ──────────────────────────────
#
#  Tier 1  HIGH POSITIVE  (active learning state)
#    Happiness  0.85  active enjoyment, fully receptive — strongest engagement signal
#    Surprise   0.70  attention spike / curiosity / "aha" moment — but short-lived
#
#  Tier 2  NEUTRAL BASELINE  (stable passive attention)
#    Neutral    0.55  steady focus, low emotional activation — reliable baseline
#
#  Tier 3  NEGATIVE  (engagement declining or at risk)
#    Fear       0.35  anxious focus — learner is stressed; present but fragile
#    Sadness    0.20  withdrawal beginning — low motivation
#    Anger      0.15  frustration/confusion — content is NOT landing
#    Disgust    0.05  strong aversion — strongest disengagement signal
#
#  Design notes:
#    • Gap between Neutral (0.55) and Fear (0.35) is intentionally large —
#      crossing into negative emotions is a qualitative shift, not a small step.
#    • Disgust sits alone at 0.05 (not 0.10) because it signals active rejection.
#    • Surprise < Happiness because attention spikes are fleeting; sustained
#      happiness is a better learning predictor.

ENGAGEMENT_SCORES: dict[str, float] = {
    "Happiness": 0.85,
    "Surprise":  0.70,
    "Neutral":   0.55,
    "Fear":      0.35,
    "Sadness":   0.20,
    "Anger":     0.15,
    "Disgust":   0.05,
}

# Tone for positive / neutral / negative aggregation
EMOTION_TONE: dict[str, str] = {
    "Happiness": "positive",
    "Surprise":  "positive",
    "Neutral":   "neutral",
    "Fear":      "negative",
    "Sadness":   "negative",
    "Anger":     "negative",
    "Disgust":   "negative",
}

# EMA alpha: 0.20 = ~5 frames to "forget" old data.
# Increase toward 0.35 for faster reaction; lower to 0.10 for smoother curve.
EMA_ALPHA = 0.20


def emotion_to_engagement(emotion: str) -> float:
    """Return the base engagement weight for a given emotion label."""
    return ENGAGEMENT_SCORES.get(emotion, 0.50)


class SessionEngagementTracker:
    """
    Per-session engagement tracker using Exponential Moving Average (EMA).

    Three parallel scores are tracked:

    1. EMA engagement  (primary output)
       ------------------------------------------
       EMA_0 = w(e_0)
       EMA_t = alpha * w(e_t) + (1 - alpha) * EMA_{t-1}

       Recent frames count more than older frames.
       A learner who ends a session engaged will score HIGHER than one who was
       engaged only at the start — which is pedagogically correct.

    2. Confidence-weighted average  (secondary)
       ------------------------------------------
       score = SUM(w(e_i) * conf_i) / SUM(conf_i)

       A Happiness detection at 95% confidence contributes more than the same
       emotion detected at 52% confidence.

    3. Tone breakdown  (tertiary)
       ------------------------------------------
       % of frames classified as positive / neutral / negative.
       Passed to the LLM prompt for richer emotional context.
    """

    def __init__(self, alpha: float = EMA_ALPHA):
        self.alpha        = alpha
        self.ema          = None       # None until first frame
        self.conf_sum     = 0.0
        self.weighted_sum = 0.0
        self.frame_count  = 0
        self.tone_counts  = {"positive": 0, "negative": 0, "neutral": 0}

    def update(self, emotion: str, confidence: float = 1.0) -> float:
        """Feed one detection frame. Returns updated EMA score (0.0-1.0)."""
        score = emotion_to_engagement(emotion)
        conf  = max(0.0, min(1.0, float(confidence)))

        # EMA update
        if self.ema is None:
            self.ema = score
        else:
            self.ema = self.alpha * score + (1.0 - self.alpha) * self.ema

        # Confidence-weighted accumulator
        self.weighted_sum += score * conf
        self.conf_sum     += conf
        self.frame_count  += 1

        # Tone bucket
        tone = EMOTION_TONE.get(emotion, "neutral")
        self.tone_counts[tone] += 1

        return round(self.ema, 4)

    @property
    def confidence_weighted_score(self) -> float:
        if self.conf_sum == 0:
            return 0.0
        return round(self.weighted_sum / self.conf_sum, 4)

    @property
    def tone_percentages(self) -> dict:
        total = max(1, self.frame_count)
        return {
            "positive": round(self.tone_counts["positive"] / total * 100),
            "neutral":  round(self.tone_counts["neutral"]  / total * 100),
            "negative": round(self.tone_counts["negative"] / total * 100),
        }

    def summary(self) -> dict:
        return {
            "ema_engagement":      round(self.ema or 0.0, 4),
            "confidence_weighted": self.confidence_weighted_score,
            "frame_count":         self.frame_count,
            "tone":                self.tone_percentages,
        }


# =============================================================================
#  LLM HELPERS
# =============================================================================

def _parse_duration_to_minutes(duration_str: str) -> int:
    """Parses "00:04:32", "4:32", "27m", "1h 5m" etc. into total minutes (min 1)."""
    total_seconds = 0
    s = str(duration_str or "0").replace("h", ":").replace("m", ":").replace("s", "").strip()
    parts = s.split(":")
    try:
        if len(parts) == 3:
            total_seconds = int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        elif len(parts) == 2:
            total_seconds = int(parts[0]) * 60 + int(parts[1])
        else:
            total_seconds = int(parts[0])
    except (ValueError, IndexError):
        total_seconds = 0
    return max(1, round(total_seconds / 60))


def _parse_emotion_pcts(emotion_summary: str) -> dict:
    """Parses "Happy: 45%, Neutral: 30%" -> {"Happy": 45, "Neutral": 30}."""
    result = {}
    if not emotion_summary:
        return result
    for part in emotion_summary.split(","):
        part = part.strip()
        if ":" not in part:
            continue
        label, val = part.split(":", 1)
        val = val.strip().rstrip("%").strip()
        try:
            result[label.strip()] = int(float(val))
        except ValueError:
            continue
    return result


def _engagement_band(score: float) -> tuple:
    """Converts engagement score (0-1 or 0-100) to (band, emoji, coaching) tuple."""
    pct = round(score) if score > 1 else round(score * 100)
    if pct >= 80:
        return ("Excellent", "🟢",
                "Sustain momentum — use spaced repetition and deliberate practice to lock in gains.")
    elif pct >= 65:
        return ("Good", "🟡",
                "Maintain focus — try active recall every 5 minutes to deepen retention.")
    elif pct >= 45:
        return ("Moderate", "🟠",
                "Boost engagement — add micro-breaks, use worked examples, and self-quiz frequently.")
    elif pct >= 25:
        return ("Low", "🔴",
                "Address disengagement — switch to a fresh topic or 10-min Pomodoro sprints.")
    else:
        return ("Very Low", "⛔",
                "Session fatigue detected — rest for 15 min before continuing; consider splitting content.")


def _dominant_emotion_profile(dominant: str) -> str:
    profiles = {
        "Happiness": "active enjoyment and receptivity — learner is fully present and motivated",
        "Surprise":  "attention spikes and curiosity — content is creating 'aha' moments",
        "Neutral":   "passive focus — stable attention with low emotional activation",
        "Fear":      "anxiety or performance stress — content difficulty may be too high",
        "Sadness":   "low motivation or withdrawal — possible demotivation or fatigue",
        "Anger":     "frustration or confusion — content is not landing, intervention needed",
        "Disgust":   "strong aversion — content or format is strongly misaligned with the learner",
    }
    return profiles.get(dominant, "mixed emotional state — review timeline for patterns")


def _duration_context(total_minutes: int) -> tuple:
    """Returns (phase_label, duration_note, time_tip) based on session length."""
    if total_minutes < 5:
        return (
            "short warm-up session",
            f"very brief at {total_minutes} min — not enough data for deep conclusions",
            "Next session aim for at least 15-20 min to generate reliable engagement patterns."
        )
    elif total_minutes <= 15:
        return (
            "short focused session",
            f"compact {total_minutes}-min window — good for single-topic bursts",
            "Try extending to 20-25 min next time to build on this focus."
        )
    elif total_minutes <= 25:
        return (
            "standard learning session",
            f"solid {total_minutes}-min window — enough data for reliable trends",
            "This length is optimal; maintain it and compare trends across sessions."
        )
    elif total_minutes <= 45:
        return (
            "extended learning session",
            f"long session at {total_minutes} min — fatigue risk begins around the 30-min mark",
            "Consider splitting into 25-min blocks with 5-min active breaks next time."
        )
    else:
        return (
            "marathon deep-work session",
            f"very long at {total_minutes} min — significant fatigue risk",
            "Split future sessions into 3-4 focused 15-min chunks with breaks to protect engagement."
        )


def _engagement_time_interpretation(eng_pct: int, total_minutes: int) -> str:
    """Single plain-English sentence combining engagement % and session duration."""
    if eng_pct >= 70 and total_minutes >= 20:
        return (f"Strong sustained focus — {eng_pct}% EMA engagement held over {total_minutes} min "
                f"indicates deep learning mode.")
    elif eng_pct >= 70 and total_minutes < 20:
        return (f"Good short-burst engagement — {eng_pct}% is solid but the session was brief "
                f"({total_minutes} min); hard to confirm if this focus would sustain longer.")
    elif eng_pct >= 50 and total_minutes >= 20:
        return (f"Moderate sustained engagement — {eng_pct}% over {total_minutes} min shows "
                f"attention was present but inconsistent; clear room to improve.")
    elif eng_pct >= 50 and total_minutes < 20:
        return (f"Adequate engagement ({eng_pct}%) for a short {total_minutes}-min session; "
                f"not enough data yet to identify a trend.")
    elif eng_pct >= 30 and total_minutes >= 20:
        return (f"Concerning pattern — only {eng_pct}% EMA engagement across {total_minutes} min "
                f"suggests significant disengagement for extended periods.")
    else:
        return (f"Low engagement ({eng_pct}%) in a {total_minutes}-min session signals "
                f"early disengagement or fatigue; intervention is recommended.")


# =============================================================================
#  generate_summary()  —  engagement + time aware
# =============================================================================

def generate_summary(session_data: dict) -> str:
    """
    Generates a chat-style session summary via Groq — EMA engagement only.
    No timestamps, no duration math, no 'time-based' coaching.
    Talks directly to the learner like a real coach would after watching them.
    """
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        raise ValueError("GROQ_API_KEY is missing. Add it to your .env file.")

    raw_eng  = session_data.get("engagement", 0) or 0
    eng_pct  = round(raw_eng * 100) if raw_eng <= 1.0 else round(raw_eng)
    band, emoji, coaching = _engagement_band(eng_pct)

    dominant    = session_data.get("dominantEmotion", "Neutral")
    dom_profile = _dominant_emotion_profile(dominant)

    # Tone breakdown from tracker (pos/neg/neutral % of frames)
    tone    = session_data.get("tone", {})
    pos_pct = tone.get("positive", 0)
    neg_pct = tone.get("negative", 0)
    neu_pct = tone.get("neutral",  0)

    # Determine conversational engagement label
    if eng_pct >= 75:
        eng_read = f"strong — you were clearly in the zone at {eng_pct}%"
    elif eng_pct >= 55:
        eng_read = f"decent but uneven — {eng_pct}% shows some drift"
    elif eng_pct >= 35:
        eng_read = f"low at {eng_pct}% — your attention was struggling"
    else:
        eng_read = f"very low at {eng_pct}% — significant disengagement detected"

    system_msg = (
        "You are EmotionAI, a friendly and direct learning coach. "
        "You just finished watching a learner's live session through their webcam. "
        "You detected their facial emotions frame by frame and computed an EMA engagement score — "
        "a recency-weighted score where recent frames matter more than older ones. "
        "It reflects WHERE the learner ended up, not just a flat average.\n\n"
        "Write a short, warm, CHAT-STYLE message directly to the learner — like a coach texting "
        "feedback after a session. No headers. No bullet points. No sections. No timestamps. "
        "No references to session duration or time. Just 3-4 natural sentences.\n\n"
        "Structure (write as flowing prose, NOT labelled):\n"
        "  1. One honest sentence about how engaged they were (use the EMA score naturally).\n"
        "  2. One sentence about what their dominant emotion says about them right now.\n"
        "  3. One concrete, specific action they can take before their next session.\n"
        "  4. One short encouraging closer.\n\n"
        "Rules:\n"
        "- Never mention timestamps, duration, minutes, or seconds.\n"
        "- Never say 'session data', 'timeline', 'refer to', or 'see details'.\n"
        "- Never use headers like SESSION SNAPSHOT or COACH TIP.\n"
        "- Write like a real human coach, not a report generator.\n"
        "- Keep it under 80 words total."
    )

    user_msg = (
        f"EMA Engagement   : {eng_pct}% — {eng_read}\n"
        f"Engagement Band  : {band} {emoji}\n"
        f"Dominant Emotion : {dominant} ({dom_profile})\n"
        + (f"Tone Breakdown   : {pos_pct}% positive / {neu_pct}% neutral / {neg_pct}% negative\n" if tone else "")
        + f"\nCoaching direction: {coaching}\n\n"
        "Write the chat-style message now. Remember: no headers, no timestamps, no sections, under 80 words."
    )

    url     = "https://api.groq.com/openai/v1/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model":       "llama-3.1-8b-instant",
        "messages":    [
            {"role": "system", "content": system_msg},
            {"role": "user",   "content": user_msg},
        ],
        "max_tokens":  180,
        "temperature": 0.55,
    }

    try:
        res  = requests.post(url, headers=headers, json=payload, timeout=20)
        data = res.json()
        print("[EmotionAI] generate_summary GROQ response:", data)
        return data["choices"][0]["message"]["content"]
    except Exception as e:
        print(f"[EmotionAI] generate_summary error: {e}")
        dom_short = _dominant_emotion_profile(dominant).split("—")[0].strip()
        return (
            f"Your EMA engagement came in at {eng_pct}% — {band.lower()} overall. "
            f"{dominant} was your dominant emotion, which often signals {dom_short}. "
            f"{coaching} "
            f"You've got this — small adjustments make a big difference next time."
        )


# =============================================================================
#  PASSWORD
# =============================================================================

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(plain: str) -> str:
    return pwd_ctx.hash(plain)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_ctx.verify(plain, hashed)

def validate_password_strength(pw: str) -> Optional[str]:
    if len(pw) < 8:
        return "Password must be at least 8 characters."
    if not re.search(r"[A-Z]", pw):
        return "Password must include at least one uppercase letter (A-Z)."
    if not re.search(r"[a-z]", pw):
        return "Password must include at least one lowercase letter (a-z)."
    if not re.search(r"[0-9]", pw):
        return "Password must include at least one number (0-9)."
    if not re.search(r"[^A-Za-z0-9]", pw):
        return "Password must include at least one special character (!@#$...)."
    return None

def validate_username(username: str) -> Optional[str]:
    u = username.strip()
    if len(u) < 3:  return "Username must be at least 3 characters."
    if len(u) > 30: return "Username must be 30 characters or fewer."
    if not re.match(r"^[A-Za-z0-9._ -]+$", u):
        return "Username can only contain letters, numbers, spaces, _ . and -"
    if not re.match(r"^[A-Za-z0-9]", u):
        return "Username must start with a letter or number."
    if not re.search(r"[A-Za-z0-9]$", u):
        return "Username must end with a letter or number."
    if not re.search(r"[A-Za-z]", u):
        return "Username must contain at least one letter."
    return None


# =============================================================================
#  JWT
# =============================================================================

def create_token(data: dict, expires_delta: timedelta) -> str:
    payload = data.copy()
    payload["exp"] = datetime.now(timezone.utc) + expires_delta
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def create_access_token(user_id: int, is_admin: bool = False) -> str:
    return create_token(
        {"sub": str(user_id), "admin": is_admin, "type": "access"},
        timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )

def create_refresh_token(user_id: int) -> str:
    return create_token(
        {"sub": str(user_id), "type": "refresh"},
        timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    )

def decode_token(token: str) -> dict:
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])


# =============================================================================
#  DB
# =============================================================================

def db_conn():
    con = psycopg2.connect(**DB_DSN)
    con.autocommit = False
    return con

def fetchone(cur) -> Optional[dict]:
    row = cur.fetchone()
    if row is None: return None
    cols = [d[0] for d in cur.description]
    return dict(zip(cols, row))

def fetchall(cur) -> list:
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


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
#  LIFESPAN
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    try:
        import testing
        testing.get_haar_detector()
        testing.get_model()
        print("[EmotionAI] Preload complete")
    except Exception as e:
        print(f"[EmotionAI] Preload error (non-fatal): {e}")
    webbrowser.open(f"http://localhost:{APP_PORT}")
    yield


# =============================================================================
#  APP
# =============================================================================

app = FastAPI(title="EmotionAI", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


# =============================================================================
#  AUTH DEPENDENCIES
# =============================================================================

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

async def get_current_user(token: str = Depends(oauth2_scheme)):
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(status_code=401, detail="Could not validate credentials")
    con = db_conn(); cur = con.cursor()
    cur.execute("SELECT * FROM users WHERE id=%s", (user_id,))
    row = fetchone(cur); cur.close(); con.close()
    if not row:
        raise HTTPException(status_code=401, detail="User not found")
    return row

async def get_admin_user(current: dict = Depends(get_current_user)):
    if not current.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return current


# =============================================================================
#  SCHEMAS
# =============================================================================

class RegisterRequest(BaseModel):
    email:       str
    password:    str
    username:    Optional[str] = None
    security_q1: Optional[str] = None
    security_a1: Optional[str] = None
    security_q2: Optional[str] = None
    security_a2: Optional[str] = None

class RefreshRequest(BaseModel):
    refresh_token: str

class FeedbackRequest(BaseModel):
    username: str
    email:    Optional[str] = None
    rating:   Optional[int] = None
    category: str = "General"
    message:  str

class SessionEndRequest(BaseModel):
    session_id:         str
    average_engagement: float
    dominant_emotion:   str

class SessionStartRequest(BaseModel):
    source: str = "webcam"

class SessionStopRequest(BaseModel):
    session_id:   str
    total_frames: int = 0

class SummaryRequest(BaseModel):
    duration:        str
    engagement:      float
    dominantEmotion: str
    tone:            Optional[dict] = None  # {"positive": %, "neutral": %, "negative": %}

class InsightsRequest(BaseModel):
    duration:              str
    emotion_summary:       str
    most_frequent_emotion: str
    engagement_score:      float
    reactions_sent:        int
    tone:                  Optional[dict] = None  # {"positive": %, "neutral": %, "negative": %}

class AdminCreateUserRequest(BaseModel):
    username: str
    email:    str
    password: str
    is_admin: bool = False

class FaqFeedbackRequest(BaseModel):
    faq_question: str
    vote:         str            # "liked" or "disliked"
    complaint:    Optional[str] = None


# =============================================================================
#  ML PIPELINE
# =============================================================================

executor = ThreadPoolExecutor(max_workers=1)

def run_pipeline(img_rgb: np.ndarray, use_mtcnn: bool = False):
    """
    Run face detection + emotion classification on one frame.

    The 'engagement' field in the returned dict is the confidence-weighted
    single-frame score:
        engagement = emotion_weight * model_confidence

    Example: Happiness at 95% confidence -> 0.85 * 0.95 = 0.807
             Happiness at 52% confidence -> 0.85 * 0.52 = 0.442

    Downstream callers accumulate these per-frame scores using
    SessionEngagementTracker to produce EMA-based session scores.
    """
    import testing
    idx, confidence, probs = testing.predict_emotion_from_image(img_rgb, use_mtcnn=use_mtcnn)

    conf = float(confidence)
    if conf > 1.0:
        conf /= 100.0

    norm_probs = [round(float(p) / 100.0 if float(p) > 1.0 else float(p), 4) for p in probs]
    emotion    = EMOTION_LABELS[idx]

    # Confidence-weighted single-frame score
    frame_engagement = round(emotion_to_engagement(emotion) * conf, 4)

    return {
        "emotion":           emotion,
        "confidence":        round(conf, 4),
        "all_probabilities": norm_probs,
        "engagement":        frame_engagement,
        "timestamp":         datetime.utcnow().isoformat(),
    }, None


# =============================================================================
#  HEALTH
# =============================================================================

@app.get("/health")
async def health():
    return {"status": "ok"}


# =============================================================================
#  AUTH
# =============================================================================

@app.post("/auth/register")
async def register(body: RegisterRequest):
    err = validate_password_strength(body.password)
    if err: raise HTTPException(status_code=400, detail=err)

    email_clean = body.email.strip().lower()
    if body.username and body.username.strip():
        username = body.username.strip()
        un_err = validate_username(username)
        if un_err: raise HTTPException(status_code=400, detail=un_err)
    else:
        local    = email_clean.split("@")[0]
        username = re.sub(r"[^A-Za-z0-9._-]", "_", local)[:30] or "user"

    con = db_conn(); cur = con.cursor()
    try:
        cur.execute("SELECT id FROM users WHERE email=%s", (email_clean,))
        if cur.fetchone():
            raise HTTPException(status_code=400, detail="An account with this email already exists.")
        base_username = username; suffix = 1
        while True:
            cur.execute("SELECT id FROM users WHERE username=%s", (username,))
            if not cur.fetchone(): break
            username = f"{base_username}{suffix}"; suffix += 1
        cur.execute(
            "INSERT INTO users (username, email, password_hash, security_q1, security_a1, security_q2, security_a2) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s)",
            (username, email_clean, hash_password(body.password),
             body.security_q1, body.security_a1, body.security_q2, body.security_a2)
        )
        con.commit()
        return {"message": "Account created successfully"}
    finally:
        cur.close(); con.close()


@app.post("/auth/login")
async def login(form: OAuth2PasswordRequestForm = Depends()):
    con = db_conn(); cur = con.cursor()
    try:
        cur.execute("SELECT * FROM users WHERE LOWER(email)=%s", (form.username.strip().lower(),))
        row = fetchone(cur)
        if not row or not verify_password(form.password, row["password_hash"]):
            raise HTTPException(status_code=401, detail="Incorrect email or password")
        cur.execute("UPDATE users SET last_login=NOW() WHERE id=%s", (row["id"],))
        con.commit()
        return {
            "access_token":  create_access_token(row["id"], is_admin=bool(row["is_admin"])),
            "refresh_token": create_refresh_token(row["id"]),
            "token_type":    "bearer",
            "is_admin":      bool(row["is_admin"]),
        }
    finally:
        cur.close(); con.close()


@app.post("/auth/admin/login")
async def admin_login(form: OAuth2PasswordRequestForm = Depends()):
    con = db_conn(); cur = con.cursor()
    try:
        cur.execute(
            "SELECT * FROM users WHERE LOWER(email)=%s AND is_admin=TRUE",
            (form.username.strip().lower(),)
        )
        row = fetchone(cur)
        if not row or not verify_password(form.password, row["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid admin credentials")
        cur.execute("UPDATE users SET last_login=NOW() WHERE id=%s", (row["id"],))
        con.commit()
        return {
            "access_token":  create_access_token(row["id"], is_admin=True),
            "refresh_token": create_refresh_token(row["id"]),
            "token_type":    "bearer",
        }
    finally:
        cur.close(); con.close()


@app.post("/auth/refresh")
async def refresh_token(body: RefreshRequest):
    try:
        payload = decode_token(body.refresh_token)
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
    con = db_conn(); cur = con.cursor()
    cur.execute("SELECT * FROM users WHERE id=%s", (user_id,))
    row = fetchone(cur); cur.close(); con.close()
    if not row:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return {
        "access_token": create_access_token(row["id"], is_admin=bool(row["is_admin"])),
        "token_type":   "bearer",
    }


@app.get("/auth/me")
async def me(current: dict = Depends(get_current_user)):
    return {
        "id":                  current["id"],
        "username":            current["username"],
        "email":               current["email"],
        "is_admin":            current["is_admin"],
        "created_at":          current["created_at"],
        "last_login":          current["last_login"],
        "password_reset_hash": current.get("password_reset_hash"),
    }


@app.post("/auth/reset/verify-email")
async def reset_verify_email(body: dict, request: Request):
    email = body.get("email", "").strip().lower()
    if not email: raise HTTPException(status_code=400, detail="Email is required.")
    ip = request.client.host if request.client else None
    con = db_conn(); cur = con.cursor()
    try:
        cur.execute(
            "SELECT id, security_q1, security_q2 FROM users WHERE LOWER(email)=%s AND is_admin=FALSE",
            (email,)
        )
        row = fetchone(cur)
        if not row:
            raise HTTPException(status_code=404, detail="No account found for that email.")
        if not row.get("security_q1") or not row.get("security_q2"):
            raise HTTPException(status_code=400, detail="This account has no security questions set.")
        cur.execute(
            "INSERT INTO password_reset_log (user_id,email,security_q1,security_q2,step1_at,ip_address) "
            "VALUES (%s,%s,%s,%s,NOW(),%s)",
            (row["id"], email, row["security_q1"], row["security_q2"], ip)
        )
        con.commit()
        return {"q1label": row["security_q1"], "q2label": row["security_q2"]}
    finally:
        cur.close(); con.close()


@app.post("/auth/reset/verify-answers")
async def reset_verify_answers(body: dict):
    email = body.get("email", "").strip().lower()
    a1    = (body.get("a1") or "").strip().lower()
    a2    = (body.get("a2") or "").strip().lower()
    if not email or not a1 or not a2:
        raise HTTPException(status_code=400, detail="Email and both answers are required.")
    con = db_conn(); cur = con.cursor()
    try:
        cur.execute(
            "SELECT id, security_a1, security_a2 FROM users WHERE LOWER(email)=%s AND is_admin=FALSE",
            (email,)
        )
        row = fetchone(cur)
        if not row: raise HTTPException(status_code=404, detail="Account not found.")
        passed = (
            a1 == (row.get("security_a1") or "").strip().lower() and
            a2 == (row.get("security_a2") or "").strip().lower()
        )
        cur.execute(
            "UPDATE password_reset_log SET step2_at=NOW(), step2_passed=%s "
            "WHERE id=(SELECT id FROM password_reset_log WHERE user_id=%s ORDER BY step1_at DESC LIMIT 1)",
            (passed, row["id"])
        )
        con.commit()
        if not passed: raise HTTPException(status_code=400, detail="Answers do not match.")
        return {"verified": True}
    finally:
        cur.close(); con.close()


@app.post("/auth/reset/password")
async def reset_password(body: dict):
    email  = body.get("email", "").strip().lower()
    new_pw = body.get("new_password", "")
    if not email or not new_pw:
        raise HTTPException(status_code=400, detail="Email and new password are required.")
    err = validate_password_strength(new_pw)
    if err: raise HTTPException(status_code=400, detail=err)
    con = db_conn(); cur = con.cursor()
    try:
        cur.execute("SELECT id FROM users WHERE LOWER(email)=%s AND is_admin=FALSE", (email,))
        row = fetchone(cur)
        if not row: raise HTTPException(status_code=404, detail="Account not found.")
        new_pw_hash = hash_password(new_pw)
        cur.execute(
            "UPDATE users SET password_hash=%s, password_reset_hash=%s WHERE id=%s",
            (new_pw_hash, new_pw_hash, row["id"])
        )
        cur.execute(
            "UPDATE password_reset_log SET step3_at=NOW(), completed=TRUE "
            "WHERE id=(SELECT id FROM password_reset_log WHERE user_id=%s ORDER BY step1_at DESC LIMIT 1)",
            (row["id"],)
        )
        con.commit()
        return {"message": "Password reset successfully."}
    finally:
        cur.close(); con.close()


# =============================================================================
#  EMOTION DETECTION
# =============================================================================

_active_sessions: dict[int, str] = {}


@app.post("/predict/")
async def predict(
    file:       UploadFile = File(...),
    fast:       bool = Query(False),
    save:       bool = Query(True),
    session_id: Optional[str] = Query(None),
    current:    dict = Depends(get_current_user),
):
    try:
        contents  = await file.read()
        img       = Image.open(io.BytesIO(contents)).convert("RGB")
        img_rgb   = np.array(img)
        loop      = asyncio.get_event_loop()
        result, _ = await loop.run_in_executor(
            executor, lambda: run_pipeline(img_rgb, use_mtcnn=not fast)
        )
        uid = current["id"]
        if session_id:
            sid = session_id; _active_sessions[uid] = sid
        elif uid in _active_sessions:
            sid = _active_sessions[uid]
        else:
            sid = str(uuid.uuid4()); _active_sessions[uid] = sid
        if save:
            _save_detection(uid, sid, result, source="webcam")
        return {**result, "session_id": sid, "user_id": uid}
    except Exception as exc:
        print(f"[EmotionAI] /predict error: {exc}")
        return JSONResponse(status_code=500, content={"error": "server_error", "message": str(exc)})


@app.post("/analyze")
async def analyze_frame(
    file:       UploadFile = File(...),
    session_id: Optional[str] = Query(None),
    current:    dict = Depends(get_current_user),
):
    try:
        contents  = await file.read()
        img       = Image.open(io.BytesIO(contents)).convert("RGB")
        img_rgb   = np.array(img)
        loop      = asyncio.get_event_loop()
        result, _ = await loop.run_in_executor(executor, lambda: run_pipeline(img_rgb))
        sid = session_id or str(uuid.uuid4())
        _save_detection(current["id"], sid, result, source="webcam")
        return {**result, "session_id": sid, "user_id": current["id"]}
    except Exception as exc:
        print(f"[EmotionAI] analyze error: {exc}")
        return JSONResponse(status_code=500, content={"error": "server_error", "message": str(exc)})


@app.post("/analyze-video")
async def analyze_video(
    file:    UploadFile = File(...),
    current: dict = Depends(get_current_user),
):
    try:
        import cv2, tempfile
        sid      = str(uuid.uuid4())
        contents = await file.read()
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as tmp:
            tmp.write(contents); tmp_path = tmp.name

        cap            = cv2.VideoCapture(tmp_path)
        fps            = cap.get(cv2.CAP_PROP_FPS) or 25
        frame_interval = max(1, int(fps))
        timeline_data: list[dict] = []
        frame_idx      = 0
        loop           = asyncio.get_event_loop()
        tracker        = SessionEngagementTracker()   # EMA tracker for video

        while True:
            ret, frame = cap.read()
            if not ret: break
            if frame_idx % frame_interval == 0:
                img_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                try:
                    result, _ = await loop.run_in_executor(
                        executor, lambda f=img_rgb: run_pipeline(f, use_mtcnn=False)
                    )
                    ema_score = tracker.update(result["emotion"], result["confidence"])
                    t_offset  = round(frame_idx / fps, 2)
                    timeline_data.append({
                        "time":       t_offset,
                        "emotion":    result["emotion"],
                        "engagement": ema_score,
                    })
                    _save_detection(current["id"], sid, result, source="upload")
                except Exception:
                    pass
            frame_idx += 1

        cap.release(); os.unlink(tmp_path)

        if not timeline_data:
            return JSONResponse(status_code=400, content={"error": "no_data", "message": "No frames analyzed."})

        summary  = tracker.summary()
        avg_eng  = summary["ema_engagement"]
        counts: dict[str, int] = {}
        for t in timeline_data:
            counts[t["emotion"]] = counts.get(t["emotion"], 0) + 1
        dominant = max(counts, key=lambda k: counts[k])

        _save_session_timeline(sid, current["id"], "upload", timeline_data, avg_eng, dominant)
        return {
            "session_id":         sid,
            "timeline":           timeline_data,
            "average_engagement": avg_eng,
            "dominant_emotion":   dominant,
            "engagement_summary": summary,
        }

    except Exception as exc:
        print(f"[EmotionAI] analyze-video error: {exc}")
        return JSONResponse(status_code=500, content={"error": "server_error", "message": str(exc)})


@app.get("/session-report/{session_id}")
async def session_report(session_id: str, current: dict = Depends(get_current_user)):
    con = db_conn(); cur = con.cursor()
    try:
        cur.execute(
            "SELECT * FROM detections WHERE user_id=%s ORDER BY created_at DESC LIMIT 500",
            (current["id"],)
        )
        data = fetchall(cur)
        if not data:
            raise HTTPException(status_code=404, detail="Session not found")

        tracker = SessionEngagementTracker()
        for r in data:
            tracker.update(r["emotion"], r.get("confidence", 1.0))

        counts: dict[str, int] = {}
        for r in data:
            counts[r["emotion"]] = counts.get(r["emotion"], 0) + 1
        dominant = max(counts, key=lambda k: counts[k])
        summary  = tracker.summary()

        return {
            "session_id":         session_id,
            "frame_count":        len(data),
            "average_engagement": summary["ema_engagement"],
            "dominant_emotion":   dominant,
            "emotion_counts":     counts,
            "engagement_summary": summary,
            "detections":         data,
        }
    finally:
        cur.close(); con.close()


@app.post("/sessions/start/")
async def session_start(current: dict = Depends(get_current_user)):
    return {"session_id": str(uuid.uuid4())}


@app.post("/sessions/end/")
async def session_stop(body: SessionStopRequest, current: dict = Depends(get_current_user)):
    _active_sessions.pop(current["id"], None)
    con = db_conn(); cur = con.cursor()
    try:
        cur.execute(
            "SELECT emotion, confidence, engagement FROM detections "
            "WHERE user_id=%s ORDER BY created_at DESC LIMIT 500",
            (current["id"],)
        )
        rows = fetchall(cur)
        if not rows:
            return {"message": "No detections found for session", "session_id": body.session_id}

        tracker = SessionEngagementTracker()
        for r in rows:
            tracker.update(r["emotion"], r.get("confidence", 1.0))

        summary  = tracker.summary()
        avg_eng  = summary["ema_engagement"]
        counts: dict = {}
        for r in rows:
            counts[r["emotion"]] = counts.get(r["emotion"], 0) + 1
        dominant = max(counts, key=lambda k: counts[k])

        timeline_data = [
            {"time": r.get("time_offset", 0), "emotion": r["emotion"], "engagement": r["engagement"]}
            for r in rows
        ]
        _save_session_timeline(body.session_id, current["id"], "webcam", timeline_data, avg_eng, dominant)
        return {
            "message":            "Session saved",
            "session_id":         body.session_id,
            "average_engagement": avg_eng,
            "dominant_emotion":   dominant,
            "engagement_summary": summary,
        }
    finally:
        cur.close(); con.close()


# =============================================================================
#  /generate-insights  —  EMA + engagement x time aware
# =============================================================================

@app.post("/generate-insights")
async def generate_insights(body: InsightsRequest, current: dict = Depends(get_current_user)):
    """Use Groq to generate 3 structured insight blocks — EMA engagement only, no time references."""
    import json as _json
    import re   as _re

    _key = os.getenv("GROQ_API_KEY", "").strip()
    if not _key:
        raise HTTPException(
            status_code=502,
            detail="GROQ_API_KEY is not set. Add it to your .env file and restart."
        )

    # Normalise engagement to 0-100
    raw_eng = body.engagement_score or 0
    eng_pct = round(raw_eng * 100) if raw_eng <= 1.0 else round(raw_eng)
    band, emoji, coaching = _engagement_band(eng_pct)

    # Parse emotion distribution
    emotion_dist = _parse_emotion_pcts(body.emotion_summary or "")
    pos_emotions = {"Happiness", "Happy", "Surprise", "Surprised"}
    neg_emotions = {"Anger", "Angry", "Sadness", "Sad", "Fear", "Disgust"}
    pos_pct = sum(v for k, v in emotion_dist.items() if k in pos_emotions)
    neg_pct = sum(v for k, v in emotion_dist.items() if k in neg_emotions)
    neu_pct = max(0, 100 - pos_pct - neg_pct)

    # Prefer tracker tone if provided (more accurate than string parsing)
    if body.tone:
        pos_pct = body.tone.get("positive", pos_pct)
        neg_pct = body.tone.get("negative", neg_pct)
        neu_pct = body.tone.get("neutral",  neu_pct)

    dominant    = body.most_frequent_emotion or "Neutral"
    dom_profile = _dominant_emotion_profile(dominant)

    # Determine what the EMA score actually means right now
    if eng_pct >= 75:
        eng_verdict = f"strong engagement — learner ended the session well-focused"
    elif eng_pct >= 55:
        eng_verdict = f"moderate engagement — decent attention with some drift"
    elif eng_pct >= 35:
        eng_verdict = f"low engagement — significant attention loss detected"
    else:
        eng_verdict = f"very low engagement — learner was largely disengaged"

    # Dominant emotion coaching context
    if neg_pct >= 35:
        emotional_context = f"high negativity ({neg_pct}%) — frustration or confusion signals"
        action_hint = "Break content into smaller pieces, slow delivery, ask check-in questions"
    elif neg_pct >= 15:
        emotional_context = f"some negativity ({neg_pct}%) — mild friction present"
        action_hint = "Revisit one complex point from this session using a simpler analogy"
    elif pos_pct >= 60:
        emotional_context = f"strong positive emotions ({pos_pct}%) — learner was receptive"
        action_hint = "Reinforce this content within 24h using active recall or a quick quiz"
    elif neu_pct >= 60:
        emotional_context = f"mostly neutral ({neu_pct}%) — stable but passive attention"
        action_hint = "Add one interactive element — question, poll, or worked example — next time"
    else:
        emotional_context = f"mixed emotions — {pos_pct}% positive, {neg_pct}% negative"
        action_hint = coaching

    system_msg = (
        "You are EmotionAI, a direct and friendly learning coach. "
        "You generate exactly 3 insight cards based on a learner's EMA engagement score and emotion data. "
        "Each card has a short title (3-5 words) and a 1-sentence description.\n\n"
        "STRICT RULES:\n"
        "1. NEVER mention timestamps, minutes, seconds, session duration, or time.\n"
        "2. NEVER say 'see timeline', 'check session data', 'at X:XX', or 'refer to'.\n"
        "3. Base everything ONLY on EMA engagement score and emotion percentages.\n"
        "4. The EMA score is recency-weighted — the final score reflects how the learner ENDED, "
        "   not just a flat average. A high EMA means they finished strong.\n"
        "5. Be direct and specific. Mention the actual % numbers.\n"
        "6. Return ONLY valid JSON. No markdown, no code fences, no preamble.\n\n"
        'Output format: {"insights":[{"title":"...","desc":"..."},{"title":"...","desc":"..."},{"title":"...","desc":"..."}]}'
    )

    user_msg = (
        f"EMA Engagement  : {eng_pct}% — {eng_verdict}\n"
        f"Engagement Band : {band} {emoji}\n"
        f"Dominant Emotion: {dominant} ({dom_profile})\n"
        f"Emotion Tone    : {pos_pct}% positive / {neu_pct}% neutral / {neg_pct}% negative\n"
        f"Emotional State : {emotional_context}\n"
        f"Full Distribution: {body.emotion_summary or 'N/A'}\n\n"
        "Generate 3 insight cards:\n"
        f"Card 1 — EMA READING: What does {eng_pct}% EMA engagement actually mean for this learner right now?\n"
        f"Card 2 — EMOTION SIGNAL: What does {dominant} as dominant emotion ({dom_profile}) reveal?\n"
        f"Card 3 — ACTION: One specific, real-world action. Hint: {action_hint}\n\n"
        "No timestamps. No time references. Numbers only from the data above. Return JSON only."
    )

    url     = "https://api.groq.com/openai/v1/chat/completions"
    headers = {"Authorization": f"Bearer {_key}", "Content-Type": "application/json"}
    payload = {
        "model":       "llama-3.1-8b-instant",
        "messages":    [
            {"role": "system", "content": system_msg},
            {"role": "user",   "content": user_msg},
        ],
        "max_tokens":  450,
        "temperature": 0.3,
    }

    def _extract_insights(raw: str) -> dict:
        text = raw.strip()
        text = _re.sub(r"^```[a-z]*\s*", "", text, flags=_re.IGNORECASE)
        text = _re.sub(r"\s*```$", "", text).strip()

        try:
            parsed = _json.loads(text)
            if "insights" in parsed and isinstance(parsed["insights"], list) and len(parsed["insights"]) >= 1:
                return parsed
        except Exception:
            pass

        match = _re.search(r'\{.*\}', text, _re.DOTALL)
        if match:
            try:
                parsed = _json.loads(match.group())
                if "insights" in parsed and isinstance(parsed["insights"], list) and len(parsed["insights"]) >= 1:
                    return parsed
            except Exception:
                pass

        titles = _re.findall(r'"title"\s*:\s*"([^"]+)"', text)
        descs  = _re.findall(r'"desc"\s*:\s*"([^"]+)"', text)
        if titles:
            insights = [
                {"title": t, "desc": descs[i] if i < len(descs) else f"{eng_pct}% EMA — {band.lower()} engagement."}
                for i, t in enumerate(titles[:3])
            ]
            if insights: return {"insights": insights}

        print(f"[EmotionAI] /generate-insights: all parse strategies failed. Raw:\n{raw}")
        return {"insights": [
            {"title": "EMA reading",       "desc": f"{eng_pct}% EMA engagement — {eng_verdict}."},
            {"title": "Emotion signal",    "desc": f"{dominant} dominated ({pos_pct}% positive, {neg_pct}% negative)."},
            {"title": "Action",            "desc": action_hint},
        ]}

    def _static_fallback() -> dict:
        return {"insights": [
            {"title": "EMA reading",    "desc": f"{eng_pct}% EMA engagement — {eng_verdict}."},
            {"title": "Emotion signal", "desc": f"{dominant} dominated. {dom_profile.capitalize()}."},
            {"title": "Action",         "desc": action_hint},
        ]}

    try:
        res = requests.post(url, headers=headers, json=payload, timeout=20)
        if not res.ok:
            try:    err_body = res.json()
            except: err_body = {}
            print(f"[EmotionAI] /generate-insights Groq HTTP {res.status_code}: {err_body}")
            return _static_fallback()
        data     = res.json()
        raw_text = data["choices"][0]["message"]["content"]
        print(f"[EmotionAI] /generate-insights raw LLM output: {raw_text!r}")
        return _extract_insights(raw_text)
    except Exception as e:
        print(f"[EmotionAI] /generate-insights error: {e}")
        return _static_fallback()


# =============================================================================
#  /session-end
# =============================================================================

@app.post("/session-end")
async def session_end(body: SessionEndRequest, current: dict = Depends(get_current_user)):
    _active_sessions.pop(current["id"], None)
    con = db_conn(); cur = con.cursor()
    try:
        cur.execute(
            "SELECT emotion, confidence, engagement FROM detections "
            "WHERE user_id=%s ORDER BY created_at DESC LIMIT 500",
            (current["id"],)
        )
        rows = fetchall(cur)
        timeline_data = [
            {"time": r.get("time_offset", 0), "emotion": r["emotion"], "engagement": r["engagement"]}
            for r in rows
        ]
        tracker = SessionEngagementTracker()
        for r in rows:
            tracker.update(r["emotion"], r.get("confidence", 1.0))
        avg_eng = tracker.summary()["ema_engagement"]

        _save_session_timeline(
            body.session_id, current["id"], "webcam",
            timeline_data, avg_eng, body.dominant_emotion
        )
        return {"message": "Session saved", "engagement_summary": tracker.summary()}
    finally:
        cur.close(); con.close()


# =============================================================================
#  /generate-summary
# =============================================================================

@app.post("/generate-summary")
async def get_summary(body: SummaryRequest):
    summary = generate_summary(body.dict())
    return {"summary": summary}


# =============================================================================
#  FEEDBACK
# =============================================================================

async def _do_save_feedback(body: FeedbackRequest, request: Request):
    if not body.username or not body.username.strip():
        raise HTTPException(status_code=400, detail="Username is required.")
    user_id = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            payload = decode_token(auth_header.split(" ", 1)[1])
            if payload.get("type") == "access":
                uid       = int(payload["sub"])
                con_check = db_conn(); cur_check = con_check.cursor()
                cur_check.execute("SELECT id FROM users WHERE id=%s", (uid,))
                if cur_check.fetchone(): user_id = uid
                cur_check.close(); con_check.close()
        except Exception:
            pass
    con = db_conn(); cur = con.cursor()
    try:
        cur.execute(
            "INSERT INTO feedback (user_id, username, email, rating, category, message) "
            "VALUES (%s,%s,%s,%s,%s,%s)",
            (
                user_id, body.username.strip(), body.email or None,
                body.rating if body.rating and 1 <= body.rating <= 5 else None,
                body.category or "General", body.message.strip(),
            )
        )
        con.commit()
        return {"message": "Feedback received -- thank you!"}
    except Exception as e:
        con.rollback(); print(f"[EmotionAI] feedback insert error: {e}")
        raise HTTPException(status_code=500, detail=f"Could not save feedback: {str(e)}")
    finally:
        cur.close(); con.close()


@app.post("/feedback")
async def submit_feedback_compat(body: FeedbackRequest, request: Request):
    return await _do_save_feedback(body, request)

@app.post("/api/feedback")
async def submit_feedback(body: FeedbackRequest, request: Request):
    return await _do_save_feedback(body, request)

@app.post("/api/feedback/guest")
@app.post("/feedback/guest")
async def submit_feedback_guest(body: FeedbackRequest, request: Request):
    if not body.username or not body.username.strip():
        raise HTTPException(status_code=400, detail="Username is required.")
    con = db_conn(); cur = con.cursor()
    try:
        cur.execute(
            "INSERT INTO feedback (user_id, username, email, rating, category, message) "
            "VALUES (%s,%s,%s,%s,%s,%s)",
            (None, body.username.strip(), body.email, body.rating, body.category, body.message)
        )
        con.commit()
        return {"message": "Feedback received -- thank you!"}
    finally:
        cur.close(); con.close()


# =============================================================================
#  FAQ FEEDBACK
# =============================================================================

@app.post("/api/faq-feedback")
async def submit_faq_feedback(body: FaqFeedbackRequest, request: Request):
    if body.vote not in ("liked", "disliked"):
        raise HTTPException(status_code=400, detail="vote must be 'liked' or 'disliked'")
    if not body.faq_question or not body.faq_question.strip():
        raise HTTPException(status_code=400, detail="faq_question is required")
    user_id = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            payload = decode_token(auth_header.split(" ", 1)[1])
            if payload.get("type") == "access":
                uid = int(payload["sub"])
                con_check = db_conn(); cur_check = con_check.cursor()
                cur_check.execute("SELECT id FROM users WHERE id=%s", (uid,))
                if cur_check.fetchone(): user_id = uid
                cur_check.close(); con_check.close()
        except Exception:
            pass
    con = db_conn(); cur = con.cursor()
    try:
        cur.execute(
            "INSERT INTO faq_feedback (user_id, faq_question, vote, complaint) VALUES (%s,%s,%s,%s)",
            (user_id, body.faq_question.strip(), body.vote, body.complaint or None)
        )
        con.commit()
        return {"message": "FAQ feedback saved"}
    except Exception as e:
        con.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close(); con.close()

@app.get("/admin/stats")
async def admin_stats(admin: dict = Depends(get_admin_user)):
    con = db_conn(); cur = con.cursor()
    try:
        cur.execute("SELECT COUNT(*) FROM users WHERE is_admin=FALSE")
        total_users = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM detections")
        total_detections = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM session_timeline")
        total_sessions = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM feedback")
        total_feedback = cur.fetchone()[0]
        cur.execute("SELECT AVG(engagement) FROM detections")
        avg_row = cur.fetchone()[0]
        cur.execute("SELECT emotion, COUNT(*) as cnt FROM detections GROUP BY emotion ORDER BY cnt DESC")
        emotion_rows = fetchall(cur)
        return {
            "total_users":      total_users,
            "total_detections": total_detections,
            "total_sessions":   total_sessions,
            "total_feedback":   total_feedback,
            "avg_engagement":   round(avg_row, 3) if avg_row else 0,
            "emotion_counts":   {r["emotion"]: r["cnt"] for r in emotion_rows},
        }
    finally:
        cur.close(); con.close()


@app.get("/admin/users")
async def admin_list_users(admin: dict = Depends(get_admin_user)):
    con = db_conn(); cur = con.cursor()
    cur.execute("SELECT id,username,email,is_admin,created_at,last_login FROM users ORDER BY id")
    rows = fetchall(cur); cur.close(); con.close()
    return rows


@app.post("/admin/users")
async def admin_create_user(body: AdminCreateUserRequest, admin: dict = Depends(get_admin_user)):
    err = validate_password_strength(body.password)
    if err: raise HTTPException(status_code=400, detail=err)
    un_err = validate_username(body.username)
    if un_err: raise HTTPException(status_code=400, detail=un_err)
    con = db_conn(); cur = con.cursor()
    try:
        cur.execute("SELECT id FROM users WHERE username=%s OR email=%s",
                    (body.username.strip(), body.email.strip()))
        if cur.fetchone():
            raise HTTPException(status_code=400, detail="Username or email already taken.")
        cur.execute(
            "INSERT INTO users (username, email, password_hash, is_admin) VALUES (%s,%s,%s,%s) RETURNING id",
            (body.username.strip(), body.email.strip(), hash_password(body.password), body.is_admin)
        )
        new_id = cur.fetchone()[0]; con.commit()
        return {"message": "User created successfully", "user_id": new_id}
    finally:
        cur.close(); con.close()


@app.patch("/admin/users/{user_id}/toggle-admin")
async def toggle_admin(user_id: int, admin: dict = Depends(get_admin_user)):
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Cannot modify your own admin status")
    con = db_conn(); cur = con.cursor()
    try:
        cur.execute("SELECT is_admin FROM users WHERE id=%s", (user_id,))
        row = fetchone(cur)
        if not row: raise HTTPException(status_code=404, detail="User not found")
        new_val = not row["is_admin"]
        cur.execute("UPDATE users SET is_admin=%s WHERE id=%s", (new_val, user_id))
        con.commit()
        return {"user_id": user_id, "is_admin": new_val}
    finally:
        cur.close(); con.close()


@app.patch("/admin/users/{user_id}/reset-password")
async def admin_reset_password(user_id: int, body: dict, admin: dict = Depends(get_admin_user)):
    new_password = body.get("password", "")
    err = validate_password_strength(new_password)
    if err: raise HTTPException(status_code=400, detail=err)
    con = db_conn(); cur = con.cursor()
    try:
        cur.execute("SELECT id FROM users WHERE id=%s", (user_id,))
        if not cur.fetchone(): raise HTTPException(status_code=404, detail="User not found")
        new_pw_hash = hash_password(new_password)
        cur.execute("UPDATE users SET password_hash=%s, password_reset_hash=%s WHERE id=%s",
                    (new_pw_hash, new_pw_hash, user_id))
        con.commit()
        return {"message": f"Password reset for user {user_id}"}
    finally:
        cur.close(); con.close()


@app.delete("/admin/users/{user_id}")
async def deactivate_user(user_id: int, admin: dict = Depends(get_admin_user)):
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    con = db_conn(); cur = con.cursor()
    try:
        cur.execute("DELETE FROM users WHERE id=%s AND is_admin=FALSE", (user_id,))
        con.commit()
        return {"message": f"User {user_id} deleted"}
    finally:
        cur.close(); con.close()


@app.get("/admin/detections")
async def admin_list_detections(admin: dict = Depends(get_admin_user)):
    con = db_conn(); cur = con.cursor()
    cur.execute("""
        SELECT d.*, u.username
        FROM detections d
        LEFT JOIN users u ON d.user_id = u.id
        ORDER BY d.created_at DESC LIMIT 2000
    """)
    rows = fetchall(cur); cur.close(); con.close()
    return rows


@app.delete("/admin/detections/{detection_id}")
async def delete_detection(detection_id: int, admin: dict = Depends(get_admin_user)):
    con = db_conn(); cur = con.cursor()
    try:
        cur.execute("DELETE FROM detections WHERE id=%s", (detection_id,))
        con.commit(); return {"message": "Deleted"}
    finally:
        cur.close(); con.close()


@app.get("/admin/feedback")
async def admin_list_feedback(admin: dict = Depends(get_admin_user)):
    con = db_conn(); cur = con.cursor()
    cur.execute("""
        SELECT f.id, f.user_id, f.username, f.email, f.rating,
               f.category, f.message, f.created_at,
               u.username AS registered_username
        FROM feedback f
        LEFT JOIN users u ON f.user_id = u.id
        ORDER BY f.created_at DESC
    """)
    rows = fetchall(cur); cur.close(); con.close()
    return rows


@app.delete("/admin/feedback/{feedback_id}")
async def delete_feedback(feedback_id: int, admin: dict = Depends(get_admin_user)):
    con = db_conn(); cur = con.cursor()
    try:
        cur.execute("DELETE FROM feedback WHERE id=%s", (feedback_id,))
        con.commit(); return {"message": "Deleted"}
    finally:
        cur.close(); con.close()


@app.get("/admin/sessions")
async def admin_list_sessions(admin: dict = Depends(get_admin_user)):
    con = db_conn(); cur = con.cursor()
    cur.execute("""
        SELECT st.*, u.username
        FROM session_timeline st
        LEFT JOIN users u ON st.user_id = u.id
        ORDER BY st.started_at DESC LIMIT 2000
    """)
    rows = fetchall(cur); cur.close(); con.close()
    return rows


@app.delete("/admin/sessions/{session_row_id}")
async def delete_session_row(session_row_id: int, admin: dict = Depends(get_admin_user)):
    con = db_conn(); cur = con.cursor()
    try:
        cur.execute("DELETE FROM session_timeline WHERE id=%s", (session_row_id,))
        con.commit(); return {"message": "Deleted"}
    finally:
        cur.close(); con.close()


@app.get("/admin/faq-feedback")
async def admin_faq_feedback(admin: dict = Depends(get_admin_user)):
    con = db_conn(); cur = con.cursor()
    cur.execute("""
        SELECT f.id, f.faq_question, f.vote, f.complaint, f.created_at,
               u.username
        FROM faq_feedback f
        LEFT JOIN users u ON f.user_id = u.id
        ORDER BY f.created_at DESC
    """)
    rows = fetchall(cur); cur.close(); con.close()
    return rows


@app.delete("/admin/faq-feedback/{row_id}")
async def delete_faq_feedback_row(row_id: int, admin: dict = Depends(get_admin_user)):
    con = db_conn(); cur = con.cursor()
    try:
        cur.execute("DELETE FROM faq_feedback WHERE id=%s", (row_id,))
        con.commit(); return {"message": "Deleted"}
    finally:
        cur.close(); con.close()

def _save_detection(user_id: int, session_id: Optional[str], result: dict, source: str = "webcam"):
    try:
        con = db_conn(); cur = con.cursor()
        cur.execute(
            "INSERT INTO detections (user_id, emotion, confidence, engagement, source, all_probs) "
            "VALUES (%s,%s,%s,%s,%s,%s)",
            (
                user_id, result["emotion"], result["confidence"],
                result["engagement"], source,
                json.dumps(result.get("all_probabilities", []))
            )
        )
        con.commit(); cur.close(); con.close()
    except Exception as e:
        print(f"[EmotionAI] _save_detection error: {e}")


def _save_session_timeline(session_id, user_id, source, timeline_data, avg_engagement, dominant_emotion):
    try:
        con = db_conn(); cur = con.cursor()
        for entry in timeline_data:
            cur.execute(
                """INSERT INTO session_timeline
                   (session_id, user_id, source, time_offset, emotion, engagement,
                    average_engagement, dominant_emotion, frame_count)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (
                    session_id, user_id, source,
                    entry.get("time", 0), entry["emotion"], entry["engagement"],
                    avg_engagement, dominant_emotion, 1
                )
            )
        con.commit(); cur.close(); con.close()
    except Exception as e:
        print(f"[EmotionAI] _save_session_timeline error: {e}")


# =============================================================================
#  FRONTEND ROUTES
# =============================================================================

BASE_DIR     = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BASE_DIR)

FRONTEND_DIR: str = ""
for _name in ("frontend", "Frontend", "front-end", "Front-End"):
    _candidate = os.path.join(PROJECT_ROOT, _name)
    if os.path.isdir(_candidate):
        FRONTEND_DIR = _candidate
        break

if not FRONTEND_DIR:
    raise RuntimeError(
        f"\n\n  Frontend folder not found under: {PROJECT_ROOT}\n"
        "  Expected one of: frontend / Frontend / front-end / Front-End\n"
    )

print(f"[EmotionAI] Frontend: {FRONTEND_DIR}")


@app.get("/")
async def root():
    return FileResponse(os.path.join(FRONTEND_DIR, "login.html"))

@app.get("/home")
@app.get("/index.html")
async def landing_page():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

@app.get("/app")
@app.get("/app.html")
async def app_page():
    return RedirectResponse(url="/livecam", status_code=302)

@app.get("/login")
@app.get("/login.html")
async def login_page():
    return FileResponse(os.path.join(FRONTEND_DIR, "login.html"))

@app.get("/faq")
@app.get("/faq.html")
async def faq_page():
    return FileResponse(os.path.join(FRONTEND_DIR, "faq.html"))

@app.get("/feedback")
@app.get("/feedback.html")
async def feedback_page():
    return FileResponse(os.path.join(FRONTEND_DIR, "feedback.html"))

@app.get("/admin")
@app.get("/admin.html")
async def admin_page():
    return FileResponse(os.path.join(FRONTEND_DIR, "admin.html"))

@app.get("/detect")
@app.get("/detect.html")
async def detect_page():
    return FileResponse(os.path.join(FRONTEND_DIR, "detect.html"))

@app.get("/livecam")
@app.get("/livecam.html")
async def livecam_page():
    return FileResponse(os.path.join(FRONTEND_DIR, "livecam.html"))

@app.get("/logout")
async def logout():
    response = RedirectResponse(url="/", status_code=302)
    response.delete_cookie("ea_session")
    response.delete_cookie("ea_cookie_consent")
    return response

# Static mount MUST be last
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")


# =============================================================================
#  ENTRY
# =============================================================================

if __name__ == "__main__":
    uvicorn.run(app, host=APP_HOST, port=APP_PORT)