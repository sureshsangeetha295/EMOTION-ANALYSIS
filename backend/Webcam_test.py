import os
os.environ["TF_USE_LEGACY_KERAS"] = "1"
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"

import cv2
import numpy as np
import tensorflow as tf
import time
import math
import warnings
warnings.filterwarnings("ignore")

from mtcnn import MTCNN
from collections import deque, Counter
from typing import List, Dict, Any, Tuple, Optional, Union, cast
from PIL import Image, ImageDraw, ImageFont
import platform


# CONFIG

MODEL_PATH = r"D:\Facial Emotion Detection\Backend\Models\phase2_best_model.keras"

IMG_SIZE         = (224, 224)
CONF_THRESHOLD   = 0.28   
MARGIN           = 0.08
SMOOTHING_FRAMES = 8
VOTING_FRAMES    = 12
MIN_FACE_SIZE    = 80
TRACK_DISTANCE   = 80
EMA_ALPHA        = 0.55   


CROP_PAD = 0.20

CLASS_NAMES: List[str] = [
    "Anger", "Disgust", "Fear",
    "Happiness", "Neutral",
    "Sadness", "Surprise"
]

# Calibration 
TEMPERATURE = 0.65   
PRIOR_BOOST: Dict[str, float] = {
    "Anger":     1.40,
    "Disgust":   0.22,   
    "Fear":      4.00,   
    "Happiness": 0.25,
    "Neutral":   0.60,   
    "Sadness":   1.30,   
    "Surprise":  0.35,   
}
_BOOST_VEC = np.array([PRIOR_BOOST[l] for l in CLASS_NAMES], dtype=np.float32)

# Window layout 
WIN_W         = 560
FACE_H        = 460
BOTTOM_H      = 160
WIN_H         = FACE_H + BOTTOM_H
LOAD_SECS     = 2.5
ALIGN_SECS    = 2.0
FLASH_SECS    = 0.40
CONFIRM_SECS  = 0.9
SMOOTH_N      = 10
FACE_MISS_MAX = 12

COLORS: Dict[str, Tuple[int, int, int]] = {
    "Anger":     (40,  40,  255),
    "Disgust":   (40,  220,  40),
    "Fear":      (200,  40, 255),
    "Happiness": (40,  255, 160),
    "Neutral":   (210, 210, 210),
    "Sadness":   (255, 140,  40),
    "Surprise":  (40,  210, 255),
}
EMOJIS: Dict[str, Tuple[str, str, str]] = {
    "Anger":     ("ANGRY",     "Take a deep breath!",     "😠"),
    "Disgust":   ("DISGUSTED", "Something smell funny?",  "🤢"),
    "Fear":      ("FEARFUL",   "It's okay, you're safe!", "😨"),
    "Happiness": ("HAPPY",     "Love that energy!",       "😄"),
    "Neutral":   ("NEUTRAL",   "Poker face activated.",   "😐"),
    "Sadness":   ("SAD",       "Sending good vibes!",     "😢"),
    "Surprise":  ("SURPRISED", "Didn't see that coming!", "😲"),
}


# LOAD MODEL

print("[INFO] Loading model ...")
model = tf.keras.models.load_model(MODEL_PATH, compile=False)
print("[INFO] Model loaded.  Press ENTER to scan, Q to quit.\n")


# FACE DETECTOR

detector = MTCNN()

# TRACKING STATE

next_id: int = 0
tracked_faces: Dict[int, Tuple[int, int]] = {}

pred_buffer:    deque = deque(maxlen=SMOOTHING_FRAMES)
emotion_buffer: deque = deque(maxlen=VOTING_FRAMES)
ema_pred: Optional[np.ndarray] = None


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

def get_emoji_font(size: int = 52) -> Union[ImageFont.FreeTypeFont, ImageFont.ImageFont]:
    system = platform.system()
    paths  = {
        "Windows": [r"C:\Windows\Fonts\seguiemj.ttf", r"C:\Windows\Fonts\seguisym.ttf"],
        "Darwin":  ["/System/Library/Fonts/Apple Color Emoji.ttc"],
    }.get(system, ["/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf"])
    for p in paths:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()

def put_emoji_centered(canvas_bgr: np.ndarray, emoji_char: str,
                       y_top: int, font_size: int = 56) -> np.ndarray:
    pil = Image.fromarray(cv2.cvtColor(canvas_bgr, cv2.COLOR_BGR2RGB))
    d   = ImageDraw.Draw(pil)
    fnt = get_emoji_font(font_size)
    try:
        bbox = d.textbbox((0, 0), emoji_char, font=fnt)
        tw   = bbox[2] - bbox[0]
    except AttributeError:
        tw = font_size
    d.text(((canvas_bgr.shape[1] - tw) // 2, y_top),
           emoji_char, font=fnt, embedded_color=True)
    return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)

def make_gradient(h: int, w: int, c1: tuple, c2: tuple,
                  vertical: bool = True) -> np.ndarray:
    canvas = np.zeros((h, w, 3), dtype=np.uint8)
    n = h if vertical else w
    for i in range(n):
        t2  = i / n
        col = tuple(int(c1[k]*(1-t2) + c2[k]*t2) for k in range(3))
        if vertical:
            canvas[i] = col
        else:
            canvas[:, i] = col
    return canvas

