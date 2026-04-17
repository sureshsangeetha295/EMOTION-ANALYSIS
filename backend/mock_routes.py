# =============================================================================
#  mock_routes.py  —  Mock Presentation / Interview / Speech / Meeting
#  Integrates: Groq Whisper STT + Librosa (voice analysis) + Facial Emotion + LLM
# =============================================================================

import os
import io
import json
import uuid
import tempfile
import asyncio
import traceback
from typing import Optional
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import requests
import librosa
from fastapi import APIRouter, UploadFile, File, Query, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# ---------------------------------------------------------------------------
#  Load .env so GROQ_API_KEY is available whether this module is imported
#  standalone (tests) or via main.py which may load .env after this import.
# ---------------------------------------------------------------------------
try:
    from dotenv import load_dotenv as _load_dotenv
    _ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(_ENV_PATH):
        _load_dotenv(dotenv_path=_ENV_PATH, override=False)  # override=False: don't stomp main.py
except ImportError:
    pass  # python-dotenv not installed — rely on env vars being set externally

# ---------------------------------------------------------------------------
#  Project imports
#  (comment out any that aren't wired yet; stubs below ensure Pylance is happy)
# ---------------------------------------------------------------------------
# from routes.auth_helpers import get_current_user     # ← your JWT guard

try:
    from face_pipeline import run_pipeline as _run_pipeline          # type: ignore[import-untyped]
    _FACE_PIPELINE_AVAILABLE = True
except ImportError:
    _run_pipeline = None                                              # type: ignore[assignment]
    _FACE_PIPELINE_AVAILABLE = False

try:
    from routes.llm_helpers import SessionEngagementTracker, EMOTION_TONE  # type: ignore[import-untyped]
    _LLM_HELPERS_AVAILABLE = True
except ImportError:
    SessionEngagementTracker = None                                   # type: ignore[assignment,misc]
    EMOTION_TONE = {}                                                 # type: ignore[assignment]
    _LLM_HELPERS_AVAILABLE = False

# ---------------------------------------------------------------------------
#  Router
# ---------------------------------------------------------------------------
router = APIRouter(prefix="/mock", tags=["Mock Sessions"])

_executor = ThreadPoolExecutor(max_workers=4)


# =============================================================================
#  GROQ WHISPER STT  —  No local RAM needed, runs on Groq's servers
# =============================================================================

def _compress_audio_for_groq(input_path: str) -> str:
    """
    Compress audio to 16kHz mono MP3 (32kbps) using ffmpeg so it stays
    well under Groq's 25 MB limit.  Returns path to the compressed file
    (caller is responsible for deleting it).  Falls back to the original
    path if ffmpeg is not available.
    """
    import shutil
    import subprocess

    if not shutil.which("ffmpeg"):
        print("[MockAI] ffmpeg not found — sending original audio (may exceed 25 MB limit).")
        return input_path

    out_fd, out_path = tempfile.mkstemp(suffix=".mp3")
    os.close(out_fd)

    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", input_path,
                "-ar", "16000",   # 16 kHz – enough for speech
                "-ac", "1",       # mono
                "-b:a", "32k",    # 32 kbps ≈ ~14 MB/hour of audio
                "-f", "mp3",
                out_path,
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        compressed_mb = os.path.getsize(out_path) / (1024 * 1024)
        original_mb   = os.path.getsize(input_path) / (1024 * 1024)
        print(f"[MockAI] Compressed audio: {original_mb:.1f} MB → {compressed_mb:.1f} MB")
        return out_path
    except subprocess.CalledProcessError as e:
        print(f"[MockAI] ffmpeg compression failed ({e}) — sending original.")
        try:
            os.unlink(out_path)
        except OSError:
            pass
        return input_path


def _transcribe_groq(audio_path: str) -> str:
    """
    Transcribe audio using Groq's Whisper API.
    Uses GROQ_API_KEY from environment — same key used for LLM analysis.
    Supports: mp3, mp4, mpeg, mpga, m4a, wav, webm (max 25 MB).

    Audio is automatically compressed to 16kHz mono MP3 via ffmpeg before
    sending, so large WAV / WEBM recordings no longer trigger a 413 error.
    """
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        print("[MockAI] GROQ_API_KEY not set — skipping transcription.")
        return ""

    compressed_path = _compress_audio_for_groq(audio_path)
    cleanup_compressed = compressed_path != audio_path  # only delete if we made a new file

    try:
        file_mb = os.path.getsize(compressed_path) / (1024 * 1024)
        if file_mb > 24.5:
            print(f"[MockAI] Warning: compressed audio is still {file_mb:.1f} MB — Groq may reject it.")

        with open(compressed_path, "rb") as f:
            res = requests.post(
                "https://api.groq.com/openai/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {api_key}"},
                files={"file": (os.path.basename(compressed_path), f, "audio/mpeg")},
                data={
                    "model":    "whisper-large-v3-turbo",
                    "language": "en",
                },
                timeout=60,
            )
        res.raise_for_status()
        text = res.json().get("text", "").strip()
        print(f"[MockAI] Groq transcript: {text[:120]}…")
        return text
    except requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else "?"
        if status == 401:
            print(f"[MockAI] Groq STT error: 401 Unauthorized — "
                  f"GROQ_API_KEY is invalid or expired. "
                  f"Generate a new key at https://console.groq.com and update your .env")
        elif status == 429:
            print(f"[MockAI] Groq STT error: 429 Rate-limit — wait a moment and retry.")
        else:
            print(f"[MockAI] Groq STT error: {e}")
        return ""
    except Exception as e:
        print(f"[MockAI] Groq STT error: {e}")
        return ""
    finally:
        if cleanup_compressed:
            try:
                os.unlink(compressed_path)
            except OSError:
                pass


