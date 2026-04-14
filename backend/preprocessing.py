import os
import numpy as np
import tensorflow as tf
from tensorflow.keras.preprocessing.image import ImageDataGenerator

#Config 
DATASET_PATH = r"D:\Facial Emotion Detection\Dataset"
IMG_SIZE     = (224, 224)
BATCH_SIZE   = 16
SEED         = 42

TRAIN_PATH = os.path.join(DATASET_PATH, "train")
VAL_PATH   = os.path.join(DATASET_PATH, "val")
TEST_PATH  = os.path.join(DATASET_PATH, "test")

# Generators 
# Train — augmentation + MobileNetV2 preprocessing
train_datagen = ImageDataGenerator(
    preprocessing_function=tf.keras.applications.mobilenet_v2.preprocess_input,
    horizontal_flip=True,
    rotation_range=15,
    brightness_range=[0.7, 1.3],
    zoom_range=0.10,
    width_shift_range=0.10,
    height_shift_range=0.10,
    fill_mode="nearest"
)

# Val & Test — only MobileNetV2 preprocessing, no augmentation
val_test_datagen = ImageDataGenerator(
    preprocessing_function=tf.keras.applications.mobilenet_v2.preprocess_input
)

#Data Loaders 
def get_generators():
    train_generator = train_datagen.flow_from_directory(
        TRAIN_PATH,
        target_size=IMG_SIZE,
        batch_size=BATCH_SIZE,
        class_mode="categorical",
        color_mode="rgb",
        shuffle=True,
        seed=SEED
    )

    val_generator = val_test_datagen.flow_from_directory(
        VAL_PATH,
        target_size=IMG_SIZE,
        batch_size=BATCH_SIZE,
        class_mode="categorical",
        color_mode="rgb",
        shuffle=False
    )

    test_generator = val_test_datagen.flow_from_directory(
        TEST_PATH,
        target_size=IMG_SIZE,
        batch_size=BATCH_SIZE,
        class_mode="categorical",
        color_mode="rgb",
        shuffle=False
    )

    return train_generator, val_generator, test_generator

#Verify 
if __name__ == "__main__":
    train_gen, val_gen, test_gen = get_generators()

    print(f"\n{'='*52}")
    print(f"  PREPROCESSING SUMMARY")
    print(f"{'='*52}")
    print(f"  Image size     : {IMG_SIZE}")
    print(f"  Batch size     : {BATCH_SIZE} (optimized for CPU)")
    print(f"  Train images   : {train_gen.samples}")
    print(f"  Val images     : {val_gen.samples}")
    print(f"  Test images    : {test_gen.samples}")
    print(f"  Total images   : {train_gen.samples + val_gen.samples + test_gen.samples}")
    print(f"  Num classes    : {train_gen.num_classes}")
    print(f"\n  Class → Label mapping:")
    for emotion, idx in sorted(train_gen.class_indices.items(), key=lambda x: x[1]):
        print(f"    {idx} → {emotion}")

    # check one batch
    imgs, labels = next(train_gen)
    print(f"\n  Sample batch")
    print(f"  Image tensor shape : {imgs.shape}")       
    print(f"  Labels shape       : {labels.shape}")     
    print(f"  Pixel range        : [{imgs.min():.2f}, {imgs.max():.2f}]")  # [-1, 1]
    print(train_gen.class_indices)
    print(f"{'='*52}\n")

    train_gen, val_gen, test_gen = get_generators()

    
