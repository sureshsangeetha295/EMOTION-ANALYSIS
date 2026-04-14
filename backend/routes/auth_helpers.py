from __future__ import annotations
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import re  # noqa: F401
    import psycopg2  # noqa: F401
    from datetime import datetime, timedelta, timezone  # noqa: F401
    from typing import Optional  # noqa: F401
    from jose import jwt, JWTError  # noqa: F401
    from passlib.context import CryptContext  # noqa: F401
    from routes.config import (  # noqa: F401
        SECRET_KEY, ALGORITHM, DB_DSN,
        ACCESS_TOKEN_EXPIRE_MINUTES, REFRESH_TOKEN_EXPIRE_DAYS,
    )
    pwd_ctx: CryptContext  # defined inline in main.py before this fragment


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