import os
import numpy as np
from PIL import Image
from collections import defaultdict

# ── Config ────────────────────────────────────────────────────────────────────
DATASET_PATH = r"D:\Facial Emotion Detection\Backend\Dataset"

EMOTION_MAP = {
    "1": "Surprise",
    "2": "Fear",
    "3": "Disgust",
    "4": "Happiness",
    "5": "Sadness",
    "6": "Anger",
    "7": "Neutral"
}

# ── Helper ────────────────────────────────────────────────────────────────────
def is_grayscale(img):
    if img.mode in ("L", "LA", "P"):
        return True
    arr = np.array(img.convert("RGB"))
    r, g, b = arr[:,:,0], arr[:,:,1], arr[:,:,2]
    return np.array_equal(r, g) and np.array_equal(g, b)

def analyze_split(split_name):
    split_path = os.path.join(DATASET_PATH, split_name)
    stats = {}

    for folder in sorted(os.listdir(split_path)):
        folder_path = os.path.join(split_path, folder)
        if not os.path.isdir(folder_path):
            continue

        emotion = EMOTION_MAP.get(folder, f"Unknown({folder})")
        counts  = defaultdict(int)

        for fname in os.listdir(folder_path):
            if not fname.lower().endswith((".jpg", ".jpeg", ".png", ".bmp")):
                continue
            try:
                img = Image.open(os.path.join(folder_path, fname))
                counts["Grayscale" if is_grayscale(img) else "Colored"] += 1
            except Exception as e:
                print(f"  [Warning] Could not read {fname}: {e}")

        counts["Total"] = counts["Colored"] + counts["Grayscale"]
        stats[emotion]  = dict(counts)

    return stats

# ── Main ──────────────────────────────────────────────────────────────────────
def print_split(split_name, stats):
    print(f"\n{'='*52}")
    print(f"  {split_name.upper()} SET")
    print(f"{'='*52}")
    print(f"  {'Emotion':<12} {'Colored':>9} {'Grayscale':>11} {'Total':>7}")
    print(f"  {'-'*46}")

    total_c = total_g = total_t = 0
    for emotion, counts in stats.items():
        c, g, t = counts.get("Colored", 0), counts.get("Grayscale", 0), counts.get("Total", 0)
        print(f"  {emotion:<12} {c:>9} {g:>11} {t:>7}")
        total_c += c; total_g += g; total_t += t

    print(f"  {'-'*46}")
    print(f"  {'TOTAL':<12} {total_c:>9} {total_g:>11} {total_t:>7}")
    return total_c, total_g, total_t

def main():
    grand_c = grand_g = grand_t = 0

    for split in ["train", "test"]:
        stats = analyze_split(split)
        c, g, t = print_split(split, stats)
        grand_c += c; grand_g += g; grand_t += t

    print(f"\n{'='*52}")
    print(f"  OVERALL SUMMARY")
    print(f"{'='*52}")
    print(f"  Total Colored   : {grand_c}")
    print(f"  Total Grayscale : {grand_g}")
    print(f"  Grand Total     : {grand_t}")
    print(f"{'='*52}\n")

if __name__ == "__main__":
    main()
