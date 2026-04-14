import os
os.environ["TF_USE_LEGACY_KERAS"]  = "1"
os.environ["CUDA_VISIBLE_DEVICES"] = "-1"   
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"   

import threading
import cv2
import numpy as np
import tensorflow as tf

tf.get_logger().setLevel("ERROR")


# CONFIG

MODEL_PATH = r"D:\Facial Emotion Detection\Backend\Models\phase2_best_model.keras"
IMG_SIZE   = (224, 224)

CLASS_NAMES = ["Anger", "Disgust", "Fear", "Happiness", "Neutral", "Sadness", "Surprise"]


_model         = None
_haar_detector = None
_mtcnn         = None

_model_lock = threading.Lock()
_haar_lock  = threading.Lock()
_mtcnn_lock = threading.Lock()


def get_model():
    global _model
    if _model is None:                       # fast path — no lock overhead
        with _model_lock:                    # slow path — serialise loading
            if _model is None:               # double-checked locking
                print("[EmotionAI] Loading model...")
                _model = tf.keras.models.load_model(MODEL_PATH, compile=False)
                dummy  = np.zeros((1, 224, 224, 3), dtype="float32")
                _model.predict(dummy, verbose=0)
                print("[EmotionAI] Model loaded and warmed up")
    return _model


def get_haar_detector():
    global _haar_detector
    if _haar_detector is None:
        with _haar_lock:
            if _haar_detector is None:
                print("[EmotionAI] Loading Haar Cascade...")
                path = os.path.join(
                    cv2.data.haarcascades,                        # type: ignore
                    "haarcascade_frontalface_default.xml"
                )
                _haar_detector = cv2.CascadeClassifier(path)
                print("[EmotionAI] Haar Cascade ready")
    return _haar_detector


def get_mtcnn():
    global _mtcnn
    if _mtcnn is None:
        with _mtcnn_lock:
            if _mtcnn is None:
                print("[EmotionAI] Loading MTCNN (slow on CPU)...")
                from mtcnn import MTCNN
                _mtcnn = MTCNN()
                print("[EmotionAI] MTCNN ready")
    return _mtcnn



def get_detector():
    return get_haar_detector()


# FACE DETECTION HELPERS


def _detect_face_haar(img_rgb: np.ndarray):
    """Fast (~5-15 ms). Primary detector used for every live frame."""
    detector = get_haar_detector()
    gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)

    faces = detector.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=4,
        minSize=(60, 60),
        flags=cv2.CASCADE_SCALE_IMAGE,
    )

    if len(faces) == 0:
        return None

    x, y, w, h = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)[0]
    x, y = max(0, x), max(0, y)

    mx = int(w * 0.10)
    my = int(h * 0.10)
    x1 = max(0, x - mx)
    y1 = max(0, y - my)
    x2 = min(img_rgb.shape[1], x + w + mx)
    y2 = min(img_rgb.shape[0], y + h + my)

    face = img_rgb[y1:y2, x1:x2]
    return face if face.size > 0 else None


def _detect_face_mtcnn(img_rgb: np.ndarray):
    faces = get_mtcnn().detect_faces(img_rgb)
    if not faces:
        return None
    x, y, w, h = faces[0]["box"]
    x, y = max(0, x), max(0, y)
    face = img_rgb[y: y + h, x: x + w]
    return face if face.size > 0 else None


# MAIN PREDICTION FUNCTION

def predict_emotion_from_image(img: np.ndarray, use_mtcnn: bool = False):
    
    if img.ndim != 3 or img.shape[2] != 3:
        raise ValueError("Expected RGB image with shape (H, W, 3)")

    face = _detect_face_mtcnn(img) if use_mtcnn else _detect_face_haar(img)

    # Always return a result — fall back to full frame if no face detected
    if face is None:
        face = img

    face = cv2.resize(face, IMG_SIZE)
    face = face.astype("float32")
    face = tf.keras.applications.mobilenet_v2.preprocess_input(face)
    face = np.expand_dims(face, axis=0)   # (1, 224, 224, 3)

    probs      = get_model().predict(face, verbose=0)[0]
    idx        = int(np.argmax(probs))
    confidence = float(probs[idx] * 100)

    return idx, confidence, probs.tolist()