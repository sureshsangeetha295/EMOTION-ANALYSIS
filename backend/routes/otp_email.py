# backend/routes/otp_email.py
import random
import string
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from routes.config import SMTP_EMAIL, SMTP_APP_PASSWORD


def generate_otp(length: int = 6) -> str:
    """Generate a random 6-digit numeric OTP."""
    return ''.join(random.choices(string.digits, k=length))


def send_otp_email(to_email: str, otp: str, username: str = "User") -> bool:
    """
    Send OTP email via Gmail SMTP.
    Returns True on success, False on failure.
    """
    subject = "Your EmotionAI Password Reset OTP"

    html_body = f"""
    <!DOCTYPE html>
    <html>
    <body style="margin:0;padding:0;background:#f5f5f5;font-family:'Plus Jakarta Sans',Arial,sans-serif;">
      <div style="max-width:480px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <div style="background:linear-gradient(135deg,#f97316,#ea580c);padding:32px 32px 24px;">
          <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">EmotionAI</h1>
          <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">Password Reset Request</p>
        </div>
        <div style="padding:32px;">
          <p style="color:#374151;font-size:15px;margin:0 0 8px;">Hi <strong>{username}</strong>,</p>
          <p style="color:#6b7280;font-size:14px;margin:0 0 24px;">
            We received a request to reset your password. Use the OTP below. It expires in <strong>10 minutes</strong>.
          </p>
          <div style="background:#fff7ed;border:2px dashed #f97316;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
            <p style="margin:0 0 8px;color:#92400e;font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">Your OTP Code</p>
            <p style="margin:0;color:#ea580c;font-size:42px;font-weight:800;letter-spacing:10px;">{otp}</p>
          </div>
          <p style="color:#9ca3af;font-size:12px;margin:0;">
            If you did not request this, you can safely ignore this email. Your account remains secure.
          </p>
        </div>
        <div style="background:#f9fafb;padding:16px 32px;text-align:center;">
          <p style="margin:0;color:#9ca3af;font-size:12px;">© 2025 EmotionAI · Emotion Analysis Platform</p>
        </div>
      </div>
    </body>
    </html>
    """

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = SMTP_EMAIL
        msg["To"]      = to_email
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(SMTP_EMAIL, SMTP_APP_PASSWORD)
            server.sendmail(SMTP_EMAIL, to_email, msg.as_string())
        return True
    except Exception as e:
        print(f"[Email Error] {e}")
        return False