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
from face_pipeline import predict_emotion, get_face
from draw_utils import *

def screen_waiting(t: float) -> np.ndarray:
    canvas = make_gradient(WIN_H, WIN_W, (4,4,14), (14,6,28))
    add_noise(canvas, 3)
    draw_hex_grid(canvas, t, FACE_H)

    cx, cy  = WIN_W//2, FACE_H//2-20
    pulse_r = int(90 + 12*math.sin(t*1.8))
    draw_glowing_circle(canvas, cx, cy, pulse_r,      (60,40,120))
    draw_glowing_circle(canvas, cx, cy, pulse_r-22,   (40,30,90))
    cv2.ellipse(canvas, (cx,cy-8),  (38,46), 0,0,360, (70,55,130), 2, cv2.LINE_AA)
    cv2.ellipse(canvas, (cx,cy+32), (30,18), 0,0,180, (70,55,130), 2, cv2.LINE_AA)
    scan_y = cy-46+int(92*((math.sin(t*1.4)+1)/2))
    cv2.line(canvas, (cx-38,scan_y),(cx+38,scan_y),(80,60,180),1,cv2.LINE_AA)
    for i in range(6):
        angle = t*0.9+i*(2*math.pi/6)
        ox,oy = int(cx+pulse_r*math.cos(angle)), int(cy+pulse_r*math.sin(angle))
        ci    = 0.5+0.5*math.sin(t*2+i)
        cv2.circle(canvas, (ox,oy), 3 if i%2==0 else 2,
                   tuple(int(c*ci) for c in (120,80,220)), -1, cv2.LINE_AA)

    font = cv2.FONT_HERSHEY_DUPLEX
    put_centered(canvas,"STEP INTO FRAME",             cy+88,  font,0.88,(160,130,255),2)
    put_centered(canvas,"Position your face to begin", cy+118, font,0.45,(80,65,130), 1,shadow=False)
    for (bx,by),(sx,sy) in zip(
            [(12,12),(WIN_W-12,12),(12,FACE_H-12),(WIN_W-12,FACE_H-12)],
            [(1,1),(-1,1),(1,-1),(-1,-1)]):
        cv_ = int(60+40*abs(math.sin(t*1.5)))
        cc  = (cv_, cv_//2, cv_*2)
        cv2.line(canvas,(bx,by),(bx+sx*22,by),   cc,2,cv2.LINE_AA)
        cv2.line(canvas,(bx,by),(bx,by+sy*22),   cc,2,cv2.LINE_AA)

    cv2.rectangle(canvas,(0,FACE_H),(WIN_W,WIN_H),(8,6,16),-1)
    cv2.line(canvas,(0,FACE_H),(WIN_W,FACE_H),(50,35,100),2)
    aw = int(WIN_W*(0.5+0.5*abs(math.sin(t*0.7))))
    ax = (WIN_W-aw)//2
    cv2.line(canvas,(ax,FACE_H+1),(ax+aw,FACE_H+1),(90,60,180),1)
    put_centered(canvas,"EMOTION DETECTOR",                   FACE_H+52,  font,0.78,(110,80,200),2)
    put_centered(canvas,"NEURAL NETWORK  |  RAF-DB  MODEL",  FACE_H+88,  font,0.38,(55,42,100), 1,shadow=False)
    put_centered(canvas,"MobileNetV2  +  Prior Calibration", FACE_H+114, font,0.36,(40,32,80),  1,shadow=False)
    add_scanlines(canvas)
    return canvas


def screen_align(face_bgr: np.ndarray, t: float, elapsed: float,
                 face_rect: Optional[Tuple[int,int,int,int]] = None) -> np.ndarray:
    canvas     = np.zeros((WIN_H,WIN_W,3),dtype=np.uint8)
    face_panel = cv2.resize(face_bgr,(WIN_W,FACE_H))
    gray_face  = cv2.cvtColor(cv2.cvtColor(face_panel,cv2.COLOR_BGR2GRAY),cv2.COLOR_GRAY2BGR)
    canvas[:FACE_H] = cv2.addWeighted(face_panel,0.60,gray_face,0.40,0)

    progress      = min(elapsed/ALIGN_SECS,1.0)
    blink_v       = int(180+75*math.sin(t*5))
    green_v       = int(220*(1-progress)+255*progress)
    bracket_color = (40,green_v,blink_v//2)
    cx, cy        = WIN_W//2, FACE_H//2

    if face_rect is not None:
        fh_orig,fw_orig = face_bgr.shape[:2]
        rx,ry,rw,rh = face_rect
        dx  = int(rx*WIN_W/fw_orig);  dy  = int(ry*FACE_H/fh_orig)
        dw  = int(rw*WIN_W/fw_orig);  dh  = int(rh*FACE_H/fh_orig)
        bx1 = max(0,       dx-int(dw*0.18))
        by1 = max(0,       dy-int(dh*0.18))
        bx2 = min(WIN_W-1, dx+dw+int(dw*0.18))
        by2 = min(FACE_H-1,dy+dh+int(dh*0.18))
        for gi in range(4,0,-1):
            ov = canvas.copy()
            cv2.rectangle(ov,(bx1-gi*3,by1-gi*3),(bx2+gi*3,by2+gi*3),bracket_color,1)
            cv2.addWeighted(ov,0.08*gi*progress,canvas,1-0.08*gi*progress,0,canvas)
        draw_brackets(canvas,bx1,by1,bx2-bx1,by2-by1,bracket_color,size=28,thick=3)
        fcx,fcy = (bx1+bx2)//2,(by1+by2)//2
        cv2.line(canvas,(fcx-14,fcy),(fcx+14,fcy),bracket_color,1,cv2.LINE_AA)
        cv2.line(canvas,(fcx,fcy-14),(fcx,fcy+14),bracket_color,1,cv2.LINE_AA)
    else:
        m=50
        draw_brackets(canvas,m,m,WIN_W-2*m,FACE_H-2*m,bracket_color,size=38,thick=3)
        cv2.ellipse(canvas,(cx,cy),(120,155),0,0,360,bracket_color,2,cv2.LINE_AA)

    ring_r=44
    draw_glowing_circle(canvas,cx,cy+FACE_H//3+20,ring_r,
                        tuple(int(c*progress) for c in (60,255,120)))
    cv2.ellipse(canvas,(cx,cy+FACE_H//3+20),(ring_r,ring_r),
                -90,-90,int(-90+360*progress),(60,255,120),3,cv2.LINE_AA)
    remain=f"{max(0,ALIGN_SECS-elapsed):.1f}s"
    font=cv2.FONT_HERSHEY_DUPLEX
    (tw,th),_=cv2.getTextSize(remain,font,0.55,1)
    cv2.putText(canvas,remain,(cx-tw//2,cy+FACE_H//3+20+th//2),
                font,0.55,(60,255,120),1,cv2.LINE_AA)

    bar_y=FACE_H-6
    cv2.rectangle(canvas,(0,bar_y),(WIN_W,FACE_H),(15,18,15),-1)
    for xi in range(int(progress*WIN_W)):
        t2=xi/WIN_W
        cv2.line(canvas,(xi,bar_y),(xi,FACE_H),
                 (int(40+t2*80),int(200+t2*55),int(80+t2*100)),1)

    cv2.rectangle(canvas,(0,FACE_H),(WIN_W,WIN_H),(8,12,10),-1)
    cv2.line(canvas,(0,FACE_H),(WIN_W,FACE_H),(60,220,100),3)
    put_centered(canvas,"LOOK  STRAIGHT",                          FACE_H+55,font,1.05,(60,240,120),3)
    put_centered(canvas,"Keep still  --  capturing your expression",
                 FACE_H+90,font,0.40,(40,130,60),1,shadow=False)
    dx0=WIN_W//2-5*14//2
    for i in range(5):
        da=0.2+0.8*abs(math.sin((t*3+i*0.4)%(2*math.pi)))
        cv2.circle(canvas,(dx0+i*14,FACE_H+112),3,
                   (int(60*da),int(220*da),int(90*da)),-1,cv2.LINE_AA)
    add_scanlines(canvas)
    return canvas


def screen_snapshot_flash(face_bgr: np.ndarray, flash_alpha: float) -> np.ndarray:
    canvas     = np.zeros((WIN_H,WIN_W,3),dtype=np.uint8)
    face_panel = cv2.resize(face_bgr,(WIN_W,FACE_H))
    canvas[:FACE_H] = face_panel
    flash=np.ones((FACE_H,WIN_W,3),dtype=np.uint8)*255
    cv2.addWeighted(flash,flash_alpha,canvas[:FACE_H],1-flash_alpha,0,canvas[:FACE_H])
    cv2.rectangle(canvas,(0,FACE_H),(WIN_W,WIN_H),(20,22,18),-1)
    cv2.line(canvas,(0,FACE_H),(WIN_W,FACE_H),(255,255,255),3)
    font=cv2.FONT_HERSHEY_DUPLEX
    put_centered(canvas,"CAPTURED!",FACE_H+58,font,1.2, (255,255,255),3)
    put_centered(canvas,"Snap!",    FACE_H+96,font,0.55,(180,180,180),1,shadow=False)
    return canvas


def screen_loading(face_bgr: np.ndarray, t: float,
                   progress: float, pass_count: int) -> np.ndarray:
    canvas     = np.zeros((WIN_H,WIN_W,3),dtype=np.uint8)
    face_panel = cv2.resize(face_bgr,(WIN_W,FACE_H))
    canvas[:FACE_H] = (face_panel*0.15).astype(np.uint8)

    for row in range(-1,FACE_H//22+2):
        for col in range(-1,WIN_W//22+2):
            hs=20
            hcx=int(col*hs*1.73); hcy=int(row*hs*2)+(hs if col%2==1 else 0)
            pts=[(int(hcx+hs*math.cos(math.radians(60*i+30))),
                  int(hcy+hs*math.sin(math.radians(60*i+30)))) for i in range(6)]
            phase=(hcx/WIN_W+hcy/FACE_H+t*0.5)%1.0
            if hcy<FACE_H:
                bright=int(14+10*abs(math.sin(phase*math.pi*2)))
                cv2.polylines(canvas,[np.array(pts,dtype=np.int32)],True,
                              (bright,bright+10,bright+5),1)

    rcx,rcy=WIN_W//2,FACE_H//2-30
    rc=(80,220,170)
    for ri in range(3):
        rp=(t*2+ri*0.5)%3.0
        ring_r=int(80+ri*35+rp*15)
        ring_a=max(0.0,1.0-rp/3.0)*0.3
        ov=canvas.copy()
        cv2.circle(ov,(rcx,rcy),ring_r,rc,1,cv2.LINE_AA)
        cv2.addWeighted(ov,ring_a,canvas,1-ring_a,0,canvas)

    draw_robot_face(canvas,rcx,rcy,t,rc,blink=(int(t*2)%5==0))
    draw_spinner(canvas,rcx,rcy,t,radius=120,color=rc)

    font=cv2.FONT_HERSHEY_DUPLEX
    pct=f"{int(progress*100)}%"
    (tw,th),_=cv2.getTextSize(pct,font,0.7,1)
    cv2.putText(canvas,pct,(rcx-tw//2,rcy+105+th),font,0.7,rc,1,cv2.LINE_AA)
    put_centered(canvas,f"Pass {min(pass_count,SMOOTH_N)} / {SMOOTH_N}  --  MTCNN aligned",
                 rcy+128,font,0.40,(80,150,120),1,shadow=False)

    bar_y=FACE_H-8
    cv2.rectangle(canvas,(0,bar_y),(WIN_W,FACE_H),(12,16,14),-1)
    for xi in range(int(progress*WIN_W)):
        t2=xi/WIN_W
        cv2.line(canvas,(xi,bar_y+1),(xi,FACE_H-1),
                 (int(40+t2*60),int(180+t2*40),int(120+t2*50)),1)

    cv2.rectangle(canvas,(0,FACE_H),(WIN_W,WIN_H),(6,10,8),-1)
    cv2.line(canvas,(0,FACE_H),(WIN_W,FACE_H),(50,100,70),2)
    put_centered(canvas,"ANALYSING...",FACE_H+52,font,1.0,(80,200,140),2)
    dx0=WIN_W//2-5*16//2
    for i in range(5):
        da=0.15+0.85*abs(math.sin((t*3.5+i*0.5)%(2*math.pi)))
        cv2.circle(canvas,(dx0+i*16,FACE_H+85),4,
                   tuple(int(c*da) for c in (60,200,140)),-1,cv2.LINE_AA)
    put_centered(canvas,"Temperature Scaling  +  Prior Calibration",
                 FACE_H+116,font,0.35,(35,65,48),1,shadow=False)
    add_scanlines(canvas)
    return canvas


def screen_confirm(face_bgr: np.ndarray, label: str, color: tuple,
                   alpha: float, t: float) -> np.ndarray:
    canvas     = np.zeros((WIN_H,WIN_W,3),dtype=np.uint8)
    face_panel = cv2.resize(face_bgr,(WIN_W,FACE_H))
    canvas[:FACE_H] = (face_panel*0.20).astype(np.uint8)
    cx,cy = WIN_W//2,FACE_H//2
    for ri in range(5):
        glow_r=int((50+ri*25)*alpha)
        glow_a=max(0,0.12-ri*0.02)*alpha
        if glow_r>0:
            ov=canvas.copy()
            cv2.circle(ov,(cx,cy),glow_r,color,-1)
            cv2.addWeighted(ov,glow_a,canvas,1-glow_a,0,canvas)
    cv2.circle(canvas,(cx,cy),int(65*alpha),color,2,cv2.LINE_AA)
    ring_r=int(80*alpha)
    if ring_r>0:
        cv2.ellipse(canvas,(cx,cy),(ring_r,ring_r),
                    t*90,0,int(300*alpha),color,2,cv2.LINE_AA)
    draw_checkmark(canvas,cx,cy,color,size=int(48*alpha))
    for i in range(12):
        ang=i*(2*math.pi/12)+t*2
        dist=int(90*alpha)
        cv2.circle(canvas,
                   (cx+int(dist*math.cos(ang)),cy+int(dist*math.sin(ang))),
                   max(1,int(4*(1-alpha)+2)),color,-1,cv2.LINE_AA)
    cv2.rectangle(canvas,(0,FACE_H),(WIN_W,WIN_H),(8,8,12),-1)
    cv2.line(canvas,(0,FACE_H),(WIN_W,FACE_H),color,3)
    font=cv2.FONT_HERSHEY_DUPLEX
    put_centered(canvas,"GOT IT!",           FACE_H+56,font,1.15,color,        2)
    put_centered(canvas,"Revealing result...",FACE_H+94,font,0.45,(100,100,100),1,shadow=False)
    add_scanlines(canvas)
    return canvas


def screen_result(face_bgr: np.ndarray, label: str, color: tuple,
                  t: float, avg_probs: Optional[np.ndarray],
                  result_elapsed: float = 0.0) -> np.ndarray:
    
    PHASE2_START = 1.0
    TYPEWR_SPEED = 16

    # Face panel 
    canvas     = np.zeros((WIN_H, WIN_W, 3), dtype=np.uint8)
    face_panel = cv2.resize(face_bgr, (WIN_W, FACE_H))
    canvas[:FACE_H] = face_panel

    # Vignette
    vy   = ((np.arange(FACE_H) - FACE_H/2) / (FACE_H/2)) ** 2
    vx   = ((np.arange(WIN_W)  - WIN_W/2)  / (WIN_W/2))  ** 2
    vign = np.clip(1 - np.outer(vy, np.ones(WIN_W))
                     - np.outer(np.ones(FACE_H), vx) * 0.50, 0, 1).astype(np.float32)
    for ch in range(3):
        canvas[:FACE_H, :, ch] = (canvas[:FACE_H, :, ch] * vign).astype(np.uint8)

    # Pulsing coloured border
    pulse = 0.60 + 0.40 * math.sin(t * 2.2)
    pc    = tuple(min(255, int(c * pulse)) for c in color)
    cv2.rectangle(canvas, (0, 0),   (WIN_W-1, FACE_H-1), pc, 5)
    cv2.rectangle(canvas, (7, 7),   (WIN_W-8, FACE_H-8),
                  tuple(int(c * 0.25) for c in color), 1)

    # Moving scan line
    scan_y = int(FACE_H//2 + (FACE_H//3) * math.sin(t * 1.3))
    sl = canvas[:FACE_H].copy()
    cv2.line(sl, (0, scan_y), (WIN_W, scan_y), color, 1, cv2.LINE_AA)
    cv2.addWeighted(sl, 0.18, canvas[:FACE_H], 0.82, 0, canvas[:FACE_H])

    # Corner particle bursts (4 corners, fade in with p1)
    p1 = min(result_elapsed / PHASE2_START, 1.0)
    for (bx, by), (sx, sy) in zip(
            [(0,0),(WIN_W,0),(0,FACE_H),(WIN_W,FACE_H)],
            [(1,1),(-1,1),(1,-1),(-1,-1)]):
        for i in range(6):
            angle = math.radians(i * 15 * sx * sy + t * 30)
            dist  = int(18 + i * 8 * p1)
            px_   = bx + int(sx * dist * math.cos(angle))
            py_   = by + int(sy * dist * math.sin(angle))
            alpha = max(0, 1.0 - i * 0.15) * p1
            if 0 <= px_ < WIN_W and 0 <= py_ < FACE_H:
                dot_ov = canvas.copy()
                cv2.circle(dot_ov, (px_, py_), max(1, 3 - i//2),
                           tuple(min(255, int(c * alpha)) for c in color), -1, cv2.LINE_AA)
                cv2.addWeighted(dot_ov, alpha * 0.7, canvas, 1 - alpha * 0.7, 0, canvas)

    # Bottom panel — dark gradient tinted with emotion colour 
    dark_base = tuple(max(0, int(c * 0.14)) for c in color)
    for i in range(BOTTOM_H):
        f = 1 - (i / BOTTOM_H) * 0.6
        canvas[FACE_H + i, :] = tuple(int(dark_base[k] * f) for k in range(3))
    cv2.line(canvas, (0, FACE_H),   (WIN_W, FACE_H),   color, 3)
    cv2.line(canvas, (0, FACE_H+4), (WIN_W, FACE_H+4),
             tuple(int(c * 0.35) for c in color), 1)

    font = cv2.FONT_HERSHEY_DUPLEX
    title, subtitle, emoji_char = EMOJIS.get(label, (label.upper(), "", ""))
    conf = float(np.max(avg_probs)) if avg_probs is not None else 0.0

    in_p2 = result_elapsed >= PHASE2_START
    p2_t  = max(0.0, result_elapsed - PHASE2_START)

    def spring(x: float) -> float:
        x = max(0.0, min(x, 1.0))
        return 1 - math.exp(-6 * x) * math.cos(8 * x)

    # Phase 1: emotion name springs in from bottom 
    name_y     = int(FACE_H + 10 + 38 * spring(p1))
    name_scale = min(0.80 + 0.55 * spring(p1), 1.35)
    name_ov    = canvas.copy()
    put_centered(name_ov, title, name_y, font, name_scale, color, 3)
    cv2.addWeighted(name_ov, p1, canvas, 1 - p1, 0, canvas)

    # Confidence arc (replaces bar) 
    # Draws a thin arc around a circle at bottom-right quadrant of panel
    arc_cx = WIN_W - 52
    arc_cy = FACE_H + 80
    arc_r  = 34
    # Background ring
    cv2.circle(canvas, (arc_cx, arc_cy), arc_r,
               tuple(int(c * 0.18) for c in color), 3, cv2.LINE_AA)
    # Foreground arc sweeps from -90° by conf*360°
    arc_sweep = int(conf * 340 * min(p1 * 1.5, 1.0))
    if arc_sweep > 0:
        cv2.ellipse(canvas, (arc_cx, arc_cy), (arc_r, arc_r),
                    -90, 0, arc_sweep, color, 3, cv2.LINE_AA)
        # Glow on arc tip
        tip_angle = math.radians(-90 + arc_sweep)
        tip_x = int(arc_cx + arc_r * math.cos(tip_angle))
        tip_y = int(arc_cy + arc_r * math.sin(tip_angle))
        tip_ov = canvas.copy()
        cv2.circle(tip_ov, (tip_x, tip_y), 5,
                   tuple(min(255, c + 80) for c in color), -1, cv2.LINE_AA)
        cv2.addWeighted(tip_ov, 0.8, canvas, 0.2, 0, canvas)
    # Percentage text inside arc
    pct_str = f"{int(conf * 100)}%"
    (pw, ph), _ = cv2.getTextSize(pct_str, font, 0.38, 1)
    cv2.putText(canvas, pct_str,
                (arc_cx - pw // 2, arc_cy + ph // 2),
                font, 0.38, tuple(min(255, c + 60) for c in color), 1, cv2.LINE_AA)

    #Phase 2: emoji + typewriter caption 
    if emoji_char:
        if not in_p2:
            # Phase 1 — large emoji, bounces in
            bounce   = math.sin(t * 5) * 3 * (1 - p1 * 0.6)
            emoji_sz = int(48 + 20 * spring(p1))
            emoji_y  = int(FACE_H + 82 + bounce)
            ov_e     = canvas.copy()
            ov_e     = put_emoji_centered(ov_e, emoji_char, emoji_y, font_size=emoji_sz)
            cv2.addWeighted(ov_e, p1, canvas, 1 - p1, 0, canvas)
        else:
            # Phase 2 — emoji shifts left, caption typewriters in on the right
            shrink_t = min(p2_t / 0.35, 1.0)
            emoji_sz = int(62 - 18 * shrink_t)   # 62 → 44
            # x: centre → left-third
            ex = int((WIN_W // 2 - emoji_sz // 2) * (1 - shrink_t)
                     + (WIN_W // 5) * shrink_t)
            ey = FACE_H + 85

            pil_img  = Image.fromarray(cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB))
            draw_pil = ImageDraw.Draw(pil_img)
            efont    = get_emoji_font(emoji_sz)
            try:
                bbox = draw_pil.textbbox((0, 0), emoji_char, font=efont)
                etw  = bbox[2] - bbox[0]
            except AttributeError:
                etw = emoji_sz
            draw_pil.text((ex, ey), emoji_char, font=efont, embedded_color=True)
            canvas = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)

            # Typewriter caption to the right of emoji
            cap_alpha  = min(p2_t / 0.45, 1.0)
            n_chars    = int(p2_t * TYPEWR_SPEED)
            shown_text = subtitle[:n_chars]
            if shown_text:
                cap_x = WIN_W // 5 + emoji_sz + 10
                cap_y = FACE_H + 110
                glow_col = tuple(min(255, c + 110) for c in color)
                cap_ov   = canvas.copy()
                # Shadow
                cv2.putText(cap_ov, shown_text, (cap_x + 1, cap_y + 1),
                            font, 0.42, glow_col, 3, cv2.LINE_AA)
                # Text
                cv2.putText(cap_ov, shown_text, (cap_x, cap_y),
                            font, 0.42, (235, 235, 235), 1, cv2.LINE_AA)
                # Blinking cursor while typing
                if n_chars < len(subtitle):
                    (cw2, ch2), _ = cv2.getTextSize(shown_text, font, 0.42, 1)
                    cur_blink = abs(math.sin(t * 9))
                    cv2.line(cap_ov,
                             (cap_x + cw2 + 3, cap_y - ch2),
                             (cap_x + cw2 + 3, cap_y + 3),
                             tuple(int(c * cur_blink) for c in glow_col), 2, cv2.LINE_AA)
                cv2.addWeighted(cap_ov, cap_alpha, canvas, 1 - cap_alpha, 0, canvas)

            # ENTER prompt fades in after caption finishes
            enter_alpha = min(
                max(p2_t - len(subtitle) / TYPEWR_SPEED - 0.3, 0) / 0.5, 1.0)
            if enter_alpha > 0:
                p3  = 0.35 + 0.65 * abs(math.sin(t * 2.0))
                ec  = tuple(int(100 * p3 * enter_alpha) for _ in range(3))
                ep_ov = canvas.copy()
                put_centered(ep_ov, "PRESS  ENTER  TO  SCAN  AGAIN",
                             FACE_H + 148, font, 0.34, ec, 1, shadow=False)
                cv2.addWeighted(ep_ov, enter_alpha, canvas, 1 - enter_alpha, 0, canvas)

    add_scanlines(canvas)
    return canvas

#  STATE MACHINE
S_WAIT    = 0
S_ALIGN   = 1
S_FLASH   = 2
S_LOAD    = 3
S_CONFIRM = 4
S_RESULT  = 5

state              = S_WAIT
history: deque     = deque(maxlen=SMOOTH_N)
phase_start        = 0.0
result_phase_start = 0.0
final_label        = "Neutral"
final_color: tuple = (200, 200, 200)
final_probs: Optional[np.ndarray]  = None
last_face          = np.zeros((200,200,3), dtype=np.uint8)
snapshot_face: Optional[np.ndarray]             = None
snapshot_crop: Optional[np.ndarray]             = None
snapshot_rect: Optional[Tuple[int,int,int,int]] = None
last_crop:     Optional[np.ndarray]             = None