# =============================================================================
#  Pydantic schemas
# =============================================================================

class MockAnalysisRequest(BaseModel):
    session_id: str
    mode: str                           # "presentation" | "interview" | "speech" | "meeting"
    topic: Optional[str] = ""           # topic / question the user spoke about
    transcript: Optional[str] = ""      # pre-computed transcript (optional)
    voice_metrics: Optional[dict] = {}  # pre-computed librosa metrics (optional)
    emotion_summary: Optional[dict] = {}
    engagement_score: Optional[float] = 0.0
    duration_seconds: Optional[float] = 0.0


class MockSessionResult(BaseModel):
    session_id: str
    mode: str
    transcript: str
    voice_metrics: dict
    emotion_summary: dict
    engagement_score: float
    scores: dict          # overall + per-dimension scores (0-100)
    feedback: dict        # per-dimension textual feedback
    tips: list            # actionable tips
    report_html: str      # full HTML report string


# =============================================================================
#  VOICE ANALYSIS  —  Librosa
# =============================================================================

def analyse_voice(audio_path: str) -> dict:
    """
    Extract voice quality metrics from an audio file using Librosa.

    Returns a dict with:
      - speaking_rate_wpm    : estimated words per minute (via onset density)
      - pitch_mean_hz        : mean fundamental frequency
      - pitch_std_hz         : pitch variation (monotone ↔ expressive)
      - energy_mean          : average RMS energy (loudness)
      - energy_std           : loudness variation
      - silence_ratio        : fraction of time below energy threshold (gaps)
      - pause_count          : number of distinct silent gaps > 0.3 s
      - avg_pause_duration_s : mean pause length in seconds
      - spectral_centroid    : brightness / clarity of voice
      - zcr_mean             : zero-crossing rate (voice quality indicator)
      - duration_s           : total audio duration in seconds
    """
    try:
        y, sr = librosa.load(audio_path, sr=None, mono=True)
        duration = librosa.get_duration(y=y, sr=sr)

        # ── Pitch (F0) via piptrack ────────────────────────────────────────
        pitches, magnitudes = librosa.piptrack(y=y, sr=sr)
        pitch_vals = []
        for t in range(pitches.shape[1]):
            idx = magnitudes[:, t].argmax()
            p = pitches[idx, t]
            if p > 60:  # voiced frames only (> 60 Hz)
                pitch_vals.append(p)
        pitch_mean = float(np.mean(pitch_vals)) if pitch_vals else 0.0
        pitch_std  = float(np.std(pitch_vals))  if pitch_vals else 0.0

        # ── RMS Energy ────────────────────────────────────────────────────
        rms = librosa.feature.rms(y=y)[0]
        energy_mean = float(np.mean(rms))
        energy_std  = float(np.std(rms))

        # ── Silence / Pauses ──────────────────────────────────────────────
        silence_threshold = energy_mean * 0.15        # adaptive threshold
        is_silent         = rms < silence_threshold
        silence_ratio     = float(np.mean(is_silent))

        # Detect contiguous silent segments > 0.3 s
        hop_length   = 512
        frame_dur    = hop_length / sr                # seconds per frame
        pause_count  = 0
        pause_lens   = []
        in_pause     = False
        pause_frames = 0
        min_frames   = int(0.3 / frame_dur)

        for silent in is_silent:
            if silent:
                in_pause = True
                pause_frames += 1
            else:
                if in_pause and pause_frames >= min_frames:
                    pause_count += 1
                    pause_lens.append(pause_frames * frame_dur)
                in_pause = False
                pause_frames = 0
        if in_pause and pause_frames >= min_frames:
            pause_count += 1
            pause_lens.append(pause_frames * frame_dur)

        avg_pause = float(np.mean(pause_lens)) if pause_lens else 0.0

        # ── Speaking rate (onset-based WPM estimate) ───────────────────────
        onsets = librosa.onset.onset_detect(y=y, sr=sr, units="time")
        speaking_time = max(0.01, duration * (1 - silence_ratio))
        # ~2 onsets per syllable, ~1.5 syllables per word on average
        estimated_wpm = len(onsets) / 2.0 / 1.5 / (speaking_time / 60.0)
        estimated_wpm = min(estimated_wpm, 300)  # cap at 300 WPM

        # ── Spectral centroid ─────────────────────────────────────────────
        sc = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
        spec_centroid = float(np.mean(sc))

        # ── ZCR ───────────────────────────────────────────────────────────
        zcr = librosa.feature.zero_crossing_rate(y)[0]
        zcr_mean = float(np.mean(zcr))

        return {
            "speaking_rate_wpm":    round(estimated_wpm, 1),
            "pitch_mean_hz":        round(pitch_mean, 1),
            "pitch_std_hz":         round(pitch_std, 1),
            "energy_mean":          round(energy_mean, 5),
            "energy_std":           round(energy_std, 5),
            "silence_ratio":        round(silence_ratio, 3),
            "pause_count":          pause_count,
            "avg_pause_duration_s": round(avg_pause, 2),
            "spectral_centroid":    round(spec_centroid, 1),
            "zcr_mean":             round(zcr_mean, 4),
            "duration_s":           round(duration, 2),
        }
    except Exception as e:
        print(f"[MockAI] Librosa error: {e}")
        return {
            "speaking_rate_wpm": 0, "pitch_mean_hz": 0, "pitch_std_hz": 0,
            "energy_mean": 0, "energy_std": 0, "silence_ratio": 0,
            "pause_count": 0, "avg_pause_duration_s": 0,
            "spectral_centroid": 0, "zcr_mean": 0, "duration_s": 0,
            "error": str(e),
        }


