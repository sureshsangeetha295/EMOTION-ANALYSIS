from __future__ import annotations
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    import re  # noqa: F401
    from datetime import datetime  # noqa: F401
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
            "INSERT INTO users (username, email, password_hash) "
            "VALUES (%s,%s,%s)",
            (username, email_clean, hash_password(body.password))
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

# ============================================================
#  NEW: reCAPTCHA Verification Helper
# ============================================================

async def verify_recaptcha(token: Optional[str]) -> bool:
    """Verify reCAPTCHA v2 token with Google."""
    import httpx
    from routes.config import RECAPTCHA_SECRET_KEY
    if not token:
        return False
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://www.google.com/recaptcha/api/siteverify",
            data={"secret": RECAPTCHA_SECRET_KEY, "response": token}
        )
        result = resp.json()
        return result.get("success", False)


# ============================================================
#  NEW: Login with reCAPTCHA verification
# ============================================================

from pydantic import BaseModel as _BaseModel

class LoginWithCaptchaRequest(_BaseModel):
    email:            str
    password:         str
    recaptcha_token:  str

@app.post("/auth/login-captcha")
async def login_with_captcha(body: LoginWithCaptchaRequest):
    """Login endpoint that verifies reCAPTCHA before authenticating."""
    # 1. Verify reCAPTCHA
    ok = await verify_recaptcha(body.recaptcha_token)
    if not ok:
        raise HTTPException(status_code=400, detail="reCAPTCHA verification failed. Please try again.")

    # 2. Normal login
    con = db_conn(); cur = con.cursor()
    try:
        cur.execute("SELECT * FROM users WHERE LOWER(email)=%s", (body.email.strip().lower(),))
        row = fetchone(cur)
        if not row or not verify_password(body.password, row["password_hash"]):
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


# ============================================================
#  NEW: OTP Password Reset Routes
# ============================================================

from datetime import datetime, timedelta, timezone as _tz
from routes.otp_email import generate_otp, send_otp_email

class OtpRequestBody(_BaseModel):
    email: str

class OtpVerifyBody(_BaseModel):
    email: str
    otp:   str

class OtpResetBody(_BaseModel):
    email:        str
    otp:          str
    new_password: str


@app.post("/auth/otp/send")
async def send_otp(body: OtpRequestBody):
    """Step 1: User enters email → send OTP to that email."""
    email_clean = body.email.strip().lower()
    con = db_conn(); cur = con.cursor()
    try:
        cur.execute("SELECT id, username, email FROM users WHERE LOWER(email)=%s", (email_clean,))
        row = fetchone(cur)
        if not row:
            # Don't reveal if email exists — always say success
            return {"message": "If that email is registered, an OTP has been sent."}

        otp     = generate_otp()
        expires = datetime.now(_tz.utc) + timedelta(minutes=10)

        cur.execute(
            "UPDATE users SET otp_code=%s, otp_expires=%s WHERE id=%s",
            (otp, expires, row["id"])
        )
        con.commit()

        sent = send_otp_email(row["email"], otp, row["username"])
        if not sent:
            raise HTTPException(status_code=500, detail="Failed to send OTP email. Check SMTP settings.")

        return {"message": "OTP sent to your email. Valid for 10 minutes."}
    finally:
        cur.close(); con.close()


@app.post("/auth/otp/verify")
async def verify_otp(body: OtpVerifyBody):
    """Step 2: Verify OTP is correct and not expired."""
    email_clean = body.email.strip().lower()
    con = db_conn(); cur = con.cursor()
    try:
        cur.execute(
            "SELECT id, otp_code, otp_expires FROM users WHERE LOWER(email)=%s",
            (email_clean,)
        )
        row = fetchone(cur)
        if not row or not row["otp_code"]:
            raise HTTPException(status_code=400, detail="No OTP was requested for this email.")

        # Check expiry
        now = datetime.now(_tz.utc)
        expires = row["otp_expires"]
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=_tz.utc)
        if now > expires:
            raise HTTPException(status_code=400, detail="OTP has expired. Please request a new one.")

        if body.otp.strip() != row["otp_code"]:
            raise HTTPException(status_code=400, detail="Incorrect OTP. Please try again.")

        return {"message": "OTP verified successfully."}
    finally:
        cur.close(); con.close()


