import os
import numpy as np
from sklearn.utils.class_weight import compute_class_weight

#Config 
DATASET_PATH = r"D:\Facial Emotion Detection\Backend\Dataset"
TRAIN_PATH   = os.path.join(DATASET_PATH, "train")

#Compute Class Weights 
def get_class_weights(train_generator):
    """
    Computes class weights from the train generator.
    Minority classes (Fear, Disgust) get higher weights,
    majority classes (Happiness) get lower weights.
    """
    class_indices = train_generator.class_indices          # {'Anger': 0, ...}
    labels        = train_generator.classes                # array of label per image

    classes = np.unique(labels)

    weights = compute_class_weight(
        class_weight="balanced",        #total sample/no:classes*sample in each class
        classes=classes,
        y=labels
    )

    class_weights = dict(zip(classes, weights))  #keras expect dict
    return class_weights, class_indices

#Verify 
if __name__ == "__main__":
    # need to import generator from preprocessing
    from real_preprocessing import get_generators

    train_gen, _, _ = get_generators()
    class_weights, class_indices = get_class_weights(train_gen)

    # reverse map: index → emotion name
    idx_to_emotion = {v: k for k, v in class_indices.items()}

    print(f"\n{'='*52}")
    print(f"  CLASS WEIGHTS SUMMARY")
    print(f"{'='*52}")
    print(f"  {'Emotion':<12} {'Images':>8} {'Weight':>10}") #table format
    print(f"  {'-'*34}")

    for idx, weight in sorted(class_weights.items()): #class by class
        emotion    = idx_to_emotion[idx]
        img_count  = np.sum(train_gen.classes == idx)
        print(f"  {emotion:<12} {img_count:>8} {weight:>10.4f}")

    print(f"  {'-'*34}")
    print(f"  {'TOTAL':<12} {len(train_gen.classes):>8}")
    print(f"{'='*52}")
    print(f"\n  Higher weight → model penalized more for misclassifying that class")
    print(f"  Lower weight  → model penalized less (already has enough samples)\n")
