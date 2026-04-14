import os
os.environ["TF_USE_LEGACY_KERAS"] = "1"

import cv2
import numpy as np
import tensorflow as tf
from mtcnn import MTCNN

#CONFIG 
MODEL_PATH = r"D:\Facial Emotion Detection\Backend\Models\phase2_best_model.keras"
IMAGE_PATH = r"c:\Users\sures\Downloads\d_test.jpeg" 

IMG_SIZE = (224, 224)
NUM_PASSES = 5

CLASS_NAMES = [
    "Anger",
    "Disgust",
    "Fear",
    "Happiness",
    "Neutral",
    "Sadness",
    "Surprise"
]

# LOAD MODEL 
print("Loading model...")
model = tf.keras.models.load_model(MODEL_PATH, compile=False)
print("Model loaded")

# LOAD IMAGE 
img = cv2.imread(IMAGE_PATH)

if img is None:
    raise RuntimeError("Image not found")

img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

# MTCNN FACE DETECTOR 
detector = MTCNN()
faces = detector.detect_faces(img_rgb)

# FACE CROP 
if not faces:
    print("No face detected, using whole image")
    face = img_rgb
    x, y, w, h = 0, 0, img.shape[1], img.shape[0]
else:
    x, y, w, h = faces[0]["box"]

    # Fix negative coordinates
    x = max(0, x)
    y = max(0, y)

    face = img_rgb[y:y+h, x:x+w]

#  PREPROCESS ─
face = cv2.resize(face, IMG_SIZE)
face = face.astype("float32")

# MobileNetV2 normalization (-1 to 1)
face = tf.keras.applications.mobilenet_v2.preprocess_input(face)

face = np.expand_dims(face, axis=0)

# AVERAGE PREDICTIONS 
predictions = []

for _ in range(NUM_PASSES):
    p = model.predict(face, verbose=0)[0]
    predictions.append(p)

predictions = np.array(predictions)
avg_pred = np.mean(predictions, axis=0)

#  RESULTS 
idx = np.argmax(avg_pred)
emotion = CLASS_NAMES[idx]
confidence = avg_pred[idx] * 100

print("\nPrediction:")
print("Emotion:", emotion)
print("Confidence:", round(confidence, 2), "%")

print("\nAll probabilities:")
for i, e in enumerate(CLASS_NAMES):
    print(f"{e:10s}: {avg_pred[i]*100:.2f}%")

#  DRAW RESULT 
label = f"{emotion} {confidence:.1f}%"

cv2.rectangle(img, (x, y), (x+w, y+h), (0,255,0), 2)

cv2.putText(
    img,
    label,
    (x, y-10),
    cv2.FONT_HERSHEY_SIMPLEX,
    0.9,
    (0,255,0),
    2
)

cv2.imshow("Emotion Prediction", img)
cv2.waitKey(0)
cv2.destroyAllWindows()

