/**
 * SpikeDetector — JS port of the Python SpikeDetector in main.py
 * Detects sudden engagement drops/surges using a rolling z-score.
 * A spike fires when |z| >= threshold over the last `window` EMA values.
 */
class SpikeDetector {
  constructor(window = 10, threshold = 1.8) {
    this._window    = window;
    this._threshold = threshold;
    this._history   = [];   // raw EMA floats
    this._spikes    = [];   // {frame, direction, delta, ema}
    this._frame     = 0;
  }

  /**
   * Feed the latest EMA score (0–1 scale).
   * @returns spike object {frame, direction, delta, ema} or null
   */
  update(emaScore) {
    this._frame++;
    let spike = null;

    if (this._history.length >= 2) {
      const window = this._history.slice(-this._window);
      const mean   = window.reduce((a, b) => a + b, 0) / window.length;
      const std    = Math.sqrt(window.reduce((s, v) => s + (v - mean) ** 2, 0) / window.length);

      if (std > 0.01) {
        const z = (emaScore - mean) / std;
        if (Math.abs(z) >= this._threshold) {
          spike = {
            frame:     this._frame,
            direction: emaScore < mean ? 'drop' : 'surge',
            delta:     Math.round(Math.abs(emaScore - mean) * 10000) / 10000,
            ema:       Math.round(emaScore * 10000) / 10000,
          };
          this._spikes.push(spike);
        }
      }
    }

    this._history.push(emaScore);
    return spike;
  }

  get spikeCount() { return this._spikes.length; }
  get drops()      { return this._spikes.filter(s => s.direction === 'drop').length; }
  get surges()     { return this._spikes.filter(s => s.direction === 'surge').length; }

  summary() {
    return {
      total_spikes:  this._spikes.length,
      drops:         this.drops,
      surges:        this.surges,
      spike_frames:  this._spikes.map(s => s.frame),
      spike_details: [...this._spikes],
    };
  }

  reset() {
    this._history = [];
    this._spikes  = [];
    this._frame   = 0;
  }
}
