import os
os.environ["TF_USE_LEGACY_KERAS"]  = "1"
os.environ["CUDA_VISIBLE_DEVICES"] = "-1"
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"

import threading
from typing import Any
import cv2
import numpy as np
import tensorflow as tf

tf.get_logger().setLevel("ERROR")


# CONFIG

MODEL_PATH  = r"D:\Facial Emotion Detection\Backend\Models\phase2_best_model.keras"
IMG_SIZE    = (224, 224)
CLASS_NAMES = ["Anger", "Disgust", "Fear", "Happiness", "Neutral", "Sadness", "Surprise"]


_model:         Any = None
_haar_detector: Any = None
_mtcnn:         Any = None

_model_lock = threading.Lock()
_haar_lock  = threading.Lock()
_mtcnn_lock = threading.Lock()


def get_model() -> Any:
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                _model = tf.keras.models.load_model(MODEL_PATH, compile=False)
                dummy  = np.zeros((1, 224, 224, 3), dtype="float32")
                _model.predict(dummy, verbose=0)
    return _model


def get_haar_detector() -> Any:
    global _haar_detector
    if _haar_detector is None:
        with _haar_lock:
            if _haar_detector is None:
                haarcascades_path: str = getattr(cv2, "data").haarcascades  # type: ignore[attr-defined]
                path = os.path.join(haarcascades_path, "haarcascade_frontalface_default.xml")
                _haar_detector = cv2.CascadeClassifier(path)
    return _haar_detector


def get_mtcnn() -> Any:
    global _mtcnn
    if _mtcnn is None:
        with _mtcnn_lock:
            if _mtcnn is None:
                from mtcnn import MTCNN
                _mtcnn = MTCNN()
    return _mtcnn


def get_detector() -> Any:
    return get_haar_detector()


# FACE DETECTION HELPERS


def _detect_face_haar(img_rgb: np.ndarray) -> "np.ndarray | None":
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
    x, y = max(0, int(x)), max(0, int(y))
    w, h = int(w), int(h)

    mx = int(w * 0.10)
    my = int(h * 0.10)
    x1 = max(0, x - mx)
    y1 = max(0, y - my)
    x2 = min(img_rgb.shape[1], x + w + mx)
    y2 = min(img_rgb.shape[0], y + h + my)

    face: np.ndarray = img_rgb[y1:y2, x1:x2]
    return face if face.size > 0 else None


def _detect_face_mtcnn(img_rgb: np.ndarray) -> "np.ndarray | None":
    detections: list[dict[str, Any]] = get_mtcnn().detect_faces(img_rgb)
    if not detections:
        return None
    det = detections[0]
    x, y, w, h = det["box"]
    x, y = max(0, int(x)), max(0, int(y))
    face: np.ndarray = img_rgb[y: y + int(h), x: x + int(w)]
    return face if face.size > 0 else None


# MULTI-FACE DETECTION HELPERS

FaceCrop = tuple[np.ndarray, int, int, int, int]


def _detect_all_faces_haar(img_rgb: np.ndarray) -> list[FaceCrop]:
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
        return []

    crops: list[FaceCrop] = []
    for x, y, w, h in faces:
        mx = int(w * 0.10)
        my = int(h * 0.10)
        x1 = max(0, int(x) - mx)
        y1 = max(0, int(y) - my)
        x2 = min(img_rgb.shape[1], int(x) + int(w) + mx)
        y2 = min(img_rgb.shape[0], int(y) + int(h) + my)
        face: np.ndarray = img_rgb[y1:y2, x1:x2]
        if face.size > 0:
            crops.append((face, int(x), int(y), int(w), int(h)))
    return crops


def _detect_all_faces_mtcnn(img_rgb: np.ndarray) -> list[FaceCrop]:
    detections: list[dict[str, Any]] = get_mtcnn().detect_faces(img_rgb)
    if not detections:
        return []

    crops: list[FaceCrop] = []
    for det in detections:
        x, y, w, h = det["box"]
        x, y = max(0, int(x)), max(0, int(y))
        face: np.ndarray = img_rgb[y: y + int(h), x: x + int(w)]
        if face.size > 0:
            crops.append((face, int(x), int(y), int(w), int(h)))
    return crops


# MAIN PREDICTION FUNCTION

def predict_emotion_from_image(
    img: np.ndarray,
    use_mtcnn: bool = False,
) -> tuple[int, float, list[float]]:

    if img.ndim != 3 or img.shape[2] != 3:
        raise ValueError("Expected RGB image with shape (H, W, 3)")

    face: "np.ndarray | None" = (
        _detect_face_mtcnn(img) if use_mtcnn else _detect_face_haar(img)
    )

    face_img: np.ndarray = img if face is None else face
    face_img = cv2.resize(face_img, IMG_SIZE)
    face_img = face_img.astype("float32")
    face_img = tf.keras.applications.mobilenet_v2.preprocess_input(face_img)
    face_img = np.expand_dims(face_img, axis=0)  # (1, 224, 224, 3)

    raw_preds: np.ndarray = np.array(get_model().predict(face_img, verbose=0))
    probs: np.ndarray     = raw_preds[0]
    idx                   = int(np.argmax(probs))
    confidence            = float(probs[idx] * 100)

    return idx, confidence, probs.tolist()


def predict_emotions_multi(
    img: np.ndarray,
    use_mtcnn: bool = False,
) -> "list[dict[str, Any]]":
    """
    Detect ALL faces in *img* and return one prediction dict per face.

    Each dict contains:
        face_index   - 0-based index (left-to-right by x position)
        bbox         - {"x": int, "y": int, "w": int, "h": int}
        emotion      - top-1 class label (str)
        confidence   - 0-100 float
        all_probs    - list[float] aligned with CLASS_NAMES

    Falls back to the whole frame (single face) when no faces are detected,
    matching the behaviour of predict_emotion_from_image().
    """
    if img.ndim != 3 or img.shape[2] != 3:
        raise ValueError("Expected RGB image with shape (H, W, 3)")

    face_crops: list[FaceCrop] = (
        _detect_all_faces_mtcnn(img) if use_mtcnn else _detect_all_faces_haar(img)
    )

    if not face_crops:
        face_crops = [(img, 0, 0, int(img.shape[1]), int(img.shape[0]))]

    face_crops = sorted(face_crops, key=lambda t: t[1])

    model = get_model()

    batch: list[np.ndarray] = []
    for (face, *_) in face_crops:
        resized: np.ndarray = cv2.resize(face, IMG_SIZE)
        resized = resized.astype("float32")
        resized = tf.keras.applications.mobilenet_v2.preprocess_input(resized)
        batch.append(resized)

    batch_arr:  np.ndarray = np.stack(batch, axis=0)
    pred_array: np.ndarray = np.array(model.predict(batch_arr, verbose=0))  # (N, num_classes)

    results: list[dict[str, Any]] = []
    for i, ((face, x, y, w, h), probs) in enumerate(zip(face_crops, pred_array)):
        idx        = int(np.argmax(probs))
        confidence = float(probs[idx] * 100)
        results.append({
            "face_index": i,
            "bbox":       {"x": x, "y": y, "w": w, "h": h},
            "emotion":    CLASS_NAMES[idx],
            "confidence": round(confidence, 2),
            "all_probs":  [round(float(p), 6) for p in probs.tolist()],
        })

    return results