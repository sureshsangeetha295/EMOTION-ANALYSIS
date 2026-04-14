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