@app.post("/auth/otp/reset-password")
async def otp_reset_password(body: OtpResetBody):
    """Step 3: Verify OTP again and set new password."""
    email_clean = body.email.strip().lower()

    pw_err = validate_password_strength(body.new_password)
    if pw_err:
        raise HTTPException(status_code=400, detail=pw_err)

    con = db_conn(); cur = con.cursor()
    try:
        cur.execute(
            "SELECT id, otp_code, otp_expires FROM users WHERE LOWER(email)=%s",
            (email_clean,)
        )
        row = fetchone(cur)
        if not row or not row["otp_code"]:
            raise HTTPException(status_code=400, detail="No active OTP session. Please start over.")

        now = datetime.now(_tz.utc)
        expires = row["otp_expires"]
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=_tz.utc)
        if now > expires:
            raise HTTPException(status_code=400, detail="OTP expired. Please request a new one.")
        if body.otp.strip() != row["otp_code"]:
            raise HTTPException(status_code=400, detail="Incorrect OTP.")

        # Update password and clear OTP
        new_hash = hash_password(body.new_password)
        cur.execute(
            "UPDATE users SET password_hash=%s, otp_code=NULL, otp_expires=NULL WHERE id=%s",
            (new_hash, row["id"])
        )
        con.commit()
        return {"message": "Password reset successfully."}
    finally:
        cur.close(); con.close()


# ============================================================
#  NEW: Google OAuth Routes
# ============================================================

@app.get("/auth/google/login")
async def google_login():
    """Redirect user to Google consent screen."""
    from routes.config import GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI
    from urllib.parse import urlencode
    params = urlencode({
        "client_id":     GOOGLE_CLIENT_ID,
        "redirect_uri":  GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope":         "openid email profile",
        "access_type":   "offline",
        "prompt":        "select_account",
    })
    from fastapi.responses import RedirectResponse
    return RedirectResponse(f"https://accounts.google.com/o/oauth2/auth?{params}")


@app.get("/auth/google/callback")
async def google_callback(code: Optional[str] = None, error: Optional[str] = None):
    """Google redirects here with a code. Exchange for tokens, log user in."""
    import httpx
    from routes.config import GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
    from fastapi.responses import RedirectResponse

    # Handle cases where Google sends back an error instead of a code
    # e.g. redirect_uri_mismatch, access_denied, etc.
    if error or not code:
        reason = error or "missing_code"
        return RedirectResponse(f"http://localhost:5500/login.html?google_error={reason}")

    # 1. Exchange code for tokens
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code":          code,
                "client_id":     GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "redirect_uri":  GOOGLE_REDIRECT_URI,
                "grant_type":    "authorization_code",
            }
        )
        token_data = token_resp.json()
        if "error" in token_data:
            raise HTTPException(status_code=400, detail="Google OAuth failed: " + token_data.get("error_description", ""))

        # 2. Get user info from Google
        userinfo_resp = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {token_data['access_token']}"}
        )
        guser = userinfo_resp.json()

    google_id = guser.get("id")
    email     = guser.get("email", "").lower()
    gname     = guser.get("name", email.split("@")[0])

    if not email:
        raise HTTPException(status_code=400, detail="Could not get email from Google.")

    con = db_conn(); cur = con.cursor()
    try:
        # 3. Check if user exists
        cur.execute("SELECT * FROM users WHERE LOWER(email)=%s", (email,))
        row = fetchone(cur)

        if row:
            # Update google_id if not set
            if not row.get("google_id"):
                cur.execute("UPDATE users SET google_id=%s WHERE id=%s", (google_id, row["id"]))
                con.commit()
            user_id  = row["id"]
            is_admin = bool(row["is_admin"])
        else:
            # Auto-create account for new Google user
            import re
            username = re.sub(r"[^A-Za-z0-9._-]", "_", gname)[:30] or "user"
            # Make username unique
            base = username; suffix = 1
            while True:
                cur.execute("SELECT id FROM users WHERE username=%s", (username,))
                if not cur.fetchone(): break
                username = f"{base}{suffix}"; suffix += 1

            # No password for Google-only accounts (they can set one later)
            import secrets
            dummy_hash = hash_password(secrets.token_urlsafe(32))

            cur.execute(
                "INSERT INTO users (username, email, password_hash, google_id) VALUES (%s,%s,%s,%s) RETURNING id",
                (username, email, dummy_hash, google_id)
            )
            user_id  = cur.fetchone()[0]
            is_admin = False
            con.commit()

        # 4. Create JWT tokens
        access_token  = create_access_token(user_id, is_admin=is_admin)
        refresh_token = create_refresh_token(user_id)

        # 5. Redirect to frontend with tokens in URL fragment
        redirect_url = (
            f"http://localhost:5500/login.html"
            f"?google_login=1"
            f"#access={access_token}&refresh={refresh_token}&admin={'1' if is_admin else '0'}"
        )
        return RedirectResponse(redirect_url)
    finally:
        cur.close(); con.close()