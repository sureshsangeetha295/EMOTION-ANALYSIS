// ═══════════════════════════════════════════════════════
//  EmotionAI — app.js  (fully integrated with dashboard)
// ═══════════════════════════════════════════════════════

// ── Emotion data ──
const EMOTIONS = [
  { key: 'happiness', label: 'Happiness', icon: '😊', color: '#f59e0b' },
  { key: 'neutral',   label: 'Neutral',   icon: '😐', color: '#64748b' },
  { key: 'sadness',   label: 'Sadness',   icon: '😢', color: '#6366f1' },
  { key: 'anger',     label: 'Anger',     icon: '😠', color: '#ef4444' },
  { key: 'fear',      label: 'Fear',      icon: '😨', color: '#8b5cf6' },
  { key: 'disgust',   label: 'Disgust',   icon: '🤢', color: '#10b981' },
  { key: 'surprise',  label: 'Surprise',  icon: '😲', color: '#f97316' },
];

const EMOTION_MESSAGES = {
  happiness: "Student is highly engaged and motivated — ideal moment to introduce a harder concept or go deeper into the topic. Keep the energy alive! 🌟",
  neutral:   "Student appears calm and attentive but passively so. Pose a direct question or invite them to explain a concept back to you to boost active participation. 👍",
  sadness:   "Student seems low in mood or unmotivated. Pause the content briefly, offer a warm check-in, and give genuine encouragement before continuing. 💙",
  anger:     "Frustration detected — the student may be struggling or feeling stuck. Slow down, simplify the current explanation, and validate their effort before moving forward. 🧘",
  fear:      "Anxiety signals present — student may feel overwhelmed. Break the task into very small achievable steps, reassure them, and confirm understanding at each stage. 🫂",
  disgust:   "Student appears disengaged or uninterested. Try switching the delivery method, linking the topic to something they care about, or introducing a hands-on activity. 😅",
  surprise:  "Attention is at a peak — the student is highly alert and receptive right now. Use this moment to clarify, reinforce, or introduce the key concept clearly. 🎉",
};

// Backend label order: ["Anger","Disgust","Fear","Happiness","Neutral","Sadness","Surprise"]
const PROB_KEYS = ['Anger', 'Disgust', 'Fear', 'Happiness', 'Neutral', 'Sadness', 'Surprise'];

const ENGAGEMENT_MAP = {
  Happiness: 1.0, Surprise: 1.0,
  Neutral:   0.6,
  Sadness:   0.3, Fear: 0.3,
  Anger:     0.1, Disgust: 0.1,
};

// ── Dashboard emotion meta (for detected panel, insight, speedometer) ──
const DETECT_META = {
  happiness: {
    label:'Happy', color:'#f59e0b', chip:'chip-green', chipTxt:'● Actively Engaged',
    desc:'Joy is a warm feeling of pleasure — your brain is flooded with dopamine.',
    head:'Riding the happy wave',
    tips:'Channel this energy into your most creative task. Joy supercharges problem-solving.',
    motivate:'', motivateCls:'',
  },
  neutral: {
    label:'Neutral', color:'#6b7280', chip:'chip-yellow', chipTxt:'◑ Partially Focused',
    desc:'A calm, balanced state — neither highs nor lows. Your mind is clear and steady.',
    head:'Making the most of calm',
    tips:'This steady state is ideal for deep analytical thinking and careful decision-making.',
    motivate:'💡 Try taking a quick note — writing helps lock in your attention!', motivateCls:'yellow',
  },
  sadness: {
    label:'Sad', color:'#3b82f6', chip:'chip-red', chipTxt:'● Disengaged',
    desc:'A deep ache of loss or disappointment — a natural signal asking for reflection.',
    head:'Navigating through sadness',
    tips:'Be gentle with yourself. Take a short break and reach out to someone you trust.',
    motivate:'❤️ It\'s okay to feel this way. One step at a time!', motivateCls:'red',
  },
  anger: {
    label:'Frustrated', color:'#ef4444', chip:'chip-red', chipTxt:'● Disengaged',
    desc:'Anger is intense energy triggered by a perceived threat — it sharpens focus but clouds judgment.',
    head:'Cooling and redirecting anger',
    tips:'Step away briefly and try box breathing: 4 counts in, hold 4, out 4, hold 4.',
    motivate:'🧘 Breathe. Frustration means you care — you\'re closer than you think!', motivateCls:'red',
  },
  fear: {
    label:'Anxious', color:'#8b5cf6', chip:'chip-red', chipTxt:'● Stressed / Anxious',
    desc:'Fear is your mind\'s alarm — it detects uncertainty and floods your body with alertness.',
    head:'Moving through fear',
    tips:'Name the fear and break your challenge into the smallest next step.',
    motivate:'💙 Slow breath in, slow breath out. You\'ve got this! 🙌', motivateCls:'red',
  },
  disgust: {
    label:'Disengaged', color:'#10b981', chip:'chip-red', chipTxt:'● Very Low Interest',
    desc:'Very low engagement detected — try switching the delivery or connecting to something interesting.',
    head:'Re-engaging your interest',
    tips:'Find just one surprising fact about this topic to spark curiosity.',
    motivate:'🔥 Even 2 focused minutes can reset the entire session. Go!', motivateCls:'red',
  },
  surprise: {
    label:'Surprised', color:'#f97316', chip:'chip-yellow', chipTxt:'◑ Attention Spike',
    desc:'Surprise is a brief jolt — your brain snaps to full alertness and curiosity instantly.',
    head:'Harness the attention spike',
    tips:'Your brain is at peak receptivity right now. Use this to absorb something new.',
    motivate:'', motivateCls:'',
  },
};

const API_URL = '/predict/';

// ── State ──
let isLive               = false;
let liveInterval         = null;
let timeline             = [];
let currentProbs         = { Anger:0, Disgust:0, Fear:0, Happiness:0, Neutral:0, Sadness:0, Surprise:0 };
let topEmotion           = null;
let currentAbortController = null;
let detectionInProgress  = false;
let _engagementScores    = [];
let _sessionTimeline     = [];
let _sessionId           = null;
let _frameCount          = 0;

// ── Session / timeline state ──
let _sessionStart    = null;
let _durationTimer   = null;
let _detCount        = 0;
let _notesList       = [];
let _lastConf        = 0;

// ── Engagement smoothing (for speedometer) ──
let _currentEngScore   = 0;
let _attentiveTime     = 0;
let _partialTime       = 0;
let _disengagedTime    = 0;


// ════════════════════════════════════════════
//  CAMERA
// ════════════════════════════════════════════
