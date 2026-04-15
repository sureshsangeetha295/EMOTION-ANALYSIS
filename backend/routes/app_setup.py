from __future__ import annotations
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import webbrowser  # noqa: F401
    from concurrent.futures import ThreadPoolExecutor  # noqa: F401
    from typing import Optional  # noqa: F401
    from fastapi import FastAPI, Depends, HTTPException  # noqa: F401
    from fastapi.middleware.cors import CORSMiddleware  # noqa: F401
    from fastapi.security import OAuth2PasswordBearer  # noqa: F401
    from pydantic import BaseModel  # noqa: F401
    from jose import JWTError  # noqa: F401
    from routes.config import APP_PORT  # noqa: F401
    from routes.auth_helpers import db_conn, fetchone, decode_token  # noqa: F401
    from routes.db import init_db  # noqa: F401


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