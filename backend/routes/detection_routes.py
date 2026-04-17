"created_at":          current["created_at"],
        "last_login":          current["last_login"],
        "password_reset_hash": current.get("password_reset_hash"),
    }



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