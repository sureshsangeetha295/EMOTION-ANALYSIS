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