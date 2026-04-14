import os
import numpy as np
import tensorflow as tf
from tensorflow.keras.layers import BatchNormalization
from tensorflow.keras.callbacks import (EarlyStopping, ModelCheckpoint,
                                        ReduceLROnPlateau, CSVLogger)
from sklearn.utils.class_weight import compute_class_weight

#Config 
EPOCHS          = 30
LEARNING_RATE   = 1e-5        
WEIGHT_DECAY    = 1e-4
BATCH_SIZE      = 32
IMG_SIZE        = (224, 224)
NUM_CLASSES     = 7
UNFREEZE_LAYERS = 25           
DATASET_PATH    = r"D:\Facial Emotion Detection\Backend\Dataset"
PHASE5_MODEL    = "models/phase1_best_model.keras"
MODEL_SAVE      = "models/phase2_best_model.keras"
LOG_FILE        = "models/phase2s_training_log.csv"

os.makedirs("models", exist_ok=True)

TRAIN_PATH = os.path.join(DATASET_PATH, "train")
VAL_PATH   = os.path.join(DATASET_PATH, "val")
TEST_PATH  = os.path.join(DATASET_PATH, "test")

#tf.data pipeline 
def load_and_preprocess(path, label):
    img = tf.io.read_file(path)
    img = tf.image.decode_jpeg(img, channels=3)
    img = tf.image.resize(img, IMG_SIZE)
    img = tf.keras.applications.mobilenet_v2.preprocess_input(img)
    return img, label

def augment(img, label):
    img = tf.image.random_flip_left_right(img)
    img = img + tf.random.uniform([], -0.3, 0.3)
    img = tf.clip_by_value(img, -1.0, 1.0)
    img = tf.image.resize_with_crop_or_pad(
        tf.cast(((img + 1.0) / 2.0 * 255.0), tf.float32), 260, 260
    )
    img = tf.image.random_crop(img, size=[224, 224, 3])
    img = tf.keras.applications.mobilenet_v2.preprocess_input(img)
    return img, label

def make_dataset(image_dir, training=False):
    class_names = sorted(os.listdir(image_dir))
    class_indices = {name: i for i, name in enumerate(class_names)}
    paths, labels = [], []
    for class_name in class_names:
        class_dir = os.path.join(image_dir, class_name)
        if not os.path.isdir(class_dir):
            continue
        for fname in os.listdir(class_dir):
            if fname.lower().endswith((".jpg", ".jpeg", ".png")):
                paths.append(os.path.join(class_dir, fname))
                label = [0] * NUM_CLASSES
                label[class_indices[class_name]] = 1
                labels.append(label)
    ds = tf.data.Dataset.from_tensor_slices(
        (paths, tf.cast(labels, tf.float32))
    )
    if training:
        ds = ds.shuffle(buffer_size=len(paths), seed=42)
    ds = ds.map(load_and_preprocess, num_parallel_calls=tf.data.AUTOTUNE)
    if training:
        ds = ds.map(augment, num_parallel_calls=tf.data.AUTOTUNE)
    ds = ds.batch(BATCH_SIZE).prefetch(tf.data.AUTOTUNE)
    return ds, class_indices, len(paths)

print("\n  Building datasets...")
train_ds, class_indices, n_train = make_dataset(TRAIN_PATH, training=True)
val_ds,   _,             n_val   = make_dataset(VAL_PATH,   training=False)
test_ds,  _,             n_test  = make_dataset(TEST_PATH,  training=False)
print(f"  Train : {n_train} | Val : {n_val} | Test : {n_test}")
print(f"  Classes : {class_indices}")

#Class weights 
all_labels = []
for class_name in sorted(os.listdir(TRAIN_PATH)):
    class_dir = os.path.join(TRAIN_PATH, class_name)
    if os.path.isdir(class_dir):
        count = len([f for f in os.listdir(class_dir)
                     if f.lower().endswith((".jpg", ".jpeg", ".png"))])
        all_labels.extend([class_indices[class_name]] * count)

all_labels = np.array(all_labels)
cw = compute_class_weight("balanced", classes=np.unique(all_labels), y=all_labels)
class_weights = dict(enumerate(cw))
print(f"\n  Class weights : {class_weights}")

#Load Phase 5 model 
print("\n  Loading Phase 5 model...")
model = tf.keras.models.load_model(PHASE5_MODEL)
print("  Loaded successfully!")

#Unfreeze top 25 non-BN base layers, keep ALL BN frozen 
HEAD_LAYER_NAMES = ["new_gap",
                    "new_dense_512", "new_bn_512", "new_drop_512",
                    "new_dense_256", "new_bn_256", "new_drop_256",
                    "new_dense_128", "new_bn_128", "new_drop_128",
                    "new_predictions"]