# =============================================================================
#  VOICE SCORES  —  Convert librosa metrics → 0-100 dimension scores
# =============================================================================

def score_voice(vm: dict, mode: str) -> dict:
    """
    Convert raw librosa metrics into 0-100 scores for each voice dimension.
    Thresholds are calibrated per mode (presentation, interview, speech, meeting).
    """
    # ── Speaking Rate ─────────────────────────────────────────────────────
    wpm = vm.get("speaking_rate_wpm", 0)
    ideal_low  = {"presentation": 110, "interview": 100, "speech": 105, "meeting": 100}.get(mode, 105)
    ideal_high = {"presentation": 155, "interview": 140, "speech": 150, "meeting": 145}.get(mode, 145)
    if ideal_low <= wpm <= ideal_high:
        pace_score = 95
    elif wpm < ideal_low:
        pace_score = max(20, 95 - (ideal_low - wpm) * 1.2)
    else:
        pace_score = max(20, 95 - (wpm - ideal_high) * 1.5)

    # ── Pitch Variation (Monotone ↔ Expressive) ───────────────────────────
    p_std = vm.get("pitch_std_hz", 0)
    if 25 <= p_std <= 80:
        pitch_score = 95
    elif p_std < 25:
        pitch_score = max(25, 95 - (25 - p_std) * 2.5)
    else:
        pitch_score = max(40, 95 - (p_std - 80) * 0.5)

    # ── Volume / Energy ───────────────────────────────────────────────────
    energy = vm.get("energy_mean", 0)
    # Normalise to 0-100 using typical RMS range (0.01–0.15)
    energy_score = min(100, max(20, (energy / 0.08) * 80))

    # ── Pause Handling ────────────────────────────────────────────────────
    silence = vm.get("silence_ratio", 0)
    pauses  = vm.get("pause_count", 0)
    avg_p   = vm.get("avg_pause_duration_s", 0)
    # Good: 10-30% silence with pauses < 2 s avg
    if 0.10 <= silence <= 0.30 and avg_p < 2.0:
        pause_score = 90
    elif silence > 0.45 or avg_p > 3.5:
        pause_score = max(20, 90 - (silence - 0.30) * 150 - max(0, avg_p - 2) * 15)
    elif silence < 0.05:
        pause_score = 65  # no pauses = no breath = nervous
    else:
        pause_score = 75

    # ── Clarity (spectral centroid normalised) ────────────────────────────
    sc = vm.get("spectral_centroid", 0)
    clarity_score = min(95, max(30, (sc / 3500) * 95)) if sc > 0 else 50

    return {
        "pace":    round(min(100, max(0, pace_score))),
        "pitch":   round(min(100, max(0, pitch_score))),
        "volume":  round(min(100, max(0, energy_score))),
        "pauses":  round(min(100, max(0, pause_score))),
        "clarity": round(min(100, max(0, clarity_score))),
    }


# =============================================================================
#  FACIAL EMOTION → PRESENTATION SCORE
# =============================================================================

def score_emotion_for_mode(emotion_summary: dict, mode: str) -> dict:
    """
    Convert emotion distribution into a confidence score (0-100).
    Ideal emotion mix varies by mode.
    """
    pos = emotion_summary.get("positive", 0)  # %
    neg = emotion_summary.get("negative", 0)
    neu = emotion_summary.get("neutral",  0)

    ideal = {
        "presentation": {"pos": 55, "neu": 35, "neg": 10},
        "interview":    {"pos": 50, "neu": 40, "neg": 10},
        "speech":       {"pos": 60, "neu": 30, "neg": 10},
        "meeting":      {"pos": 40, "neu": 50, "neg": 10},
    }.get(mode, {"pos": 50, "neu": 40, "neg": 10})

    pos_delta   = abs(pos - ideal["pos"])
    neu_delta   = abs(neu - ideal["neu"])
    neg_penalty = max(0, neg - ideal["neg"]) * 1.5

    score = 100 - pos_delta * 0.6 - neu_delta * 0.3 - neg_penalty
    return {"confidence_score": round(min(100, max(0, score)))}


# =============================================================================
#  LLM ANALYSIS  —  Groq + llama-3.1-8b-instant
# =============================================================================

_MODE_LABELS = {
    "presentation": "Presentation",
    "interview":    "Job Interview",
    "speech":       "Public Speech",
    "meeting":      "Business Meeting",
}