def draw_brackets(canvas: np.ndarray, x: int, y: int, w: int, h: int,
                  color: tuple, size: int = 30, thick: int = 3) -> None:
    for (cx, cy, sx, sy) in [(x,y,1,1),(x+w,y,-1,1),(x,y+h,1,-1),(x+w,y+h,-1,-1)]:
        cv2.line(canvas, (cx,cy), (cx+sx*size, cy), color, thick, cv2.LINE_AA)
        cv2.line(canvas, (cx,cy), (cx, cy+sy*size), color, thick, cv2.LINE_AA)

def draw_spinner(canvas: np.ndarray, cx: int, cy: int, t: float,
                 radius: int = 38, color: tuple = (255,255,255)) -> None:
    n = 14
    for i in range(n):
        angle  = (t*4.0 + i*(2*math.pi/n)) % (2*math.pi)
        alpha  = (i+1) / n
        px     = int(cx + radius*math.cos(angle))
        py     = int(cy + radius*math.sin(angle))
        r      = max(2, int(2 + alpha*5))
        bright = int(60 + alpha*195)
        c      = tuple(int(bright*cc/255) for cc in color)
        cv2.circle(canvas, (px, py), r, c, -1, cv2.LINE_AA)

def draw_checkmark(canvas: np.ndarray, cx: int, cy: int,
                   color: tuple, size: int = 44) -> None:
    cv2.line(canvas, (cx-size, cy+4),
             (cx-size//4, cy+size*3//4), color, 6, cv2.LINE_AA)
    cv2.line(canvas, (cx-size//4, cy+size*3//4),
             (cx+size, cy-size*3//4), color, 6, cv2.LINE_AA)

def put_centered(canvas: np.ndarray, text: str, y: int, font: int,
                 scale: float, color: tuple,
                 thick: int = 2, shadow: bool = True) -> int:
    (tw, th), _ = cv2.getTextSize(text, font, scale, thick)
    x = (canvas.shape[1] - tw) // 2
    if shadow:
        cv2.putText(canvas, text, (x+2, y+2), font, scale,
                    (0,0,0), thick+4, cv2.LINE_AA)
    cv2.putText(canvas, text, (x, y), font, scale, color, thick, cv2.LINE_AA)
    return th

def add_scanlines(canvas: np.ndarray, alpha: float = 0.06) -> None:
    for y in range(0, canvas.shape[0], 4):
        canvas[y] = (canvas[y] * (1-alpha)).astype(np.uint8)

def add_noise(canvas: np.ndarray, intensity: int = 6) -> None:
    noise = np.random.randint(-intensity, intensity,
                              canvas.shape, dtype=np.int16)
    canvas[:] = np.clip(canvas.astype(np.int16)+noise, 0, 255).astype(np.uint8)

def draw_glowing_circle(canvas: np.ndarray, cx: int, cy: int,
                        radius: int, color: tuple, layers: int = 5) -> None:
    for i in range(layers, 0, -1):
        ov = canvas.copy()
        cv2.circle(ov, (cx, cy), radius+i*6, color, 2)
        cv2.addWeighted(ov, 0.04*(layers-i+1), canvas,
                        1-0.04*(layers-i+1), 0, canvas)
    cv2.circle(canvas, (cx, cy), radius, color, 2, cv2.LINE_AA)

def draw_robot_face(canvas: np.ndarray, cx: int, cy: int, t: float,
                    color: tuple = (100,220,180), blink: bool = False) -> None:
    hw, hh = 70, 58
    head_pts = np.array(
        [[cx-hw,cy-hh],[cx+hw,cy-hh],[cx+hw,cy+hh],[cx-hw,cy+hh]],
        dtype=np.int32)
    cv2.polylines(canvas, [head_pts], True, color, 2, cv2.LINE_AA)
    for ox, oy in [(-hw,-hh),(hw,-hh),(hw,hh),(-hw,hh)]:
        cv2.circle(canvas, (cx+ox, cy+oy), 10, color, 2, cv2.LINE_AA)
    eye_y = cy - 10
    for side in [-1, 1]:
        ex = cx + side*28
        if blink:
            cv2.line(canvas, (ex-10, eye_y), (ex+10, eye_y), color, 3, cv2.LINE_AA)
        else:
            cv2.circle(canvas, (ex, eye_y), 12, color, 2, cv2.LINE_AA)
            px = int(ex + 6*math.sin(t*3.2))
            py = int(eye_y + 4*math.cos(t*2.1))
            cv2.circle(canvas, (px, py), 5, color, -1, cv2.LINE_AA)
            cv2.circle(canvas, (ex, eye_y), int(8+2*math.sin(t*5)),
                       tuple(min(255,c+80) for c in color), 1, cv2.LINE_AA)
    mouth_y = cy + 28
    bar_w, bars = 10, 9
    start_x = cx - bars*(bar_w+3)//2
    for i in range(bars):
        phase = t*6 + i*0.7
        bh    = int(6 + 12*abs(math.sin(phase)))
        bx    = start_x + i*(bar_w+3)
        bc    = tuple(int(c*(0.5+0.5*abs(math.sin(phase)))) for c in color)
        cv2.rectangle(canvas, (bx, mouth_y-bh), (bx+bar_w, mouth_y), bc, -1)
    ant_y, ant_top = cy-hh, cy-hh-22
    cv2.line(canvas, (cx, ant_y), (cx, ant_top), color, 2, cv2.LINE_AA)
    bp = abs(math.sin(t*8))
    cv2.circle(canvas, (cx, ant_top), 6,
               tuple(int(c*bp) for c in color), -1, cv2.LINE_AA)
    cv2.circle(canvas, (cx, ant_top), 8, color, 1, cv2.LINE_AA)
    for side in [-1, 1]:
        bx = cx + side*hw
        for off in [-20, 0, 20]:
            cv2.circle(canvas, (bx, cy+off), 3, color, -1, cv2.LINE_AA)
    chars = "01 MTCNN EMOTION CNN 10 LSTM 01 RAF"
    scroll_offset = int(t*40) % len(chars)
    scrolled = (chars[scroll_offset:] + chars[:scroll_offset])[:30]
    (tw, _), _ = cv2.getTextSize(scrolled, cv2.FONT_HERSHEY_PLAIN, 0.65, 1)
    cv2.putText(canvas, scrolled, (cx-tw//2, cy+hh+20),
                cv2.FONT_HERSHEY_PLAIN, 0.65,
                tuple(int(c*0.45) for c in color), 1, cv2.LINE_AA)

def draw_hex_grid(canvas: np.ndarray, t: float,
                  h_limit: Optional[int] = None) -> None:
    H = h_limit if h_limit else canvas.shape[0]
    for row in range(-1, H//28+2):
        for col in range(-1, canvas.shape[1]//28+2):
            hs  = 24
            hcx = int(col*hs*1.73)
            hcy = int(row*hs*2) + (hs if col%2==1 else 0)
            if hcy > H:
                continue
            pts = [(int(hcx+hs*math.cos(math.radians(60*i+30))),
                    int(hcy+hs*math.sin(math.radians(60*i+30))))
                   for i in range(6)]
            phase  = (hcx/canvas.shape[1] + hcy/H + t*0.3) % 1.0
            bright = int(12 + 6*math.sin(phase*math.pi*2))
            cv2.polylines(canvas, [np.array(pts, dtype=np.int32)],
                          True, (bright, bright, bright+10), 1)

# SCREEN BUILDERS

def screen_waiting(t: float) -> np.ndarray:
    canvas = make_gradient(WIN_H, WIN_W, (4,4,14), (14,6,28))
    add_noise(canvas, 3)
    draw_hex_grid(canvas, t, FACE_H)

    cx, cy  = WIN_W//2, FACE_H//2-20
    pulse_r = int(90 + 12*math.sin(t*1.8))
    draw_glowing_circle(canvas, cx, cy, pulse_r,      (60,40,120))
    draw_glowing_circle(canvas, cx, cy, pulse_r-22,   (40,30,90))
    cv2.ellipse(canvas, (cx,cy-8),  (38,46), 0,0,360, (70,55,130), 2, cv2.LINE_AA)
    cv2.ellipse(canvas, (cx,cy+32), (30,18), 0,0,180, (70,55,130), 2, cv2.LINE_AA)
    scan_y = cy-46+int(92*((math.sin(t*1.4)+1)/2))
    cv2.line(canvas, (cx-38,scan_y),(cx+38,scan_y),(80,60,180),1,cv2.LINE_AA)
    for i in range(6):
        angle = t*0.9+i*(2*math.pi/6)
        ox,oy = int(cx+pulse_r*math.cos(angle)), int(cy+pulse_r*math.sin(angle))
        ci    = 0.5+0.5*math.sin(t*2+i)
        cv2.circle(canvas, (ox,oy), 3 if i%2==0 else 2,
                   tuple(int(c*ci) for c in (120,80,220)), -1, cv2.LINE_AA)

    font = cv2.FONT_HERSHEY_DUPLEX
    put_centered(canvas,"STEP INTO FRAME",             cy+88,  font,0.88,(160,130,255),2)
    put_centered(canvas,"Position your face to begin", cy+118, font,0.45,(80,65,130), 1,shadow=False)
    for (bx,by),(sx,sy) in zip(
            [(12,12),(WIN_W-12,12),(12,FACE_H-12),(WIN_W-12,FACE_H-12)],
            [(1,1),(-1,1),(1,-1),(-1,-1)]):
        cv_ = int(60+40*abs(math.sin(t*1.5)))
        cc  = (cv_, cv_//2, cv_*2)
        cv2.line(canvas,(bx,by),(bx+sx*22,by),   cc,2,cv2.LINE_AA)
        cv2.line(canvas,(bx,by),(bx,by+sy*22),   cc,2,cv2.LINE_AA)

    cv2.rectangle(canvas,(0,FACE_H),(WIN_W,WIN_H),(8,6,16),-1)
    cv2.line(canvas,(0,FACE_H),(WIN_W,FACE_H),(50,35,100),2)
    aw = int(WIN_W*(0.5+0.5*abs(math.sin(t*0.7))))
    ax = (WIN_W-aw)//2
    cv2.line(canvas,(ax,FACE_H+1),(ax+aw,FACE_H+1),(90,60,180),1)
    put_centered(canvas,"EMOTION DETECTOR",                   FACE_H+52,  font,0.78,(110,80,200),2)
    put_centered(canvas,"NEURAL NETWORK  |  RAF-DB  MODEL",  FACE_H+88,  font,0.38,(55,42,100), 1,shadow=False)
    put_centered(canvas,"MobileNetV2  +  Prior Calibration", FACE_H+114, font,0.36,(40,32,80),  1,shadow=False)
    add_scanlines(canvas)
    return canvas


def screen_align(face_bgr: np.ndarray, t: float, elapsed: float,
                 face_rect: Optional[Tuple[int,int,int,int]] = None) -> np.ndarray:
    canvas     = np.zeros((WIN_H,WIN_W,3),dtype=np.uint8)
    face_panel = cv2.resize(face_bgr,(WIN_W,FACE_H))
    gray_face  = cv2.cvtColor(cv2.cvtColor(face_panel,cv2.COLOR_BGR2GRAY),cv2.COLOR_GRAY2BGR)
    canvas[:FACE_H] = cv2.addWeighted(face_panel,0.60,gray_face,0.40,0)

    progress      = min(elapsed/ALIGN_SECS,1.0)
    blink_v       = int(180+75*math.sin(t*5))
    green_v       = int(220*(1-progress)+255*progress)
    bracket_color = (40,green_v,blink_v//2)
    cx, cy        = WIN_W//2, FACE_H//2

    if face_rect is not None:
        fh_orig,fw_orig = face_bgr.shape[:2]
        rx,ry,rw,rh = face_rect
        dx  = int(rx*WIN_W/fw_orig);  dy  = int(ry*FACE_H/fh_orig)
        dw  = int(rw*WIN_W/fw_orig);  dh  = int(rh*FACE_H/fh_orig)
        bx1 = max(0,       dx-int(dw*0.18))
        by1 = max(0,       dy-int(dh*0.18))
        bx2 = min(WIN_W-1, dx+dw+int(dw*0.18))
        by2 = min(FACE_H-1,dy+dh+int(dh*0.18))
        for gi in range(4,0,-1):
            ov = canvas.copy()
            cv2.rectangle(ov,(bx1-gi*3,by1-gi*3),(bx2+gi*3,by2+gi*3),bracket_color,1)
            cv2.addWeighted(ov,0.08*gi*progress,canvas,1-0.08*gi*progress,0,canvas)
        draw_brackets(canvas,bx1,by1,bx2-bx1,by2-by1,bracket_color,size=28,thick=3)
        fcx,fcy = (bx1+bx2)//2,(by1+by2)//2
        cv2.line(canvas,(fcx-14,fcy),(fcx+14,fcy),bracket_color,1,cv2.LINE_AA)
        cv2.line(canvas,(fcx,fcy-14),(fcx,fcy+14),bracket_color,1,cv2.LINE_AA)
    else:
        m=50
        draw_brackets(canvas,m,m,WIN_W-2*m,FACE_H-2*m,bracket_color,size=38,thick=3)
        cv2.ellipse(canvas,(cx,cy),(120,155),0,0,360,bracket_color,2,cv2.LINE_AA)

    ring_r=44
    draw_glowing_circle(canvas,cx,cy+FACE_H//3+20,ring_r,
                        tuple(int(c*progress) for c in (60,255,120)))
    cv2.ellipse(canvas,(cx,cy+FACE_H//3+20),(ring_r,ring_r),
                -90,-90,int(-90+360*progress),(60,255,120),3,cv2.LINE_AA)
    remain=f"{max(0,ALIGN_SECS-elapsed):.1f}s"
    font=cv2.FONT_HERSHEY_DUPLEX
    (tw,th),_=cv2.getTextSize(remain,font,0.55,1)
    cv2.putText(canvas,remain,(cx-tw//2,cy+FACE_H//3+20+th//2),
                font,0.55,(60,255,120),1,cv2.LINE_AA)

    bar_y=FACE_H-6
    cv2.rectangle(canvas,(0,bar_y),(WIN_W,FACE_H),(15,18,15),-1)
    for xi in range(int(progress*WIN_W)):
        t2=xi/WIN_W
        cv2.line(canvas,(xi,bar_y),(xi,FACE_H),
                 (int(40+t2*80),int(200+t2*55),int(80+t2*100)),1)

    cv2.rectangle(canvas,(0,FACE_H),(WIN_W,WIN_H),(8,12,10),-1)
    cv2.line(canvas,(0,FACE_H),(WIN_W,FACE_H),(60,220,100),3)
    put_centered(canvas,"LOOK  STRAIGHT",                          FACE_H+55,font,1.05,(60,240,120),3)
    put_centered(canvas,"Keep still  --  capturing your expression",
                 FACE_H+90,font,0.40,(40,130,60),1,shadow=False)
    dx0=WIN_W//2-5*14//2
    for i in range(5):
        da=0.2+0.8*abs(math.sin((t*3+i*0.4)%(2*math.pi)))
        cv2.circle(canvas,(dx0+i*14,FACE_H+112),3,
                   (int(60*da),int(220*da),int(90*da)),-1,cv2.LINE_AA)
    add_scanlines(canvas)
    return canvas


def screen_snapshot_flash(face_bgr: np.ndarray, flash_alpha: float) -> np.ndarray:
    canvas     = np.zeros((WIN_H,WIN_W,3),dtype=np.uint8)
    face_panel = cv2.resize(face_bgr,(WIN_W,FACE_H))
    canvas[:FACE_H] = face_panel
    flash=np.ones((FACE_H,WIN_W,3),dtype=np.uint8)*255
    cv2.addWeighted(flash,flash_alpha,canvas[:FACE_H],1-flash_alpha,0,canvas[:FACE_H])
    cv2.rectangle(canvas,(0,FACE_H),(WIN_W,WIN_H),(20,22,18),-1)
    cv2.line(canvas,(0,FACE_H),(WIN_W,FACE_H),(255,255,255),3)
    font=cv2.FONT_HERSHEY_DUPLEX
    put_centered(canvas,"CAPTURED!",FACE_H+58,font,1.2, (255,255,255),3)
    put_centered(canvas,"Snap!",    FACE_H+96,font,0.55,(180,180,180),1,shadow=False)
    return canvas


def screen_loading(face_bgr: np.ndarray, t: float,
                   progress: float, pass_count: int) -> np.ndarray:
    canvas     = np.zeros((WIN_H,WIN_W,3),dtype=np.uint8)
    face_panel = cv2.resize(face_bgr,(WIN_W,FACE_H))
    canvas[:FACE_H] = (face_panel*0.15).astype(np.uint8)

    for row in range(-1,FACE_H//22+2):
        for col in range(-1,WIN_W//22+2):
            hs=20
            hcx=int(col*hs*1.73); hcy=int(row*hs*2)+(hs if col%2==1 else 0)
            pts=[(int(hcx+hs*math.cos(math.radians(60*i+30))),
                  int(hcy+hs*math.sin(math.radians(60*i+30)))) for i in range(6)]
            phase=(hcx/WIN_W+hcy/FACE_H+t*0.5)%1.0
            if hcy<FACE_H:
                bright=int(14+10*abs(math.sin(phase*math.pi*2)))
                cv2.polylines(canvas,[np.array(pts,dtype=np.int32)],True,
                              (bright,bright+10,bright+5),1)

    rcx,rcy=WIN_W//2,FACE_H//2-30
    rc=(80,220,170)
    for ri in range(3):
        rp=(t*2+ri*0.5)%3.0
        ring_r=int(80+ri*35+rp*15)
        ring_a=max(0.0,1.0-rp/3.0)*0.3
        ov=canvas.copy()
        cv2.circle(ov,(rcx,rcy),ring_r,rc,1,cv2.LINE_AA)
        cv2.addWeighted(ov,ring_a,canvas,1-ring_a,0,canvas)

    draw_robot_face(canvas,rcx,rcy,t,rc,blink=(int(t*2)%5==0))
    draw_spinner(canvas,rcx,rcy,t,radius=120,color=rc)

    font=cv2.FONT_HERSHEY_DUPLEX
    pct=f"{int(progress*100)}%"
    (tw,th),_=cv2.getTextSize(pct,font,0.7,1)
    cv2.putText(canvas,pct,(rcx-tw//2,rcy+105+th),font,0.7,rc,1,cv2.LINE_AA)
    put_centered(canvas,f"Pass {min(pass_count,SMOOTH_N)} / {SMOOTH_N}  --  MTCNN aligned",
                 rcy+128,font,0.40,(80,150,120),1,shadow=False)

    bar_y=FACE_H-8
    cv2.rectangle(canvas,(0,bar_y),(WIN_W,FACE_H),(12,16,14),-1)
    for xi in range(int(progress*WIN_W)):
        t2=xi/WIN_W
        cv2.line(canvas,(xi,bar_y+1),(xi,FACE_H-1),
                 (int(40+t2*60),int(180+t2*40),int(120+t2*50)),1)

    cv2.rectangle(canvas,(0,FACE_H),(WIN_W,WIN_H),(6,10,8),-1)
    cv2.line(canvas,(0,FACE_H),(WIN_W,FACE_H),(50,100,70),2)
    put_centered(canvas,"ANALYSING...",FACE_H+52,font,1.0,(80,200,140),2)
    dx0=WIN_W//2-5*16//2
    for i in range(5):
        da=0.15+0.85*abs(math.sin((t*3.5+i*0.5)%(2*math.pi)))
        cv2.circle(canvas,(dx0+i*16,FACE_H+85),4,
                   tuple(int(c*da) for c in (60,200,140)),-1,cv2.LINE_AA)
    put_centered(canvas,"Temperature Scaling  +  Prior Calibration",
                 FACE_H+116,font,0.35,(35,65,48),1,shadow=False)
    add_scanlines(canvas)
    return canvas


def screen_confirm(face_bgr: np.ndarray, label: str, color: tuple,
                   alpha: float, t: float) -> np.ndarray:
    canvas     = np.zeros((WIN_H,WIN_W,3),dtype=np.uint8)
    face_panel = cv2.resize(face_bgr,(WIN_W,FACE_H))
    canvas[:FACE_H] = (face_panel*0.20).astype(np.uint8)
    cx,cy = WIN_W//2,FACE_H//2
    for ri in range(5):
        glow_r=int((50+ri*25)*alpha)
        glow_a=max(0,0.12-ri*0.02)*alpha
        if glow_r>0:
            ov=canvas.copy()
            cv2.circle(ov,(cx,cy),glow_r,color,-1)
            cv2.addWeighted(ov,glow_a,canvas,1-glow_a,0,canvas)
    cv2.circle(canvas,(cx,cy),int(65*alpha),color,2,cv2.LINE_AA)
    ring_r=int(80*alpha)
    if ring_r>0:
        cv2.ellipse(canvas,(cx,cy),(ring_r,ring_r),
                    t*90,0,int(300*alpha),color,2,cv2.LINE_AA)
    draw_checkmark(canvas,cx,cy,color,size=int(48*alpha))
    for i in range(12):
        ang=i*(2*math.pi/12)+t*2
        dist=int(90*alpha)
        cv2.circle(canvas,
                   (cx+int(dist*math.cos(ang)),cy+int(dist*math.sin(ang))),
                   max(1,int(4*(1-alpha)+2)),color,-1,cv2.LINE_AA)
    cv2.rectangle(canvas,(0,FACE_H),(WIN_W,WIN_H),(8,8,12),-1)
    cv2.line(canvas,(0,FACE_H),(WIN_W,FACE_H),color,3)
    font=cv2.FONT_HERSHEY_DUPLEX
    put_centered(canvas,"GOT IT!",           FACE_H+56,font,1.15,color,        2)
    put_centered(canvas,"Revealing result...",FACE_H+94,font,0.45,(100,100,100),1,shadow=False)
    add_scanlines(canvas)
    return canvas


def screen_result(face_bgr: np.ndarray, label: str, color: tuple,
                  t: float, avg_probs: Optional[np.ndarray],
                  result_elapsed: float = 0.0) -> np.ndarray:
    
    PHASE2_START = 1.0
    TYPEWR_SPEED = 16

    # Face panel 
    canvas     = np.zeros((WIN_H, WIN_W, 3), dtype=np.uint8)
    face_panel = cv2.resize(face_bgr, (WIN_W, FACE_H))
    canvas[:FACE_H] = face_panel

    # Vignette
    vy   = ((np.arange(FACE_H) - FACE_H/2) / (FACE_H/2)) ** 2
    vx   = ((np.arange(WIN_W)  - WIN_W/2)  / (WIN_W/2))  ** 2
    vign = np.clip(1 - np.outer(vy, np.ones(WIN_W))
                     - np.outer(np.ones(FACE_H), vx) * 0.50, 0, 1).astype(np.float32)
    for ch in range(3):
        canvas[:FACE_H, :, ch] = (canvas[:FACE_H, :, ch] * vign).astype(np.uint8)

    # Pulsing coloured border
    pulse = 0.60 + 0.40 * math.sin(t * 2.2)
    pc    = tuple(min(255, int(c * pulse)) for c in color)
    cv2.rectangle(canvas, (0, 0),   (WIN_W-1, FACE_H-1), pc, 5)
    cv2.rectangle(canvas, (7, 7),   (WIN_W-8, FACE_H-8),
                  tuple(int(c * 0.25) for c in color), 1)

    # Moving scan line
    scan_y = int(FACE_H//2 + (FACE_H//3) * math.sin(t * 1.3))
    sl = canvas[:FACE_H].copy()
    cv2.line(sl, (0, scan_y), (WIN_W, scan_y), color, 1, cv2.LINE_AA)
    cv2.addWeighted(sl, 0.18, canvas[:FACE_H], 0.82, 0, canvas[:FACE_H])

    # Corner particle bursts (4 corners, fade in with p1)
    p1 = min(result_elapsed / PHASE2_START, 1.0)
    for (bx, by), (sx, sy) in zip(
            [(0,0),(WIN_W,0),(0,FACE_H),(WIN_W,FACE_H)],
            [(1,1),(-1,1),(1,-1),(-1,-1)]):
        for i in range(6):
            angle = math.radians(i * 15 * sx * sy + t * 30)
            dist  = int(18 + i * 8 * p1)
            px_   = bx + int(sx * dist * math.cos(angle))
            py_   = by + int(sy * dist * math.sin(angle))
            alpha = max(0, 1.0 - i * 0.15) * p1
            if 0 <= px_ < WIN_W and 0 <= py_ < FACE_H:
                dot_ov = canvas.copy()
                cv2.circle(dot_ov, (px_, py_), max(1, 3 - i//2),
                           tuple(min(255, int(c * alpha)) for c in color), -1, cv2.LINE_AA)
                cv2.addWeighted(dot_ov, alpha * 0.7, canvas, 1 - alpha * 0.7, 0, canvas)

    # Bottom panel — dark gradient tinted with emotion colour 
    dark_base = tuple(max(0, int(c * 0.14)) for c in color)
    for i in range(BOTTOM_H):
        f = 1 - (i / BOTTOM_H) * 0.6
        canvas[FACE_H + i, :] = tuple(int(dark_base[k] * f) for k in range(3))
    cv2.line(canvas, (0, FACE_H),   (WIN_W, FACE_H),   color, 3)
    cv2.line(canvas, (0, FACE_H+4), (WIN_W, FACE_H+4),
             tuple(int(c * 0.35) for c in color), 1)

    font = cv2.FONT_HERSHEY_DUPLEX
    title, subtitle, emoji_char = EMOJIS.get(label, (label.upper(), "", ""))
    conf = float(np.max(avg_probs)) if avg_probs is not None else 0.0

    in_p2 = result_elapsed >= PHASE2_START
    p2_t  = max(0.0, result_elapsed - PHASE2_START)

    def spring(x: float) -> float:
        x = max(0.0, min(x, 1.0))
        return 1 - math.exp(-6 * x) * math.cos(8 * x)

    # Phase 1: emotion name springs in from bottom 
    name_y     = int(FACE_H + 10 + 38 * spring(p1))
    name_scale = min(0.80 + 0.55 * spring(p1), 1.35)
    name_ov    = canvas.copy()
    put_centered(name_ov, title, name_y, font, name_scale, color, 3)
    cv2.addWeighted(name_ov, p1, canvas, 1 - p1, 0, canvas)

    # Confidence arc (replaces bar) 
    # Draws a thin arc around a circle at bottom-right quadrant of panel
    arc_cx = WIN_W - 52
    arc_cy = FACE_H + 80
    arc_r  = 34
    # Background ring
    cv2.circle(canvas, (arc_cx, arc_cy), arc_r,
               tuple(int(c * 0.18) for c in color), 3, cv2.LINE_AA)
    # Foreground arc sweeps from -90° by conf*360°
    arc_sweep = int(conf * 340 * min(p1 * 1.5, 1.0))
    if arc_sweep > 0:
        cv2.ellipse(canvas, (arc_cx, arc_cy), (arc_r, arc_r),
                    -90, 0, arc_sweep, color, 3, cv2.LINE_AA)
        # Glow on arc tip
        tip_angle = math.radians(-90 + arc_sweep)
        tip_x = int(arc_cx + arc_r * math.cos(tip_angle))
        tip_y = int(arc_cy + arc_r * math.sin(tip_angle))
        tip_ov = canvas.copy()
        cv2.circle(tip_ov, (tip_x, tip_y), 5,
                   tuple(min(255, c + 80) for c in color), -1, cv2.LINE_AA)
        cv2.addWeighted(tip_ov, 0.8, canvas, 0.2, 0, canvas)
    # Percentage text inside arc
    pct_str = f"{int(conf * 100)}%"
    (pw, ph), _ = cv2.getTextSize(pct_str, font, 0.38, 1)
    cv2.putText(canvas, pct_str,
                (arc_cx - pw // 2, arc_cy + ph // 2),
                font, 0.38, tuple(min(255, c + 60) for c in color), 1, cv2.LINE_AA)

    #Phase 2: emoji + typewriter caption 
    if emoji_char:
        if not in_p2:
            # Phase 1 — large emoji, bounces in
            bounce   = math.sin(t * 5) * 3 * (1 - p1 * 0.6)
            emoji_sz = int(48 + 20 * spring(p1))
            emoji_y  = int(FACE_H + 82 + bounce)
            ov_e     = canvas.copy()
            ov_e     = put_emoji_centered(ov_e, emoji_char, emoji_y, font_size=emoji_sz)
            cv2.addWeighted(ov_e, p1, canvas, 1 - p1, 0, canvas)
        else:
            # Phase 2 — emoji shifts left, caption typewriters in on the right
            shrink_t = min(p2_t / 0.35, 1.0)
            emoji_sz = int(62 - 18 * shrink_t)   # 62 → 44
            # x: centre → left-third
            ex = int((WIN_W // 2 - emoji_sz // 2) * (1 - shrink_t)
                     + (WIN_W // 5) * shrink_t)
            ey = FACE_H + 85

            pil_img  = Image.fromarray(cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB))
            draw_pil = ImageDraw.Draw(pil_img)
            efont    = get_emoji_font(emoji_sz)
            try:
                bbox = draw_pil.textbbox((0, 0), emoji_char, font=efont)
                etw  = bbox[2] - bbox[0]
            except AttributeError:
                etw = emoji_sz
            draw_pil.text((ex, ey), emoji_char, font=efont, embedded_color=True)
            canvas = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)

            # Typewriter caption to the right of emoji
            cap_alpha  = min(p2_t / 0.45, 1.0)
            n_chars    = int(p2_t * TYPEWR_SPEED)
            shown_text = subtitle[:n_chars]
            if shown_text:
                cap_x = WIN_W // 5 + emoji_sz + 10
                cap_y = FACE_H + 110
                glow_col = tuple(min(255, c + 110) for c in color)
                cap_ov   = canvas.copy()
                # Shadow
                cv2.putText(cap_ov, shown_text, (cap_x + 1, cap_y + 1),
                            font, 0.42, glow_col, 3, cv2.LINE_AA)
                # Text
                cv2.putText(cap_ov, shown_text, (cap_x, cap_y),
                            font, 0.42, (235, 235, 235), 1, cv2.LINE_AA)
                # Blinking cursor while typing
                if n_chars < len(subtitle):
                    (cw2, ch2), _ = cv2.getTextSize(shown_text, font, 0.42, 1)
                    cur_blink = abs(math.sin(t * 9))
                    cv2.line(cap_ov,
                             (cap_x + cw2 + 3, cap_y - ch2),
                             (cap_x + cw2 + 3, cap_y + 3),
                             tuple(int(c * cur_blink) for c in glow_col), 2, cv2.LINE_AA)
                cv2.addWeighted(cap_ov, cap_alpha, canvas, 1 - cap_alpha, 0, canvas)

            # ENTER prompt fades in after caption finishes
            enter_alpha = min(
                max(p2_t - len(subtitle) / TYPEWR_SPEED - 0.3, 0) / 0.5, 1.0)
            if enter_alpha > 0:
                p3  = 0.35 + 0.65 * abs(math.sin(t * 2.0))
                ec  = tuple(int(100 * p3 * enter_alpha) for _ in range(3))
                ep_ov = canvas.copy()
                put_centered(ep_ov, "PRESS  ENTER  TO  SCAN  AGAIN",
                             FACE_H + 148, font, 0.34, ec, 1, shadow=False)
                cv2.addWeighted(ep_ov, enter_alpha, canvas, 1 - enter_alpha, 0, canvas)

    add_scanlines(canvas)
    return canvas

#  STATE MACHINE
S_WAIT    = 0
S_ALIGN   = 1
S_FLASH   = 2
S_LOAD    = 3
S_CONFIRM = 4
S_RESULT  = 5

state              = S_WAIT
history: deque     = deque(maxlen=SMOOTH_N)
phase_start        = 0.0
result_phase_start = 0.0
final_label        = "Neutral"
final_color: tuple = (200, 200, 200)
final_probs: Optional[np.ndarray]  = None
last_face          = np.zeros((200,200,3), dtype=np.uint8)
snapshot_face: Optional[np.ndarray]             = None
snapshot_crop: Optional[np.ndarray]             = None
snapshot_rect: Optional[Tuple[int,int,int,int]] = None
last_crop:     Optional[np.ndarray]             = None
last_rect:     Optional[Tuple[int,int,int,int]] = None
t_anim      = 0.0
prev_time   = time.time()
enter_pressed = False
face_miss     = 0

cap = cv2.VideoCapture(0)
cap.set(cv2.CAP_PROP_FRAME_WIDTH,  1280)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
if not cap.isOpened():
    print("[ERROR] Cannot open webcam.")
    exit()

WIN_TITLE = "Emotion Detector  |  ENTER=scan  Q=quit"

while True:
    ret, frame = cap.read()
    if not ret:
        break
    frame = cv2.flip(frame, 1)

    now       = time.time()
    dt        = now - prev_time
    prev_time = now
    t_anim   += dt

    face_result = get_face(frame)
    if face_result is not None:
        display_frame, model_crop, face_rect = face_result
    else:
        display_frame = model_crop = face_rect = None  # type: ignore[assignment]

    face_found = face_result is not None
    elapsed    = now - phase_start

    # Transitions ─
    if state == S_WAIT:
        if face_found:
            state = S_ALIGN
            phase_start = now
            last_face = display_frame

    elif state == S_ALIGN:
        if not face_found:
            face_miss += 1
            if face_miss > FACE_MISS_MAX:
                state = S_WAIT
                face_miss = 0
        else:
            face_miss = 0
            last_face = display_frame
            last_crop = model_crop
            last_rect = face_rect
            if elapsed >= ALIGN_SECS and last_face is not None and last_crop is not None:
                snapshot_face = last_face.copy()
                snapshot_crop = last_crop.copy()
                snapshot_rect = last_rect
                state = S_FLASH
                phase_start = now

    elif state == S_FLASH:
        if elapsed >= FLASH_SECS:
            state = S_LOAD
            phase_start = now
            history.clear()
            ema_pred = None
            pred_buffer.clear()
            emotion_buffer.clear()

    elif state == S_LOAD:
        if snapshot_crop is not None and len(history) < SMOOTH_N:
            _lbl, _conf, probs = predict_emotion(snapshot_crop)
            history.append(probs)

        if elapsed >= LOAD_SECS and len(history) >= 1:
            avg = np.mean(history, axis=0)

            # Apply boundary guards to final averaged result (FIXED:
            # previously np.argmax(avg) bypassed all guards)
            best_idx    = apply_boundary_guards(avg)
            final_label = CLASS_NAMES[best_idx]
            final_color = COLORS[final_label]
            final_probs = avg

            top3 = np.argsort(avg)[::-1][:3]
            print(f"[RESULT] {final_label} ({avg[best_idx]*100:.1f}%)  "
                  + " | ".join(f"{CLASS_NAMES[i]} {avg[i]*100:.1f}%" for i in top3)
                  + f"  ({len(history)} passes)")
            state = S_CONFIRM
            phase_start = now

    elif state == S_CONFIRM:
        if elapsed >= CONFIRM_SECS:
            state = S_RESULT
            phase_start = now
            result_phase_start = now
            enter_pressed = False

    elif state == S_RESULT:
        if face_found:
            last_face = display_frame
        if enter_pressed:
            state = S_WAIT
            history.clear()
            enter_pressed = False
            final_probs = None
            ema_pred = None
            pred_buffer.clear()
            emotion_buffer.clear()

    
    _lf: np.ndarray = last_face if last_face is not None else np.zeros((200,200,3), dtype=np.uint8)
    _sf: np.ndarray = snapshot_face if snapshot_face is not None else _lf

    if state == S_WAIT:
        canvas = screen_waiting(t_anim)
    elif state == S_ALIGN:
        canvas = screen_align(_lf, t_anim, elapsed,
                              last_rect if face_found else None)
    elif state == S_FLASH:
        canvas = screen_snapshot_flash(_sf,
                                       max(0.0, 1.0-elapsed/FLASH_SECS))
    elif state == S_LOAD:
        canvas = screen_loading(_sf, t_anim,
                                min(elapsed/LOAD_SECS, 1.0), len(history))
    elif state == S_CONFIRM:
        canvas = screen_confirm(_sf, final_label, final_color,
                                min(elapsed/0.28, 1.0), t_anim)
    elif state == S_RESULT:
        canvas = screen_result(_sf, final_label, final_color,
                               t_anim, final_probs, now-result_phase_start)
    else:
        canvas = screen_waiting(t_anim)

    cv2.imshow(WIN_TITLE, canvas)
    key = cv2.waitKey(1) & 0xFF
    if key in (ord('q'), ord('Q')):
        break
    if key == 13 and state == S_RESULT:
        enter_pressed = True

cap.release()
cv2.destroyAllWindows()
print("[INFO] Done.")