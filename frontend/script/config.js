const CONFIG = {
  APP_NAME: 'EMOTION ANALYSIS',
  API_BASE: '',
  PREDICT_URL: '/predict/',
  HEALTH_URL: '/health',
  DEFAULT_FPS: 5,
  MIN_FPS: 1,
  MAX_FPS: 30,
  CAPTURE_WIDTH: 650,
  CAPTURE_HEIGHT: 500,
  JPEG_QUALITY: 0.85,
  TIMELINE_MAX_POINTS: 60,
  REQUEST_TIMEOUT_MS: 30000,   
  HEALTH_INTERVAL_MS: 10000,
  EMOTION_LABELS: ["Anger", "Disgust", "Fear", "Happiness", "Neutral", "Sadness", "Surprise"],
  EMOTION_COLORS: {
    Anger:     "#ef4444",
    Disgust:   "#06b6d4",
    Fear:      "#8b5cf6",
    Happiness: "#f59e0b",
    Neutral:   "#6b7280",
    Sadness:   "#3b82f6",
    Surprise:  "#f97316"
  }
};