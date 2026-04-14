import os
os.environ["TF_USE_LEGACY_KERAS"] = "1"
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"

import cv2
import numpy as np
import tensorflow as tf
import time
import math
import warnings
from typing import Any, Optional, Tuple, Union
from PIL import Image, ImageDraw, ImageFont
from webcam_config import *

def _safe_kp(pt: Any) -> Tuple[int, int]:
    """Convert any MTCNN keypoint value to a guaranteed (int, int)."""
    try:
        x = int(round(float(pt[0])))
        y = int(round(float(pt[1])))
    except (TypeError, IndexError, ValueError) as exc:
        raise ValueError(f"[MTCNN] Invalid keypoint: {pt!r}") from exc
    return x, y

def _safe_box(box: Any) -> Optional[Tuple[int, int, int, int]]:
    """Validate and convert an MTCNN box to (x, y, w, h) ints."""
    try:
        x, y, w, h = int(box[0]), int(box[1]), int(box[2]), int(box[3])
        return (x, y, w, h) if w > 0 and h > 0 else None
    except (TypeError, IndexError, ValueError):
        return None


def align_face(img: np.ndarray, left_eye: Any, right_eye: Any) -> np.ndarray:
    lx, ly = _safe_kp(left_eye)
    rx, ry = _safe_kp(right_eye)
    angle  = np.degrees(np.arctan2(ry - ly, rx - lx))
    center = ((lx + rx) / 2.0, (ly + ry) / 2.0)
    M      = cv2.getRotationMatrix2D(center, float(angle), 1.0)
    return cv2.warpAffine(
        img, M, (img.shape[1], img.shape[0]),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REFLECT_101,
    )


# CALIBRATION

def apply_calibration(raw_probs: np.ndarray) -> np.ndarray:
    eps    = 1e-7
    probs  = np.clip(raw_probs, eps, 1.0)
    log_p  = np.log(probs) / TEMPERATURE
    log_p -= np.max(log_p)
    scaled  = np.exp(log_p)
    scaled /= scaled.sum()
    adjusted = scaled * _BOOST_VEC
    total    = adjusted.sum()
    return adjusted / total if total > 0 else scaled



_clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))

def apply_clahe(face_rgb: np.ndarray) -> np.ndarray:
    """CLAHE on luminance channel only (RGB in, RGB out)."""
    lab = cv2.cvtColor(face_rgb, cv2.COLOR_RGB2LAB)
    l, a, b = cv2.split(lab)
    lab_eq  = cv2.merge([_clahe.apply(l), a, b])
    return cv2.cvtColor(lab_eq, cv2.COLOR_LAB2RGB)


#  PREPROCESS  (CLAHE - resize -MobileNetV2 normalise)

def preprocess(face_rgb: np.ndarray) -> np.ndarray:
    # CLAHE removed: over-equalises well-lit webcam faces and shifts
    # pixel distribution away from RAF-DB training data.
    face = cv2.resize(face_rgb, IMG_SIZE, interpolation=cv2.INTER_AREA)
    face = face.astype("float32")
    face = tf.keras.applications.mobilenet_v2.preprocess_input(face)
    return np.expand_dims(face, axis=0)


def apply_boundary_guards(probs: np.ndarray) -> int:
    
    top3   = np.argsort(probs)[-3:]
    best   = int(top3[-1])
    second = int(top3[-2])
    third  = int(top3[-3])

    # Rule 1 — Disgust needs strong evidence
    if CLASS_NAMES[best] == "Disgust":
        if probs[best] - probs[second] < 0.12:
            best, second = second, third

    # Rule 2 — Neutral tie-break (elif: won't fire if Rule 1 just
    # demoted Disgust and promoted Sadness into the winner slot)
    elif CLASS_NAMES[best] == "Neutral":
        if probs[best] - probs[second] < MARGIN:
            # ALWAYS skip Disgust as runner-up after Neutral demotion.
            # Neutral→Disgust is never a correct flip on a webcam face;
            # walk down to the first non-Disgust candidate.
            ranked = list(np.argsort(probs)[::-1])
            for candidate in ranked:
                if candidate != int(np.argmax(probs == probs[best])) and CLASS_NAMES[candidate] not in ("Neutral", "Disgust"):
                    best = candidate
                    break
            else:
                # fallback: take second if all others are Neutral/Disgust
                best = second

    # Rule 3 — Surprise guards
    elif CLASS_NAMES[best] == "Surprise":
        neutral_idx = CLASS_NAMES.index("Neutral")
        fear_idx    = CLASS_NAMES.index("Fear")
        # 3a: Surprise vs Neutral — slightly-open mouth on a sad/neutral
        #     face triggers Surprise. Require a 0.15 gap over Neutral.
        if probs[best] - probs[neutral_idx] < 0.15:
            best = neutral_idx
        # 3b: Surprise vs Fear — shared wide-eyes feature; protect Fear
        elif probs[best] - probs[fear_idx] < 0.10:
            best = fear_idx

    return best