# Step 1: Freeze everything
for layer in model.layers:
    layer.trainable = False

# Step 2: Always keep head trainable
for layer in model.layers:
    if layer.name in HEAD_LAYER_NAMES:
        layer.trainable = True

# Step 3: Unfreeze top 25 non-BN base layers only
unfrozen_count = 0
for layer in reversed(model.layers):
    if layer.name in HEAD_LAYER_NAMES:
        continue
    if unfrozen_count >= UNFREEZE_LAYERS:
        break
    if isinstance(layer, BatchNormalization):
        layer.trainable = False   # Always keep BN frozen
    else:
        layer.trainable = True
        unfrozen_count += 1

#Summary 
trainable_params = sum([tf.size(w).numpy() for w in model.trainable_weights])
frozen_params    = sum([tf.size(w).numpy() for w in model.non_trainable_weights])
bn_frozen        = sum(1 for l in model.layers
                       if isinstance(l, BatchNormalization) and not l.trainable)

print(f"\n  {'='*52}")
print(f"  PHASE 6 MODEL SUMMARY")
print(f"  {'='*52}")
print(f"  Total layers         : {len(model.layers)}")
print(f"  Trainable layers     : {sum(1 for l in model.layers if l.trainable)}")
print(f"  BN layers frozen     : {bn_frozen}  ← prevents val oscillation")
print(f"  Unfrozen base layers : {unfrozen_count}  (was 40, now 25)")
print(f"  Trainable params     : {trainable_params:,}")
print(f"  Frozen params        : {frozen_params:,}")
print(f"  {'='*52}")

#Callbacks 
callbacks = [
    ModelCheckpoint(MODEL_SAVE, monitor="val_accuracy", save_best_only=True, verbose=1),
    EarlyStopping(monitor="val_accuracy", patience=8, restore_best_weights=True, verbose=1),
    ReduceLROnPlateau(monitor="val_loss", factor=0.5, patience=3, min_lr=1e-7, verbose=1),
    CSVLogger(LOG_FILE, append=False)
]

#Compile 
print(f"\n  Compiling | LR={LEARNING_RATE} | WeightDecay={WEIGHT_DECAY}")
print(f"  {UNFREEZE_LAYERS} base layers unfrozen | All BN frozen")
model.compile(
    optimizer=tf.keras.optimizers.AdamW(
        learning_rate=LEARNING_RATE,
        weight_decay=WEIGHT_DECAY
    ),
    loss="categorical_crossentropy",
    metrics=["accuracy"]
)

print(f"\n  Starting Phase 6 (rebuilt) — conservative fine-tuning...")
print(f"  Epochs={EPOCHS} | LR={LEARNING_RATE} | Top {UNFREEZE_LAYERS} base layers unfrozen\n")

#Train 
history = model.fit(
    train_ds,
    epochs=EPOCHS,
    validation_data=val_ds,
    class_weight=class_weights,
    callbacks=callbacks,
    verbose=1
)

#Evaluate on test set 
print("\n  Evaluating on test set...")
results = model.evaluate(test_ds, verbose=1)
test_loss, test_acc = results[0], results[1]

best_val_acc   = max(history.history["val_accuracy"])
best_train_acc = max(history.history["accuracy"])
train_val_gap  = best_train_acc - best_val_acc

print(f"\n{'='*52}")
print(f"  PHASE 6 RESULTS")
print(f"{'='*52}")
print(f"  Best Train Accuracy : {best_train_acc*100:.2f}%")
print(f"  Best Val Accuracy   : {best_val_acc*100:.2f}%")
print(f"  Test Accuracy       : {test_acc*100:.2f}%")
print(f"  Test Loss           : {test_loss:.4f}")
print(f"  Train/Val Gap       : {train_val_gap*100:.2f}%  {'Good' if train_val_gap < 0.08 else 'Overfitting'}")
print(f"{'='*52}")
print(f"\n  Model saved to : {MODEL_SAVE}")
print(f"  Log saved to   : {LOG_FILE}\n")

print(f"{'='*52}")
print(f"  FULL PHASE COMPARISON")
print(f"{'='*52}")
print(f"  Phase 1 → Train: 41.73% | Val: 46.53%")
print(f"  Phase 2 → Train: 76.60% | Val: 70.11%")
print(f"  Phase 3 → Train: 82.19% | Val: 69.94%")
print(f"  Phase 4 → Train: 85.03% | Val: 70.23%")
print(f"  Phase 5 → Train: 77.03% | Val: 71.33%")
print(f"  Phase 6 → Train: {best_train_acc*100:.2f}%  | Val: {best_val_acc*100:.2f}%  | Test: {test_acc*100:.2f}%")
print(f"{'='*52}")