_MODE_DIMENSIONS = {
    "presentation": ["Content Clarity", "Delivery Confidence", "Audience Engagement", "Structure & Flow", "Voice Modulation"],
    "interview":    ["Answer Relevance", "Confidence & Composure", "Communication Clarity", "Body Language", "Conciseness"],
    "speech":       ["Opening Impact", "Message Clarity", "Emotional Connection", "Vocal Delivery", "Closing Strength"],
    "meeting":      ["Clarity of Points", "Professionalism", "Active Participation", "Listening Signals", "Constructiveness"],
}


def call_llm_mock_analysis(
    mode: str,
    topic: str,
    transcript: str,
    voice_scores: dict,
    voice_metrics: dict,
    emotion_scores: dict,
    engagement_pct: int,
    overall_score: int,
) -> dict:
    """
    Send all three signals (transcript, voice, emotion) to Groq LLM
    and get back structured scores, feedback, tips, and an HTML report.
    """
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        return _fallback_response(mode, overall_score)

    mode_label = _MODE_LABELS.get(mode, "Presentation")
    dimensions = _MODE_DIMENSIONS.get(mode, _MODE_DIMENSIONS["presentation"])

    # ── Voice narrative ───────────────────────────────────────────────────
    wpm      = voice_metrics.get("speaking_rate_wpm", 0)
    p_std    = voice_metrics.get("pitch_std_hz", 0)
    silence  = round(voice_metrics.get("silence_ratio", 0) * 100)
    pauses   = voice_metrics.get("pause_count", 0)
    avg_p    = voice_metrics.get("avg_pause_duration_s", 0)
    duration = voice_metrics.get("duration_s", 0)

    pace_verdict  = "appropriate pace" if 100 <= wpm <= 160 else ("too fast" if wpm > 160 else "too slow")
    pitch_verdict = "good variation" if 25 <= p_std <= 80 else ("monotone" if p_std < 25 else "over-dramatic variation")
    pause_verdict = "well-structured pauses" if 0.10 <= silence / 100 <= 0.30 else ("too many pauses" if silence > 30 else "insufficient pauses")

    system_msg = f"""You are MockCoach, an expert {mode_label} coach and communication trainer.
You have just observed a candidate's {mode_label.lower()} session using three signals:
1. Speech transcript (what they said)
2. Voice modulation metrics (how they said it)
3. Facial emotion data (how they appeared)

Your job is to produce ONLY valid JSON with this exact structure (no markdown, no code fences):
{{
  "dimension_scores": {{
    "Dimension Name": <0-100 integer>,
    ...
  }},
  "feedback": {{
    "Dimension Name": "<one concrete sentence>",
    ...
  }},
  "strengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
  "tips": [
    {{"priority": "high",   "tip": "<specific actionable tip>"}},
    {{"priority": "high",   "tip": "<specific actionable tip>"}},
    {{"priority": "medium", "tip": "<specific actionable tip>"}},
    {{"priority": "medium", "tip": "<specific actionable tip>"}},
    {{"priority": "low",    "tip": "<specific actionable tip>"}}
  ],
  "coach_summary": "<3-4 sentence direct coach message to the candidate — warm, honest, specific>",
  "overall_verdict": "<one bold verdict line: e.g. 'Strong candidate — minor refinements needed'>"
}}

Dimensions to score: {json.dumps(dimensions)}
Rules:
- Base dimension scores on ALL THREE signals (transcript quality + voice metrics + emotion)
- Be specific — mention actual numbers from the data
- Tips must be immediately actionable, not generic
- Never invent data not in the prompt
- Return ONLY the JSON object"""

    user_msg = f"""=== SESSION DATA ===

MODE: {mode_label}
TOPIC / QUESTION: {topic or "General practice session"}
DURATION: {round(duration)}s

=== TRANSCRIPT (Groq Whisper STT) ===
{transcript or "(No speech detected)"}

=== VOICE MODULATION (Librosa) ===
Speaking Rate : {wpm} WPM → {pace_verdict}
Pitch Variation: {p_std} Hz std → {pitch_verdict}
Silence Ratio : {silence}% of audio → {pause_verdict}
Pause Count   : {pauses} pauses (avg {avg_p}s each)
Energy Mean   : {voice_metrics.get('energy_mean', 0):.5f}
Spectral Clarity: {voice_metrics.get('spectral_centroid', 0):.0f} Hz

Voice Dimension Scores (0-100):
- Pace   : {voice_scores.get('pace', 0)}
- Pitch  : {voice_scores.get('pitch', 0)}
- Volume : {voice_scores.get('volume', 0)}
- Pauses : {voice_scores.get('pauses', 0)}
- Clarity: {voice_scores.get('clarity', 0)}

=== FACIAL EMOTION (Trained Model) ===
Engagement Score  : {engagement_pct}%
Confidence Score  : {emotion_scores.get('confidence_score', 50)}%
Positive Emotions : {emotion_scores.get('positive_pct', 0)}%
Neutral Emotions  : {emotion_scores.get('neutral_pct', 0)}%
Negative Emotions : {emotion_scores.get('negative_pct', 0)}%

=== OVERALL PRE-SCORE ===
{overall_score}/100

Generate the full JSON analysis now."""

    url     = "https://api.groq.com/openai/v1/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model":    "llama-3.1-8b-instant",
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user",   "content": user_msg},
        ],
        "max_tokens":      1200,
        "temperature":     0.45,
        "response_format": {"type": "json_object"},
    }

    try:
        res  = requests.post(url, headers=headers, json=payload, timeout=45)
        data = res.json()

        # ── Guard: check for API-level error BEFORE accessing "choices" ──────
        # Groq returns {"error": {"message": "...", "type": "..."}} on failure.
        # Without this check, a 401/429/500 from Groq causes KeyError: 'choices'.
        if not res.ok or "error" in data:
            err_obj  = data.get("error", {})
            err_msg  = err_obj.get("message", "") or str(data)
            err_type = err_obj.get("type", "unknown")
            print(
                f"[MockAI] Groq LLM API error  status={res.status_code}  "
                f"type={err_type}  message={err_msg[:200]}"
            )
            if res.status_code == 401:
                print("[MockAI] HINT: GROQ_API_KEY is invalid or expired — "
                      "generate a new key at https://console.groq.com and update your .env")
            elif res.status_code == 429:
                print("[MockAI] HINT: Groq rate-limit hit — wait a moment and retry.")
            return _fallback_response(mode, overall_score)

        raw = data["choices"][0]["message"]["content"]
        return json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"[MockAI] LLM JSON parse error: {e}")
        return _fallback_response(mode, overall_score)
    except Exception as e:
        print(f"[MockAI] LLM error: {e}\n{traceback.format_exc()}")
        return _fallback_response(mode, overall_score)


