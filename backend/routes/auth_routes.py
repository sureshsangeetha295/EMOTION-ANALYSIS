from __future__ import annotations
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import re  # noqa: F401
    from datetime import datetime  # noqa: F401
    from typing import Optional  # noqa: F401
    import numpy as np  # noqa: F401
    from fastapi import Depends, HTTPException  # noqa: F401
    from fastapi.security import OAuth2PasswordRequestForm  # noqa: F401
    from jose import JWTError  # noqa: F401
    from routes.config import EMOTION_LABELS  # noqa: F401
    from routes.auth_helpers import (  # noqa: F401
        db_conn, fetchone,
        hash_password, verify_password,
        create_access_token, create_refresh_token, decode_token,
        validate_password_strength, validate_username,
    )
    from routes.app_setup import (  # noqa: F401
        app, get_current_user,
        RegisterRequest, RefreshRequest,
    )
    # emotion_to_engagement is defined inline in main.py before this fragment
    def emotion_to_engagement(emotion: str) -> float: ...


def run_pipeline(img_rgb: "np.ndarray", use_mtcnn: bool = False):
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