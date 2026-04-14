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
from face_pipeline import predict_emotion, get_face, assign_face_id
from draw_utils import *
from screen_states import *

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