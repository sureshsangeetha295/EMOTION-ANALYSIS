import os
os.environ["TF_USE_LEGACY_KERAS"]  = "1"
os.environ["CUDA_VISIBLE_DEVICES"] = "-1"
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"

import io
import json
import uuid
import re
import asyncio
import psycopg2
import psycopg2.extras
import webbrowser
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Optional

import numpy as np
import uvicorn
import requests
from fastapi import FastAPI, UploadFile, File, Query, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from PIL import Image
from dotenv import load_dotenv
from passlib.context import CryptContext
from jose import JWTError, jwt


# =============================================================================
#  ENV
# =============================================================================

_ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")

print(f"[EmotionAI] Looking for .env at: {_ENV_PATH}")
if not os.path.exists(_ENV_PATH):
    print("[EmotionAI] ERROR: .env file NOT FOUND at that path.")
else:
    print("[EmotionAI] .env file found. Checking for common formatting issues...")
    try:
        raw_lines = open(_ENV_PATH, encoding="utf-8-sig").readlines()
    except UnicodeDecodeError:
        raw_lines = open(_ENV_PATH, encoding="latin-1").readlines()
    for i, line in enumerate(raw_lines, 1):
        stripped = line.rstrip("\r\n")
        if stripped and not stripped.startswith("#"):
            if "=" not in stripped:
                print(f"[EmotionAI]   Line {i}: MISSING '=' -> {stripped!r}")
            elif stripped.startswith(" ") or stripped.startswith("\t"):
                print(f"[EmotionAI]   Line {i}: LEADING WHITESPACE -> {stripped!r}")
            else:
                key = stripped.split("=", 1)[0].strip()
                val = stripped.split("=", 1)[1].strip() if "=" in stripped else ""
                masked = val[:6] + "..." if len(val) > 6 else ("(empty)" if not val else val)
                print(f"[EmotionAI]   Line {i}: {key} = {masked}")

load_dotenv(dotenv_path=_ENV_PATH, override=True)

_GROQ_KEY = os.getenv("GROQ_API_KEY", "").strip()
if not _GROQ_KEY:
    print(
        "\n[EmotionAI] WARNING: GROQ_API_KEY is not set.\n"
        f"  Looked for .env at: {_ENV_PATH}\n"
        "  Add  GROQ_API_KEY=gsk_...  to that file and restart.\n"
        "  Common causes:\n"
        "    - The .env file has Windows BOM encoding (save as UTF-8 without BOM)\n"
        "    - Value has quotes: GROQ_API_KEY=\"gsk_...\" -> remove the quotes\n"
        "    - Extra spaces:    GROQ_API_KEY = gsk_...  -> use GROQ_API_KEY=gsk_...\n"
        "    - Wrong filename:  .env.txt instead of .env\n"
    )

_DB_PASS = os.getenv("DB_PASSWORD", "")
if not _DB_PASS:
    print(
        "\n[EmotionAI] WARNING: DB_PASSWORD is not set.\n"
        "  Add  DB_PASSWORD=your_postgres_password  to your .env file.\n"
    )

APP_HOST     = os.getenv("APP_HOST", "0.0.0.0")
APP_PORT     = int(os.getenv("APP_PORT", "8000"))
SECRET_KEY   = os.getenv("SECRET_KEY", "change-me-in-production-use-a-long-random-string")
ALGORITHM    = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
REFRESH_TOKEN_EXPIRE_DAYS   = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS",   "30"))

ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "Admin@1234")
ADMIN_EMAIL    = os.getenv("ADMIN_EMAIL",    "admin@emotionai.local")

DB_DSN = {
    "host":     os.getenv("DB_HOST",     "localhost"),
    "port":     int(os.getenv("DB_PORT", "5432")),
    "dbname":   os.getenv("DB_NAME",     "emotionai"),
    "user":     os.getenv("DB_USER",     "postgres"),
    "password": os.getenv("DB_PASSWORD", ""),
}


# =============================================================================
#  ML CONFIG  —  Engagement weights, EMA tracker, tone aggregation
# =============================================================================

EMOTION_LABELS = ["Anger", "Disgust", "Fear", "Happiness", "Neutral", "Sadness", "Surprise"]