def _fallback_response(mode: str, overall_score: int) -> dict:
    dimensions = _MODE_DIMENSIONS.get(mode, _MODE_DIMENSIONS["presentation"])
    return {
        "dimension_scores": {d: overall_score for d in dimensions},
        "feedback":         {d: "Analysis unavailable — LLM offline." for d in dimensions},
        "strengths":        ["Session recorded successfully"],
        "tips": [
            {"priority": "high",   "tip": "Ensure GROQ_API_KEY is set in your .env file to get AI feedback."},
            {"priority": "medium", "tip": "Speak clearly at 100-150 WPM for best results."},
        ],
        "coach_summary":   "LLM analysis could not be completed. Please check your API key.",
        "overall_verdict": "Analysis incomplete",
    }


# =============================================================================
#  SCORE AGGREGATION
# =============================================================================

def compute_overall_score(
    voice_scores: dict,
    emotion_scores: dict,
    engagement_pct: int,
    mode: str,
) -> int:
    """
    Weighted combination:
      - Voice metrics  : 40%
      - Facial emotion : 30%
      - Engagement EMA : 30%
    """
    voice_avg = np.mean(list(voice_scores.values())) if voice_scores else 50
    conf      = emotion_scores.get("confidence_score", 50)
    eng       = engagement_pct

    weights = {"voice": 0.40, "emotion": 0.30, "engagement": 0.30}
    total   = voice_avg * weights["voice"] + conf * weights["emotion"] + eng * weights["engagement"]
    return round(min(100, max(0, total)))


# =============================================================================
#  HTML REPORT GENERATOR
# =============================================================================

def build_html_report(
    mode: str, topic: str, transcript: str,
    voice_metrics: dict, voice_scores: dict,
    emotion_summary: dict, engagement_pct: int,
    overall_score: int, llm: dict,
) -> str:
    dimensions  = _MODE_DIMENSIONS.get(mode, [])
    mode_label  = _MODE_LABELS.get(mode, "Session")
    dim_scores  = llm.get("dimension_scores", {})
    feedback    = llm.get("feedback", {})
    strengths   = llm.get("strengths", [])
    tips        = llm.get("tips", [])
    summary     = llm.get("coach_summary", "")
    verdict     = llm.get("overall_verdict", "")
    score_color = "#22c55e" if overall_score >= 75 else ("#f59e0b" if overall_score >= 50 else "#ef4444")

    def bar(val: int, color: str = "#6366f1") -> str:
        return (
            f'<div style="background:#e5e7eb;border-radius:6px;height:10px;width:100%">'
            f'<div style="background:{color};border-radius:6px;height:10px;width:{val}%"></div></div>'
        )

    dim_rows = ""
    for d in dimensions:
        s = dim_scores.get(d, 0)
        f = feedback.get(d, "")
        c = "#22c55e" if s >= 75 else ("#f59e0b" if s >= 50 else "#ef4444")
        dim_rows += f"""
        <tr>
          <td style="padding:10px;font-weight:600;color:#374151">{d}</td>
          <td style="padding:10px;text-align:center;font-weight:700;color:{c}">{s}</td>
          <td style="padding:10px;width:180px">{bar(s, c)}</td>
          <td style="padding:10px;color:#6b7280;font-size:13px">{f}</td>
        </tr>"""

    tip_rows = ""
    priority_colors = {"high": "#ef4444", "medium": "#f59e0b", "low": "#22c55e"}
    for t in tips:
        p  = t.get("priority", "medium")
        pc = priority_colors.get(p, "#6b7280")
        tip_rows += f"""
        <li style="margin-bottom:10px;padding:10px 14px;background:#f9fafb;border-left:4px solid {pc};border-radius:4px">
          <span style="font-size:11px;font-weight:700;color:{pc};text-transform:uppercase">{p}</span>
          <span style="margin-left:10px;color:#374151">{t.get('tip', '')}</span>
        </li>"""

    strength_items = "".join(
        f'<li style="margin-bottom:6px;color:#374151">✅ {s}</li>' for s in strengths
    )

    voice_grid = f"""
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:16px">
      <div style="background:#f9fafb;padding:14px;border-radius:8px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:#6366f1">{voice_metrics.get('speaking_rate_wpm', 0)}</div>
        <div style="font-size:12px;color:#6b7280">WPM</div>
      </div>
      <div style="background:#f9fafb;padding:14px;border-radius:8px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:#6366f1">{voice_metrics.get('pitch_std_hz', 0):.0f}</div>
        <div style="font-size:12px;color:#6b7280">Pitch Variation (Hz)</div>
      </div>
      <div style="background:#f9fafb;padding:14px;border-radius:8px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:#6366f1">{round(voice_metrics.get('silence_ratio', 0) * 100)}%</div>
        <div style="font-size:12px;color:#6b7280">Silence Ratio</div>
      </div>
      <div style="background:#f9fafb;padding:14px;border-radius:8px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:#6366f1">{voice_metrics.get('pause_count', 0)}</div>
        <div style="font-size:12px;color:#6b7280">Pause Count</div>
      </div>
      <div style="background:#f9fafb;padding:14px;border-radius:8px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:#6366f1">{voice_metrics.get('avg_pause_duration_s', 0):.1f}s</div>
        <div style="font-size:12px;color:#6b7280">Avg Pause Length</div>
      </div>
      <div style="background:#f9fafb;padding:14px;border-radius:8px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:#6366f1">{round(voice_metrics.get('duration_s', 0))}s</div>
        <div style="font-size:12px;color:#6b7280">Duration</div>
      </div>
    </div>"""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MockCoach Report — {mode_label}</title>
