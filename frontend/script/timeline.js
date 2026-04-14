// timeline.js — chip-row emotion timeline

const Timeline = (() => {
  const history = [];

  // engagement param is optional (0.0 – 1.0); stored for tooltip display
  function push(emotion, confidence, engagement) {
    history.push({
      emotion,
      confidence,
      engagement: (engagement != null) ? engagement : null,
      time: Date.now(),
    });
    if (history.length > CONFIG.TIMELINE_MAX_POINTS) history.shift();
    render();
  }

  function render() {
    const el    = document.getElementById("timelineDots");
    const tagEl = document.getElementById("timelineTag");
    if (!el) return;

    if (history.length === 0) {
      el.innerHTML = `<span class="timeline-empty">No detections yet</span>`;
      if (tagEl) tagEl.innerHTML = "";
      return;
    }

    // Chip row — all entries, newest is active
    el.innerHTML = history.map((h, i) => {
      const c      = CONFIG.EMOTION_COLORS[h.emotion] || "#6b7280";
      const pct    = Math.round(h.confidence * 100);
      const isLast = i === history.length - 1;

      // Include engagement % in the tooltip if available
      const engTxt = (h.engagement != null)
        ? ` · Eng ${Math.round(h.engagement * 100)}%`
        : "";

      const connector = i < history.length - 1
        ? `<div class="tl-connector"></div>`
        : "";

      if (isLast) {
        return `
          <div class="tl-chip tl-chip--active"
               style="border-color:${c};background:${c}22;"
               title="${h.emotion} ${pct}%${engTxt}">
            <div class="tl-chip-dot" style="background:${c};"></div>
            <span class="tl-chip-label" style="color:${c};">${h.emotion}</span>
          </div>${connector}`;
      }

      return `
        <div class="tl-chip tl-chip--done" title="${h.emotion} ${pct}%${engTxt}">
          <div class="tl-chip-dot" style="background:${c};opacity:0.7;"></div>
          <span class="tl-chip-label">${h.emotion}</span>
        </div>${connector}`;
    }).join("");

    // Summary count chips in #timelineTag — include avg engagement per emotion
    if (tagEl) {
      const counts     = {};
      const engSums    = {};
      const engCounts  = {};

      history.forEach(h => {
        counts[h.emotion] = (counts[h.emotion] || 0) + 1;
        if (h.engagement != null) {
          engSums[h.emotion]   = (engSums[h.emotion]   || 0) + h.engagement;
          engCounts[h.emotion] = (engCounts[h.emotion] || 0) + 1;
        }
      });

      const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);

      tagEl.innerHTML = top.map(([e, n]) => {
        const c      = CONFIG.EMOTION_COLORS[e] || "#6b7280";
        const avgEng = engCounts[e]
          ? ` · ${Math.round((engSums[e] / engCounts[e]) * 100)}% eng`
          : "";
        return `<span class="tl-summary-chip"
                      style="background:${c}18;border-color:${c}44;color:${c};">
                  ${e} <b>${n}</b>${avgEng}
                </span>`;
      }).join("");
    }
  }

  function clear() {
    history.length = 0;
    render();
  }

  // Returns average engagement across all recorded history entries (0–1)
  function avgEngagement() {
    const entries = history.filter(h => h.engagement != null);
    if (!entries.length) return null;
    return entries.reduce((s, h) => s + h.engagement, 0) / entries.length;
  }

  return { push, clear, avgEngagement };
})();