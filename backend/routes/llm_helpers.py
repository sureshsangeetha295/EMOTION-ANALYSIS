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