<style>
  *{{box-sizing:border-box;margin:0;padding:0}}
  body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f3f4f6;color:#1f2937;padding:24px}}
  .card{{background:#fff;border-radius:12px;padding:24px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,.08)}}
  h1{{font-size:26px;font-weight:700}} h2{{font-size:18px;font-weight:600;margin-bottom:14px;color:#374151}}
  table{{width:100%;border-collapse:collapse}} th{{text-align:left;padding:8px 10px;font-size:13px;color:#9ca3af;border-bottom:2px solid #e5e7eb}}
  tr:not(:last-child) td{{border-bottom:1px solid #f3f4f6}}
  ul{{list-style:none;padding:0}}
  @media print{{body{{background:#fff;padding:0}}.card{{box-shadow:none;border:1px solid #e5e7eb}}}}
</style>
</head>
<body>

<div class="card">
  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
    <div>
      <h1>🎤 MockCoach Report</h1>
      <div style="color:#6b7280;margin-top:4px">{mode_label} · {topic or "General Practice"}</div>
    </div>
    <div style="text-align:center">
      <div style="font-size:52px;font-weight:800;color:{score_color}">{overall_score}</div>
      <div style="font-size:13px;color:#6b7280;font-weight:600">Overall Score / 100</div>
    </div>
  </div>
  {f'<div style="margin-top:20px;padding:16px;background:#f0fdf4;border-radius:8px;border-left:4px solid #22c55e;font-style:italic;color:#374151">"{verdict}"</div>' if verdict else ''}
</div>

<div class="card">
  <h2>📊 Dimension Scores</h2>
  <table>
    <thead><tr><th>Dimension</th><th>Score</th><th style="width:180px">Bar</th><th>Feedback</th></tr></thead>
    <tbody>{dim_rows}</tbody>
  </table>
</div>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
  <div class="card">
    <h2>✅ Strengths</h2>
    <ul>{strength_items}</ul>
  </div>
  <div class="card">
    <h2>🎯 Emotion &amp; Engagement</h2>
    <div style="display:flex;gap:16px;flex-wrap:wrap">
      <div style="text-align:center;flex:1">
        <div style="font-size:32px;font-weight:700;color:#6366f1">{engagement_pct}%</div>
        <div style="font-size:12px;color:#6b7280">EMA Engagement</div>
      </div>
      <div style="text-align:center;flex:1">
        <div style="font-size:32px;font-weight:700;color:#8b5cf6">{emotion_summary.get('positive', 0)}%</div>
        <div style="font-size:12px;color:#6b7280">Positive Emotions</div>
      </div>
      <div style="text-align:center;flex:1">
        <div style="font-size:32px;font-weight:700;color:#ef4444">{emotion_summary.get('negative', 0)}%</div>
        <div style="font-size:12px;color:#6b7280">Negative Emotions</div>
      </div>
    </div>
  </div>
</div>

<div class="card">
  <h2>🎙️ Voice Analysis</h2>
  {voice_grid}
  <div style="margin-top:20px;display:flex;gap:12px;flex-wrap:wrap">
    {''.join(f'<div style="flex:1;min-width:120px;text-align:center;background:#eef2ff;padding:12px;border-radius:8px"><div style="font-size:20px;font-weight:700;color:#6366f1">{voice_scores.get(k, 0)}</div><div style="font-size:12px;color:#6b7280">{k.title()}</div></div>' for k in ["pace", "pitch", "volume", "pauses", "clarity"])}
  </div>
</div>

<div class="card">
  <h2>💡 Actionable Tips</h2>
  <ul>{tip_rows}</ul>
</div>

<div class="card">
  <h2>📝 Transcript</h2>
  <div style="background:#f9fafb;padding:16px;border-radius:8px;font-size:14px;line-height:1.7;color:#374151;max-height:200px;overflow-y:auto">
    {transcript or "<em>No transcript available</em>"}
  </div>
</div>

<div class="card">
  <h2>🤖 Coach Summary</h2>
  <div style="font-size:15px;line-height:1.8;color:#374151;font-style:italic">{summary}</div>
</div>

<div style="text-align:center;color:#9ca3af;font-size:12px;margin-top:12px">
  Generated by MockCoach · EmotionAI Platform
</div>
</body>
</html>"""


# =============================================================================
#  MAIN ENDPOINT  —  POST /mock/analyse
#  Accepts: audio file + optional video file
# =============================================================================

@router.post("/analyse")
async def mock_analyse(
    audio:      UploadFile = File(...),
    video:      Optional[UploadFile] = File(None),
    mode:       str = Query("presentation"),
    topic:      str = Query(""),
    session_id: Optional[str] = Query(None),
    # current: dict = Depends(get_current_user),  # ← uncomment when wiring auth
):
    """
    Full mock session analysis endpoint.

    Inputs
    ------
    audio      : WAV/MP3/M4A/WEBM audio file  (required)
    video      : MP4/WEBM video file           (optional — for facial emotion)
    mode       : presentation | interview | speech | meeting
    topic      : topic / question being practised
    session_id : optional session ID

    Pipeline
    --------
    1. Groq Whisper API → transcript  (no local RAM needed)
    2. Librosa          → voice modulation metrics
    3. Video            → facial emotion (if provided)
    4. Score aggregation
    5. LLM (Groq)       → dimension scores, feedback, tips, report
    6. Return full JSON + HTML report
    """
    sid = session_id or str(uuid.uuid4())

    # ── Save audio to temp file ──────────────────────────────────────────
    audio_bytes = await audio.read()
    suffix      = os.path.splitext(audio.filename or "audio.wav")[1] or ".wav"

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp_audio:
        tmp_audio.write(audio_bytes)
        audio_path = tmp_audio.name

    try:
        loop = asyncio.get_event_loop()

        # ── 1. Groq Whisper STT (no local model loaded) ──────────────────
        transcript = await loop.run_in_executor(
            _executor, lambda: _transcribe_groq(audio_path)
        )
        print(f"[MockAI] Transcript ({len(transcript)} chars): {transcript[:120]}…")

        # ── 2. Librosa voice analysis ────────────────────────────────────
        voice_metrics = await loop.run_in_executor(
            _executor, lambda: analyse_voice(audio_path)
        )
        voice_scores = score_voice(voice_metrics, mode)

        # ── 3. Facial emotion (from video if provided) ───────────────────
        emotion_summary: dict  = {"positive": 50, "neutral": 40, "negative": 10}
        engagement_pct:  int   = 60
        dominant_emotion: str  = "Neutral"

        if video is not None:
            video_bytes = await video.read()
            suffix_v    = os.path.splitext(video.filename or "video.mp4")[1] or ".mp4"
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix_v) as tmp_vid:
                tmp_vid.write(video_bytes)
                video_path = tmp_vid.name
            try:
                emotion_result   = await _analyse_video_emotion(video_path, loop)
                emotion_summary  = emotion_result["tone"]
                engagement_pct   = round(emotion_result["avg_engagement"] * 100)
                dominant_emotion = emotion_result["dominant"]
            except Exception as ve:
                print(f"[MockAI] Video emotion error: {ve}")
            finally:
                try:
                    os.unlink(video_path)
                except OSError:
                    pass

        # ── 4. Score aggregation ─────────────────────────────────────────
        emotion_scores = score_emotion_for_mode(emotion_summary, mode)
        emotion_scores.update({
            "positive_pct": emotion_summary.get("positive", 0),
            "neutral_pct":  emotion_summary.get("neutral", 0),
            "negative_pct": emotion_summary.get("negative", 0),
        })
        overall_score = compute_overall_score(voice_scores, emotion_scores, engagement_pct, mode)

        # ── 5. LLM analysis ──────────────────────────────────────────────
        llm_result = await loop.run_in_executor(
            _executor,
            lambda: call_llm_mock_analysis(
                mode, topic, transcript,
                voice_scores, voice_metrics,
                emotion_scores, engagement_pct, overall_score,
            ),
        )

        # ── 6. Build HTML report ─────────────────────────────────────────
        report_html = build_html_report(
            mode, topic, transcript,
            voice_metrics, voice_scores,
            emotion_summary, engagement_pct,
            overall_score, llm_result,
        )

        # ── Assemble final scores ────────────────────────────────────────
        dim_scores = llm_result.get("dimension_scores", {})
        dim_scores.update({
            "Voice Pace":     voice_scores["pace"],
            "Voice Pitch":    voice_scores["pitch"],
            "Voice Volume":   voice_scores["volume"],
            "Pause Handling": voice_scores["pauses"],
            "Clarity":        voice_scores["clarity"],
            "Engagement":     engagement_pct,
        })

        return JSONResponse({
            "session_id":       sid,
            "mode":             mode,
            "topic":            topic,
            "transcript":       transcript,
            "voice_metrics":    voice_metrics,
            "voice_scores":     voice_scores,
            "emotion_summary":  emotion_summary,
            "dominant_emotion": dominant_emotion,
            "engagement_pct":   engagement_pct,
            "overall_score":    overall_score,
            "scores":           dim_scores,
            "feedback":         llm_result.get("feedback", {}),
            "strengths":        llm_result.get("strengths", []),
            "tips":             llm_result.get("tips", []),
            "coach_summary":    llm_result.get("coach_summary", ""),
            "overall_verdict":  llm_result.get("overall_verdict", ""),
            "report_html":      report_html,
        })

    except Exception as exc:
        print(f"[MockAI] /mock/analyse error: {exc}\n{traceback.format_exc()}")
        return JSONResponse(
            status_code=500,
            content={"error": "analysis_failed", "message": str(exc)},
        )
    finally:
        try:
            os.unlink(audio_path)
        except OSError:
            pass


async def _analyse_video_emotion(video_path: str, loop: asyncio.AbstractEventLoop) -> dict:
    """
    Extract per-frame facial emotions from a video file using run_pipeline()
    from face_pipeline.py.
    """
    if not _FACE_PIPELINE_AVAILABLE or _run_pipeline is None:
        raise RuntimeError(
            "face_pipeline is not installed or could not be imported. "
            "Ensure face_pipeline.py is on the Python path."
        )
    if not _LLM_HELPERS_AVAILABLE or SessionEngagementTracker is None:
        raise RuntimeError(
            "routes.llm_helpers is not installed or could not be imported. "
            "Ensure llm_helpers.py is present under routes/."
        )

    import cv2  # only needed when video is actually provided

    cap            = cv2.VideoCapture(video_path)
    fps            = cap.get(cv2.CAP_PROP_FPS) or 25
    frame_interval = max(1, int(fps))              # sample 1 frame/second
    tracker        = SessionEngagementTracker()
    emotion_counts: dict[str, int] = {}
    frame_idx      = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx % frame_interval == 0:
            img_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            try:
                result, _ = await loop.run_in_executor(
                    _executor,
                    lambda f=img_rgb: _run_pipeline(f, use_mtcnn=False),  # type: ignore[misc]
                )
                tracker.update(result["emotion"], result["confidence"])
                e = result["emotion"]
                emotion_counts[e] = emotion_counts.get(e, 0) + 1
            except Exception:
                pass
        frame_idx += 1
    cap.release()

    summary  = tracker.summary()
    dominant = (
        max(emotion_counts, key=lambda k: emotion_counts[k])
        if emotion_counts
        else "Neutral"
    )
    tone = summary["tone"]

    return {
        "avg_engagement": summary["ema_engagement"],
        "dominant":       dominant,
        "tone":           tone,
    }


# =============================================================================
#  QUICK TEXT-ONLY ENDPOINT  —  POST /mock/analyse-text
#  For testing the LLM scoring without audio/video
# =============================================================================

@router.post("/analyse-text")
async def mock_analyse_text(body: MockAnalysisRequest):
    """
    Lightweight endpoint: supply a pre-existing transcript + metrics.
    Useful for frontend demos and unit testing.
    """
    voice_metrics_safe:   dict = body.voice_metrics   or {}
    emotion_summary_safe: dict = body.emotion_summary or {}

    voice_scores   = score_voice(voice_metrics_safe, body.mode)
    emotion_scores = score_emotion_for_mode(emotion_summary_safe, body.mode)

    eng_pct = (
        round((body.engagement_score or 0) * 100)
        if (body.engagement_score or 0) <= 1
        else round(body.engagement_score or 0)
    )
    overall_score = compute_overall_score(voice_scores, emotion_scores, eng_pct, body.mode)

    llm_result = call_llm_mock_analysis(
        body.mode,
        body.topic or "",
        body.transcript or "",
        voice_scores,
        voice_metrics_safe,
        {
            **emotion_scores,
            "positive_pct": emotion_summary_safe.get("positive", 0),
            "neutral_pct":  emotion_summary_safe.get("neutral",  0),
            "negative_pct": emotion_summary_safe.get("negative", 0),
        },
        eng_pct,
        overall_score,
    )
    report_html = build_html_report(
        body.mode,
        body.topic or "",
        body.transcript or "",
        voice_metrics_safe,
        voice_scores,
        emotion_summary_safe,
        eng_pct,
        overall_score,
        llm_result,
    )
    return {
        "session_id":      body.session_id,
        "overall_score":   overall_score,
        "voice_scores":    voice_scores,
        "scores":          llm_result.get("dimension_scores", {}),
        "feedback":        llm_result.get("feedback", {}),
        "strengths":       llm_result.get("strengths", []),
        "tips":            llm_result.get("tips", []),
        "coach_summary":   llm_result.get("coach_summary", ""),
        "overall_verdict": llm_result.get("overall_verdict", ""),
        "report_html":     report_html,
    }