#  PREDICT  (3x averaging + calibration + EMA + boundary guards)

def predict_emotion(face_rgb: np.ndarray) -> Tuple[str, float, np.ndarray]:
    """Returns (stable_label, confidence, smoothed_probs)."""
    global ema_pred

    inp   = preprocess(face_rgb)
    # Prediction averaging (3 forward passes, averaged)
    preds = [model.predict(inp, verbose=0)[0] for _ in range(3)]
    raw   = np.mean(preds, axis=0)
    cal   = apply_calibration(raw)

    # Temporal smoothing (rolling buffer)
    pred_buffer.append(cal)
    avg_pred = np.mean(pred_buffer, axis=0)

    # EMA smoothing trick 
    if ema_pred is None:
        ema_pred = avg_pred
    else:
        ema_pred = EMA_ALPHA * avg_pred + (1.0 - EMA_ALPHA) * ema_pred

    smoothed   = ema_pred
    assert smoothed is not None  # always set in the if/else above
    best       = apply_boundary_guards(smoothed)
    emotion    = CLASS_NAMES[best]
    confidence = float(smoothed[best])

    # Confidence filtering
    if confidence > CONF_THRESHOLD:
        emotion_buffer.append(emotion)

    stable = (Counter(emotion_buffer).most_common(1)[0][0]
              if emotion_buffer else "Detecting...")
    return stable, confidence, smoothed.copy()


# FACE GETTER  (MTCNN + safe typing + padded crop)

def get_face(frame_bgr: np.ndarray) -> Optional[Tuple[np.ndarray, np.ndarray, Tuple[int,int,int,int]]]:
    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)

    faces_raw = detector.detect_faces(rgb)
    faces: List[Dict[str, Any]] = cast(List[Dict[str, Any]], faces_raw) if faces_raw else []

    valid: List[Tuple[Dict[str, Any], Tuple[int,int,int,int]]] = []
    for f in faces:
        box = _safe_box(f.get("box"))   # safe typing
        if box is None:
            continue
        valid.append((f, box))

    if not valid:
        return None

    valid.sort(key=lambda item: item[1][2] * item[1][3], reverse=True)
    face_data, (x, y, w, h) = valid[0]

    x, y = max(0, x), max(0, y)
    if w < MIN_FACE_SIZE or h < MIN_FACE_SIZE:
        return None

    kp = face_data.get("keypoints")
    if kp is None:
        return None
    le_raw = kp.get("left_eye")
    re_raw = kp.get("right_eye")
    if le_raw is None or re_raw is None:
        return None

    try:
        le = _safe_kp(le_raw)   # safe typing
        re = _safe_kp(re_raw)   # safe typing
    except ValueError:
        return None

    aligned = align_face(rgb, le, re)

    # Tight crop matching original working behaviour.
    # CROP_PAD reverted: extra context included background/hair that
    # the model was not trained on, degrading accuracy.
    fh, fw = aligned.shape[:2]
    x1 = max(0,  x)
    y1 = max(0,  y)
    x2 = min(fw, x + w)
    y2 = min(fh, y + h)

    face_crop = aligned[y1:y2, x1:x2]
    if face_crop.size == 0:
        return None

    return frame_bgr, face_crop, (x, y, w, h)


# sFACE TRACKING

def assign_face_id(cx: int, cy: int) -> int:
    global next_id
    for fid, (px, py) in tracked_faces.items():
        if math.hypot(cx - px, cy - py) < TRACK_DISTANCE:
            tracked_faces[fid] = (cx, cy)
            return fid
    tracked_faces[next_id] = (cx, cy)
    next_id += 1
    return next_id - 1

# ANIMATION HELPERS

