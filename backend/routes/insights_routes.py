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

