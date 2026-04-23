import os

RECAPTCHA_SITE_KEY   = os.getenv("RECAPTCHA_SITE_KEY",   "")
RECAPTCHA_SECRET_KEY = os.getenv("RECAPTCHA_SECRET_KEY", "")
GOOGLE_CLIENT_ID     = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI  = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/auth/google/callback")
SMTP_EMAIL           = os.getenv("SMTP_EMAIL", "")
SMTP_APP_PASSWORD    = os.getenv("SMTP_APP_PASSWORD", "")

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

load_dotenv(dotenv_path=_ENV_PATH, override=True)

_GROQ_KEY = os.getenv("GROQ_API_KEY", "").strip()
_DB_PASS = os.getenv("DB_PASSWORD", "")

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