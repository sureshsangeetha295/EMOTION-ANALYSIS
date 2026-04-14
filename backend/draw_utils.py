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

