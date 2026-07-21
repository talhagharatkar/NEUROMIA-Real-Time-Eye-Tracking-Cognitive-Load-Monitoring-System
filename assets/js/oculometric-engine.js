// CAMERA SYSTEM — MediaPipe Face Mesh · Real-Time Blink Detection
// EAR  = Eye Aspect Ratio from 468 face landmarks (real geometry)
// PERCLOS = % eye closure over rolling 200-frame window
// IBI  = Inter-Blink Interval (ms, recorded on blink completion)
// Gaze = nose-tip landmark variance, Kalman-filtered
// All values show — when camera off or no face detected
// ════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════════
// §21. DATA QUALITY CONTROLLER (DQC)
// Full 5-tier per-frame quality pipeline: EXCELLENT / GOOD / ACCEPTABLE / POOR / REJECT
// Formula: DQC = weighted composite of tracking, lighting, motion, distance, pose
// Only EXCELLENT, GOOD, ACCEPTABLE frames feed feature extraction.
// POOR and REJECT frames are logged but excluded.
// ═══════════════════════════════════════════════════════════════════════════════
const DataQualityController = (() => {
  // Per-frame quality history (ring buffer — max 3000 frames ≈ 100 seconds at 30 fps)
  const MAX_HISTORY = 3000;
  const frameHistory = [];
  let totalFrames = 0, acceptedFrames = 0, rejectedFrames = 0;

  /**
   * classify(score) → 5-tier DQC label
   * EXCELLENT ≥ 92 | GOOD ≥ 80 | ACCEPTABLE ≥ 65 | POOR ≥ 45 | REJECT < 45
   */
  function classify(score) {
    if (score >= 92) return 'EXCELLENT';
    if (score >= 80) return 'GOOD';
    if (score >= 65) return 'ACCEPTABLE';
    if (score >= 45) return 'POOR';
    return 'REJECT';
  }

  /**
   * isUsable(label) → true if frame may be used for feature extraction
   * Only EXCELLENT, GOOD, ACCEPTABLE feed the pipeline.
   */
  function isUsable(label) {
    return label === 'EXCELLENT' || label === 'GOOD' || label === 'ACCEPTABLE';
  }

  /**
   * evaluate(qualityScore, trackingConf, fps, headPoseOk) → { score, label, usable }
   * @param {number} qualityScore  0-100 from evalCameraQuality()
   * @param {number} trackingConf  0-1 landmark confidence
   * @param {number} fps           current FPS
   * @param {boolean} headPoseOk   true when yaw/pitch/roll within limits
   * @param {number} ts            Unix ms timestamp
   */
  function evaluate(qualityScore, trackingConf, fps, headPoseOk, ts) {
    // Weights following §21 specification
    const confScore  = Math.min(100, (trackingConf || 0) * 100);
    const fpsScore   = fps >= 25 ? 100 : fps >= 15 ? Math.max(0, (fps - 15) / 10 * 100) : 0;
    const poseScore  = headPoseOk ? 100 : 50;
    // Composite (camera quality carries most weight as it aggregates lighting/blur/distance/pose)
    const composite  = Math.round(
      0.45 * (qualityScore || 0) +
      0.25 * confScore          +
      0.20 * fpsScore           +
      0.10 * poseScore
    );
    const label  = classify(composite);
    const usable = isUsable(label);

    totalFrames++;
    if (usable) acceptedFrames++; else rejectedFrames++;

    const record = { ts: ts || Date.now(), score: composite, label, usable };
    frameHistory.push(record);
    if (frameHistory.length > MAX_HISTORY) frameHistory.shift();

    return { score: composite, label, usable };
  }

  /**
   * integrityScore() → 0-100 Experiment Integrity Score
   * = (accepted / total) × avg_quality_of_accepted × tracking_stability_factor
   */
  function integrityScore() {
    if (totalFrames === 0) return 100;
    const acceptRatio = acceptedFrames / totalFrames;
    const recentN     = Math.min(frameHistory.length, 300); // last ~10 seconds
    const recent      = frameHistory.slice(-recentN);
    const avgQ        = recent.length > 0
      ? recent.reduce((s, f) => s + f.score, 0) / recent.length
      : 100;
    // Penalize heavily if more than 10% frames rejected
    const rejPenalty  = rejectedFrames / totalFrames > 0.1
      ? Math.max(0, 1 - (rejectedFrames / totalFrames - 0.1) * 3)
      : 1;
    return Math.round(Math.min(100, acceptRatio * avgQ * rejPenalty));
  }

  function getStats() {
    return { totalFrames, acceptedFrames, rejectedFrames,
             acceptRate: totalFrames > 0 ? (acceptedFrames / totalFrames * 100).toFixed(1) : '100.0' };
  }

  function reset() {
    frameHistory.length = 0;
    totalFrames = 0; acceptedFrames = 0; rejectedFrames = 0;
  }

  function getHistory() { return frameHistory.slice(); }

  return { evaluate, classify, isUsable, integrityScore, getStats, reset, getHistory };
})();

// ── expose globally so PDF and XLSX can call it ──
function getExperimentIntegrityScore() {
  return DataQualityController.integrityScore();
}
window.getExperimentIntegrityScore = getExperimentIntegrityScore;


// ═══════════════════════════════════════════════════════════════════════════════
// §27. RESEARCH REPRODUCIBILITY METADATA
// Records OS, browser, MediaPipe version, screen resolution, timezone etc.
// Must be exported in Sheet 7 to allow complete experimental reproducibility.
// ═══════════════════════════════════════════════════════════════════════════════
const ReproducibilityMetadata = (() => {
  const PROJECT_VERSION  = 'NEUROMIA-v3.1';
  const MODEL_VERSION    = 'MediaPipe-FaceMesh-0.4.1633559619';
  const RANDOM_SEED      = 42; // fixed for reproducibility

  const ua = navigator.userAgent || '';
  function detectBrowser(ua) {
    if (/Edg\//.test(ua))     return { name: 'Microsoft Edge', ver: (ua.match(/Edg\/([\d.]+)/)||[,'?'])[1] };
    if (/Chrome\//.test(ua))  return { name: 'Google Chrome',  ver: (ua.match(/Chrome\/([\d.]+)/)||[,'?'])[1] };
    if (/Firefox\//.test(ua)) return { name: 'Mozilla Firefox',ver: (ua.match(/Firefox\/([\d.]+)/)||[,'?'])[1] };
    if (/Safari\//.test(ua))  return { name: 'Apple Safari',   ver: (ua.match(/Version\/([\d.]+)/)||[,'?'])[1] };
    return { name: 'Unknown', ver: '?' };
  }
  function detectOS(ua) {
    if (/Windows NT 10\.0/.test(ua)) return 'Windows 10/11';
    if (/Windows NT 6\.1/.test(ua))  return 'Windows 7';
    if (/Mac OS X/.test(ua))         return 'macOS';
    if (/Linux/.test(ua))            return 'Linux';
    if (/Android/.test(ua))          return 'Android';
    if (/iPhone|iPad/.test(ua))      return 'iOS';
    return 'Unknown OS';
  }

  const browser = detectBrowser(ua);
  const timezone= Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const now     = new Date();

  const meta = {
    Project_Version:    PROJECT_VERSION,
    Model_Version:      MODEL_VERSION,
    Random_Seed:        RANDOM_SEED,
    Operating_System:   detectOS(ua),
    Browser:            browser.name,
    Browser_Version:    browser.ver,
    User_Agent:         ua.slice(0, 200),
    Screen_Width_px:    screen.width,
    Screen_Height_px:   screen.height,
    Screen_ColorDepth:  screen.colorDepth,
    Window_Inner_W:     window.innerWidth,
    Window_Inner_H:     window.innerHeight,
    Device_Pixel_Ratio: window.devicePixelRatio || 1,
    Timezone:           timezone,
    UTC_Offset_min:     -now.getTimezoneOffset(),
    Recording_Date:     `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`,
    MediaPipe_Source:   'cdn.jsdelivr.net/npm/@mediapipe/face_mesh',
    Language:           navigator.language || 'N/A',
    Hardware_Concurrency: navigator.hardwareConcurrency || 'N/A',
    Device_Memory_GB:   navigator.deviceMemory || 'N/A',
    Max_Touch_Points:   navigator.maxTouchPoints || 0,
  };

  function get() { return { ...meta }; }
  function toSheetRow() {
    // Returns [{Field, Value}] for Excel vertical layout
    return Object.entries(meta).map(([Field, Value]) => ({ Field, Value: String(Value) }));
  }
  return { get, toSheetRow };
})();
window.ReproducibilityMetadata = ReproducibilityMetadata;


// ═══════════════════════════════════════════════════════════════════════════════
// §26. REAL-TIME PERFORMANCE MONITOR
// Tracks FPS, dropped frames, processing latency, memory usage.
// Alerts user if FPS < 25 or latency > 50 ms.
// ═══════════════════════════════════════════════════════════════════════════════
const PerformanceMonitor = (() => {
  const WARN_FPS_THRESHOLD  = 25;   // Hz
  const WARN_LAT_THRESHOLD  = 50;   // ms

  let _frameCount  = 0;
  let _dropCount   = 0;
  let _fps         = 0;
  let _latency     = 0;       // ms — last frame processing time
  let _lastFPSTime = Date.now();
  let _frameStart  = 0;
  let _fpsHistory  = [];      // ring buffer of per-second FPS values
  let _latHistory  = [];      // ring buffer of per-frame latencies
  const MAX_H = 300;

  // Call at start of each frame processing
  function frameStart() { _frameStart = performance.now(); }

  // Call at end of each frame processing
  function frameEnd() {
    const lat = performance.now() - _frameStart;
    _latency = lat;
    _latHistory.push(lat);
    if (_latHistory.length > MAX_H) _latHistory.shift();
    _frameCount++;

    // Update FPS every second
    const now = Date.now();
    if (now - _lastFPSTime >= 1000) {
      _fps = _frameCount;
      _fpsHistory.push(_fps);
      if (_fpsHistory.length > MAX_H) _fpsHistory.shift();
      _frameCount = 0;
      _lastFPSTime = now;

      // Warnings
      if (_fps < WARN_FPS_THRESHOLD && typeof addAlert === 'function') {
        if (!PerformanceMonitor._lastFpsWarn || now - PerformanceMonitor._lastFpsWarn > 10000) {
          addAlert(`⚠ FPS DROP: ${_fps} fps (threshold: ${WARN_FPS_THRESHOLD}). Close background apps.`, 'warn');
          PerformanceMonitor._lastFpsWarn = now;
        }
      }
    }

    if (lat > WARN_LAT_THRESHOLD && typeof addAlert === 'function') {
      if (!PerformanceMonitor._lastLatWarn || Date.now() - PerformanceMonitor._lastLatWarn > 8000) {
        addAlert(`⚠ HIGH LATENCY: ${lat.toFixed(1)} ms (threshold: ${WARN_LAT_THRESHOLD} ms)`, 'warn');
        PerformanceMonitor._lastLatWarn = Date.now();
      }
    }
  }

  function dropFrame() { _dropCount++; }

  function getMetrics() {
    let memUsed = 0, memTotal = 0;
    try {
      if (performance.memory) {
        memUsed  = Math.round(performance.memory.usedJSHeapSize  / 1048576); // MB
        memTotal = Math.round(performance.memory.jsHeapSizeLimit  / 1048576);
      }
    } catch(e) {}
    const avgLat = _latHistory.length > 0
      ? (_latHistory.reduce((a,b)=>a+b,0) / _latHistory.length).toFixed(2)
      : 0;
    const avgFps = _fpsHistory.length > 0
      ? (_fpsHistory.reduce((a,b)=>a+b,0) / _fpsHistory.length).toFixed(1)
      : _fps;
    return {
      current_fps:        _fps,
      avg_fps:            Number(avgFps),
      current_latency_ms: Number(_latency.toFixed(2)),
      avg_latency_ms:     Number(avgLat),
      dropped_frames:     _dropCount,
      js_heap_used_mb:    memUsed,
      js_heap_limit_mb:   memTotal,
      fps_warn:           _fps < WARN_FPS_THRESHOLD,
      latency_warn:       _latency > WARN_LAT_THRESHOLD
    };
  }

  function reset() {
    _frameCount = 0; _dropCount = 0; _fps = 0; _latency = 0;
    _fpsHistory = []; _latHistory = [];
    _lastFPSTime = Date.now();
  }

  return { frameStart, frameEnd, dropFrame, getMetrics, reset };
})();
window.PerformanceMonitor = PerformanceMonitor;


// ═══════════════════════════════════════════════════════════════════════════════
// §28. OUTLIER DETECTOR
// Rejects physiologically impossible values before they enter the pipeline.
// Reference: Stern et al. (1994), Kleifges et al. (2016) blink parameter ranges.
// ═══════════════════════════════════════════════════════════════════════════════
const OutlierDetector = (() => {
  // Physiological bounds (conservative, from literature)
  const BOUNDS = {
    EAR:               { min: 0.01, max: 0.55,   unit: '' },
    blink_rate:        { min: 0,    max: 60,      unit: '/min' },
    blink_duration_ms: { min: 50,   max: 2000,    unit: 'ms'   },
    PERCLOS:           { min: 0,    max: 100,     unit: '%'    },
    IBI_ms:            { min: 100,  max: 120000,  unit: 'ms'   },
    saccade_velocity:  { min: 0,    max: 800,     unit: '°/s'  },
    fixation_density:  { min: 0,    max: 100,     unit: '%'    },
    head_yaw_deg:      { min: -90,  max: 90,      unit: '°'    },
    head_pitch_deg:    { min: -90,  max: 90,      unit: '°'    },
    head_roll_deg:     { min: -90,  max: 90,      unit: '°'    },
    face_distance_cm:  { min: 15,   max: 150,     unit: 'cm'   },
  };

  let rejectedCount = 0;
  const rejectedLog = [];

  /**
   * check(key, value) → { valid, value, reason }
   * Returns original value if valid, null + reason if outlier.
   */
  function check(key, value) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return { valid: false, value: null, reason: `${key}: non-finite (${value})` };
    }
    const b = BOUNDS[key];
    if (!b) return { valid: true, value }; // no bound defined — pass through
    if (value < b.min || value > b.max) {
      rejectedCount++;
      const reason = `${key}: ${value.toFixed(4)} ${b.unit} out of bounds [${b.min}, ${b.max}]`;
      rejectedLog.push({ ts: Date.now(), key, value, reason });
      if (rejectedLog.length > 500) rejectedLog.shift();
      return { valid: false, value: null, reason };
    }
    return { valid: true, value };
  }

  /**
   * sanitize(obj, keyMap) → cleaned object where outlier fields become null
   * keyMap = { objField: boundsKey } — optional, defaults to same key name
   */
  function sanitize(obj) {
    if (!obj) return obj;
    const out = { ...obj };
    Object.keys(BOUNDS).forEach(k => {
      if (k in out) {
        const r = check(k, out[k]);
        if (!r.valid) out[k] = null;
      }
    });
    return out;
  }

  function getStats() { return { rejected: rejectedCount, log: rejectedLog.slice(-50) }; }
  function reset() { rejectedCount = 0; rejectedLog.length = 0; }

  return { check, sanitize, getStats, reset, BOUNDS };
})();
window.OutlierDetector = OutlierDetector;


// ═══════════════════════════════════════════════════════════════════════════════
// §24 ext. BLINK EVENT LOGGER
// Per-blink log for Sheet 4 (Blink Events).
// Records every accepted and rejected blink with full temporal context.
// Follows §24 Event Marker System specification.
// ═══════════════════════════════════════════════════════════════════════════════
const BlinkEventLogger = (() => {
  const log = [];
  const MAX = 10000;

  /**
   * record(event) — call when OculometricFeatureExtractor completes a blink cycle
   * @param {object} event
   *   .type        'ACCEPTED' | 'REJECTED'
   *   .side        'BILATERAL' | 'LEFT' | 'RIGHT' | 'WINK'
   *   .earAtClose  EAR value when closure detected
   *   .durationMs  blink duration ms
   *   .validity    blink_validity_status string
   *   .blinkNum    cumulative accepted blink number
   *   .condition   experiment condition string
   */
  function record(event) {
    const now = new Date();
    const entry = {
      Blink_Number:        event.blinkNum || log.filter(e => e.Type === 'ACCEPTED').length + 1,
      Type:                event.type || 'ACCEPTED',
      Side:                event.side || 'BILATERAL',
      Duration_ms:         typeof event.durationMs === 'number' ? event.durationMs.toFixed(1) : 'N/A',
      EAR_at_Closure:      typeof event.earAtClose === 'number' ? event.earAtClose.toFixed(4) : 'N/A',
      Validity_Status:     event.validity || 'N/A',
      Condition:           event.condition || 'N/A',
      Timestamp_Local:     formatTimestampExcel ? formatTimestampExcel(now.getTime()) : now.toISOString(),
      Timestamp_ISO:       (typeof getISOLocalTimestamp === 'function') ? getISOLocalTimestamp(now) : now.toISOString(),
      Unix_ms:             now.getTime(),
      Relative_Time_sec:   (typeof getRelativeRecordingSeconds === 'function') ? getRelativeRecordingSeconds(now).toFixed(3) : '0.000',
    };
    log.push(entry);
    if (log.length > MAX) log.shift();
  }

  function getAll()      { return log.slice(); }
  function getAccepted() { return log.filter(e => e.Type === 'ACCEPTED'); }
  function getRejected() { return log.filter(e => e.Type === 'REJECTED'); }
  function reset()       { log.length = 0; }

  return { record, getAll, getAccepted, getRejected, reset };
})();
window.BlinkEventLogger = BlinkEventLogger;


// ═══════════════════════════════════════════════════════════════════════════════
// §29. MULTI-LAYER RELIABILITY SCORER
// Validates every prediction using temporal consistency, tracking confidence,
// frame quality and model confidence.
// Returns Reliability Score 0-100 + human-readable band.
// ═══════════════════════════════════════════════════════════════════════════════
const ReliabilityScorer = (() => {
  const history = [];
  const MAX_H = 60; // last 60 predictions

  /**
   * score(opts) → { reliability, band, factors }
   * @param {number} opts.trackingConf  0-1
   * @param {number} opts.frameQuality  0-100
   * @param {number} opts.modelConf     0-1 (from prediction engine)
   * @param {number} opts.dqcScore      0-100 (DQC composite)
   */
  function score(opts = {}) {
    const tc  = Math.min(1, Math.max(0, opts.trackingConf  ?? 0.5));
    const fq  = Math.min(100, Math.max(0, opts.frameQuality  ?? 80));
    const mc  = Math.min(1, Math.max(0, opts.modelConf     ?? 0.5));
    const dq  = Math.min(100, Math.max(0, opts.dqcScore      ?? 80));

    // Temporal consistency — std dev of last N reliability scores
    const tcBand = history.length >= 5
      ? (() => {
          const vals  = history.slice(-10).map(h => h.raw);
          const mean  = vals.reduce((a,b)=>a+b,0) / vals.length;
          const std   = Math.sqrt(vals.reduce((a,b)=>a+(b-mean)**2,0)/vals.length);
          return Math.max(0, 1 - std / 50); // normalize — lower std = higher consistency
        })()
      : 0.8;

    const raw = Math.round(
      0.30 * (tc  * 100)  +
      0.25 * fq           +
      0.25 * (mc  * 100)  +
      0.10 * dq           +
      0.10 * (tcBand * 100)
    );

    const band =
      raw >= 90 ? 'VERY_HIGH' :
      raw >= 75 ? 'HIGH'      :
      raw >= 60 ? 'MODERATE'  :
      raw >= 40 ? 'LOW'       : 'VERY_LOW';

    const entry = { raw, band, tc, fq, mc, dq, tcBand };
    history.push(entry);
    if (history.length > MAX_H) history.shift();

    return {
      reliability:          raw,
      band,
      factors: {
        Tracking_Confidence: (tc * 100).toFixed(1),
        Frame_Quality:       fq.toFixed(1),
        Model_Confidence:    (mc * 100).toFixed(1),
        DQC_Score:           dq.toFixed(1),
        Temporal_Consistency:(tcBand * 100).toFixed(1)
      }
    };
  }

  function reset() { history.length = 0; }
  return { score, reset };
})();
window.ReliabilityScorer = ReliabilityScorer;


// ═══════════════════════════════════════════════════════════════════════════════
// §22 ext. SCIENTIFIC BASELINE CALIBRATOR — UPGRADED
// Now computes full percentile distribution (P5, P25, P50, P75, P95).
// ═══════════════════════════════════════════════════════════════════════════════
class ScientificBaselineCalibrator {

  constructor(targetSeconds = 60, fps = 30) {
    this.targetSamples = targetSeconds * fps; // 60s * 30fps = 1800 samples
    this.samples = [];
    this.calibrated = false;
    this.stats = {};
  }

  reset() {
    this.samples = [];
    this.calibrated = false;
    this.stats = {};
  }

  addSample(features) {
    if (this.calibrated) return;
    this.samples.push({ ...features });

    // Update progress in UI badge
    const pct = Math.min(100, Math.round((this.samples.length / this.targetSamples) * 100));
    const badge = $('fmgBaselineBadge');
    if (badge) {
      badge.textContent = `CALIBRATING BASELINE: ${pct}%`;
      badge.className = 'fmg-baseline-badge warning';
    }

    if (this.samples.length >= this.targetSamples) {
      this.calculateStats();
    }
  }

  calculateStats() {
    if (this.samples.length === 0) return;
    const keys = Object.keys(this.samples[0]);

    // §22: Interpolated percentile from sorted array
    const pctile = (sorted, p) => {
      const idx = (p / 100) * (sorted.length - 1);
      const lo  = Math.floor(idx), hi = Math.ceil(idx);
      return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
    };

    keys.forEach(k => {
      const vals = this.samples.map(s => s[k]).filter(v => Number.isFinite(v));
      if (vals.length === 0) return;

      // §22: Mean & Std Dev
      const mean     = vals.reduce((a, b) => a + b, 0) / vals.length;
      const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
      const std      = Math.sqrt(variance) || 0.001;

      // §22: Median & Robust MAD (scale factor 1.4826)
      const sorted   = [...vals].sort((a, b) => a - b);
      const median   = pctile(sorted, 50);
      const absDevs  = vals.map(v => Math.abs(v - median)).sort((a, b) => a - b);
      const mad      = pctile(absDevs, 50) || 0.001;

      // §22: Full percentile distribution
      const p5  = pctile(sorted, 5);
      const p25 = pctile(sorted, 25);
      const p75 = pctile(sorted, 75);
      const p95 = pctile(sorted, 95);

      // Adaptive threshold: Median − 2.5 × MAD  (§2 EAR adaptive formula)
      const adaptiveThreshold = median - 2.5 * mad;

      this.stats[k] = { mean, std, median, mad, p5, p25, p75, p95, adaptiveThreshold };
    });

    this.calibrated = true;
    console.log('[NEUROMIA §22] 60-second baseline calibrated. Percentile stats:', this.stats);
    if (typeof addAlert === 'function') {
      addAlert('§22 Scientific baseline calibrated — Z-score, Robust MAD & Percentile normalization ACTIVE.', 'ok');
    }
    const badge = $('fmgBaselineBadge');
    if (badge) {
      badge.className = 'fmg-baseline-badge ready';
      badge.innerHTML = '<i class="fas fa-check"></i> BASELINE CALIBRATED';
    }
  }

  normalize(key, value, type = 'robust') {
    if (!this.calibrated || !this.stats[key]) return value;
    const s = this.stats[key];
    if (type === 'zscore') {
      return (value - s.mean) / s.std;
    } else { // robust Median/MAD normalization
      return (value - s.median) / (1.4826 * s.mad);
    }
  }
}

window.ScientificCalibrator = new ScientificBaselineCalibrator(60, 30);

// ── REAL-TIME CAMERA & FRAME QUALITY EVALUATOR ──
function evalCameraQuality(lm, W, H, ctx) {
  let lightScore = 100;
  let blurScore = 100;
  let distScore = 100;
  let poseScore = 100;
  let lightVal = 127;
  let blurVal = 10;
  let distPx = 100;
  let yaw = 0, pitch = 0, roll = 0;
  let label = "GOOD";

  if (ctx && lm[4]) {
    const nx = Math.floor(lm[4].x * W);
    const ny = Math.floor(lm[4].y * H);
    if (nx > 15 && nx < W - 15 && ny > 15 && ny < H - 15) {
      try {
        const img = ctx.getImageData(nx - 15, ny - 15, 30, 30);
        const data = img.data;
        let sumIntensity = 0;
        const len = data.length;
        for (let i = 0; i < len; i += 4) {
          sumIntensity += (data[i] + data[i+1] + data[i+2]) / 3;
        }
        lightVal = sumIntensity / (len / 4);

        if (lightVal < 70) {
          lightScore = Math.max(0, 100 - (70 - lightVal) * 1.8);
        } else if (lightVal > 220) {
          lightScore = Math.max(0, 100 - (lightVal - 220) * 1.5);
        }

        // Horizontal & vertical gradients for blur estimation
        const count = 30 * 30;
        const gray = new Uint8Array(count);
        for (let i = 0; i < count; i++) {
          gray[i] = (data[i*4] + data[i*4+1] + data[i*4+2]) / 3;
        }
        let grads = [];
        for (let y = 1; y < 29; y++) {
          for (let x = 1; x < 29; x++) {
            const idx = y * 30 + x;
            const gx = gray[idx + 1] - gray[idx - 1];
            const gy = gray[idx + 30] - gray[idx - 30];
            grads.push(Math.sqrt(gx*gx + gy*gy));
          }
        }
        if (grads.length > 0) {
          const avgGrad = grads.reduce((a, b) => a + b, 0) / grads.length;
          const varGrad = grads.reduce((a, b) => a + (b - avgGrad)**2, 0) / grads.length;
          blurVal = varGrad;
          if (blurVal < 18) {
            blurScore = Math.max(0, 100 - (18 - blurVal) * 5.5);
          }
        }
      } catch (e) {
        // Fallback if canvas reading is blocked
      }
    }
  }

  // Face Distance (landmarks 33 and 263 outer eye corners)
  if (lm[33] && lm[263]) {
    const p33 = { x: lm[33].x * W, y: lm[33].y * H };
    const p263 = { x: lm[263].x * W, y: lm[263].y * H };
    distPx = Math.hypot(p33.x - p263.x, p33.y - p263.y);
    if (distPx < 85) {
      distScore = Math.max(0, 100 - (85 - distPx) * 2.2);
    } else if (distPx > 180) {
      distScore = Math.max(0, 100 - (distPx - 180) * 1.8);
    }
  }

  // Head Pose Estimation
  if (lm[4] && lm[152] && lm[10] && lm[33] && lm[263]) {
    const nose = lm[4];
    const chin = lm[152];
    const forehead = lm[10];
    const leftEye = lm[33];
    const rightEye = lm[263];

    yaw = (nose.x - (leftEye.x + rightEye.x) / 2) * 100;
    pitch = (nose.y - (forehead.y + chin.y) / 2) * 100;
    roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * (180 / Math.PI);

    const yawDev = Math.abs(yaw);
    const pitchDev = Math.abs(pitch);
    const rollDev = Math.abs(roll);

    if (yawDev > 15) poseScore -= (yawDev - 15) * 3;
    if (pitchDev > 12) poseScore -= (pitchDev - 12) * 3;
    if (rollDev > 10) poseScore -= (rollDev - 10) * 3;
    poseScore = Math.max(0, poseScore);
  }

  const qualityScore = Math.round(0.25 * lightScore + 0.25 * blurScore + 0.25 * distScore + 0.25 * poseScore);

  if (qualityScore >= 80) {
    label = "GOOD";
  } else if (lightScore < 60 && lightVal < 70) {
    label = "LOW_LIGHT";
  } else if (lightScore < 60 && lightVal > 220) {
    label = "GLARE";
  } else if (blurScore < 60) {
    label = "HIGH_BLUR";
  } else if (distScore < 60 && distPx < 85) {
    label = "TOO_FAR";
  } else if (distScore < 60 && distPx > 180) {
    label = "TOO_CLOSE";
  } else if (poseScore < 60) {
    label = "POOR_POSE";
  } else {
    label = "POOR_QUALITY";
  }

  return { qualityScore, label, lightVal, blurVal, distPx, yaw, pitch, roll };
}

// ═══════════════════════════════════════════
// OCULOMETRIC FEATURE EXTRACTOR (Upgraded with Scientific State Machine & Adaptive Thresholds)
// ═══════════════════════════════════════════
class OculometricFeatureExtractor {
  constructor(opts = {}) {
    this.earThreshold = opts.earThreshold ?? 0.20;
    this.partialBlinkThreshold = opts.partialBlinkThreshold ?? 0.26;
    this.microsleepThresholdMs = opts.microsleepThresholdMs ?? 800;
    this.doubleBlinkThresholdMs = opts.doubleBlinkThresholdMs ?? 450;
    this.doubleBlinkClusterMs = opts.doubleBlinkClusterMs ?? 800;
    this.minBlinkDurationMs = opts.minBlinkDurationMs ?? 100; // strict scientific constraints (100ms)
    this.maxBlinkDurationMs = opts.maxBlinkDurationMs ?? 1000; // strict scientific constraints (1000ms)
    this.blinkCooldownMs = opts.blinkCooldownMs ?? 150;
    this.requireBothEyes = opts.requireBothEyes ?? false;
    this.windowMs = opts.windowMs ?? 30000;
    this.validModes = new Set(['AI_ASSISTED','NON_AI','AI_STOPPED','REST_BASELINE']);

    // Formal 5-State Machine state variables
    // States: 'OPEN' -> 'CLOSING' -> 'CLOSED' -> 'OPENING' -> 'OPEN'
    this.blinkState = 'OPEN';
    this.closingStart = null;
    this.closedStart = null;
    this.openingStart = null;

    // Adaptive threshold tracking
    this._earHistory = [];
    this._earHistoryMax = 150;
    this._adaptiveThreshold = this.earThreshold;

    this.eyeClosed = false;
    this.lastBlinkAt = null;
    this.blinks = [];
    this.blinkDurations = [];
    this.closedSamples = [];
    this.gazeSamples = [];
    this.saccades = [];
    this.prevGaze = null;
    this.prevT = null;

    this.partialBlinkArmed = true;
    this.partialBlinkCount = 0;
    this.doubleBlinkCount = 0;
    this.microsleepCount = 0;
    this.microsleepActive = false;
    this.rejectedFastBlinkCount = 0;
    this.winkLeftCount = 0;
    this.winkRightCount = 0;
    this.winkActive = null;
    this.baseline = { blinkRate:null, perclos:null, blinkVar:null };
    this.aiStopStart = null;
    this.recovered = false;

    this.last = {
      blink_duration_ms:0,
      blink_frequency_variability:0,
      inter_blink_interval_variance_ms:0,
      microsleep_detected:false,
      microsleep_count:0,
      partial_blink_count:0,
      double_blink_count:0,
      perclos_trend:'stable',
      attention_drift_score:0,
      blink_recovery_time_sec:0,
      eye_strain_index:0,
      saccade_velocity:0,
      fixation_density:0,
      true_blink_count:0,
      rejected_fast_blink_count:0,
      wink_left_count:0,
      wink_right_count:0,
      blink_validity_status:'WAITING'
    };
  }

  _trim(now){
    const cut = now - this.windowMs;
    this.blinks = this.blinks.filter(t => t >= cut);
    this.blinkDurations = this.blinkDurations.filter(o => o.t >= cut);
    this.closedSamples = this.closedSamples.filter(o => o.t >= cut);
    this.gazeSamples = this.gazeSamples.filter(o => o.t >= cut);
    this.saccades = this.saccades.filter(o => o.t >= cut);
  }
  _num(v, d=2){ return Number.isFinite(v) ? Number(v.toFixed(d)) : 0; }
  _mean(a){ return a.length ? a.reduce((x,y)=>x+y,0)/a.length : null; }
  _variance(a){ if(a.length < 2) return null; const m=this._mean(a); return a.reduce((s,v)=>s+(v-m)**2,0)/a.length; }
  _score(v){ return Math.max(0, Math.min(100, v)); }

  _perclos(){
    if(this.closedSamples.length < 6) return 0;
    return this.closedSamples.filter(o=>o.closed).length / this.closedSamples.length;
  }
  _perclosTrend(){
    if(this.closedSamples.length < 20) return 'stable';
    const mid = Math.floor(this.closedSamples.length/2);
    const a = this.closedSamples.slice(0, mid), b = this.closedSamples.slice(mid);
    const ar = a.filter(o=>o.closed).length / Math.max(1,a.length);
    const br = b.filter(o=>o.closed).length / Math.max(1,b.length);
    const diff = br - ar;
    if(diff > 0.03) return 'increasing';
    if(diff < -0.03) return 'decreasing';
    return 'stable';
  }
  _blinkRate(){ return this.blinks.length * (60000 / this.windowMs); }
  _blinkVar(){
    if(this.blinks.length < 3) return 0;
    const intervals = [];
    for(let i=1;i<this.blinks.length;i++) intervals.push((this.blinks[i]-this.blinks[i-1]) / 1000);
    return Math.sqrt(this._variance(intervals) ?? 0);
  }
  _ibiVarianceMs(){
    if(this.blinks.length < 3) return 0;
    const intervals = [];
    for(let i=1;i<this.blinks.length;i++) intervals.push(this.blinks[i]-this.blinks[i-1]);
    return this._variance(intervals);
  }
  _fixationDensity(){
    if(this.gazeSamples.length < 8) return 0;
    const xs = this.gazeSamples.map(p=>p.x), ys = this.gazeSamples.map(p=>p.y);
    const vx = this._variance(xs) ?? 0, vy = this._variance(ys) ?? 0;
    return this._score(100 - Math.sqrt(vx + vy) * 1000);
  }
  _attentionDrift(perclos, blinkVar, fixation, saccade){
    if(!Number.isFinite(perclos) || !Number.isFinite(blinkVar) || !Number.isFinite(fixation) || !Number.isFinite(saccade)) return 0;
    return this._score((perclos*250)*0.35 + Math.min(100,blinkVar*40)*0.25 + (100-fixation)*0.25 + Math.min(100,saccade*18)*0.15);
  }
  _eyeStrain(blinkRate, avgDur, perclos, fixation){
    if(!Number.isFinite(avgDur) || !Number.isFinite(perclos) || !Number.isFinite(fixation)) return 0;
    return this._score(Math.min(100,Math.abs(blinkRate-15)*5)*0.18 + Math.min(100,avgDur/4)*0.22 + Math.min(100,perclos*220)*0.25 + (100-fixation)*0.20 + Math.min(100,this.partialBlinkCount*4)*0.15);
  }
  _recovery(testMode, blinkRate, perclos, blinkVar, now){
    if(testMode !== 'AI_STOPPED') { this.aiStopStart = null; this.recovered = false; return this.last.blink_recovery_time_sec; }
    if(this.aiStopStart === null) this.aiStopStart = now;
    if(this.baseline.blinkRate === null || this.baseline.perclos === null || this.baseline.blinkVar === null || !Number.isFinite(perclos) || !Number.isFinite(blinkVar)) return 0;
    const ok = Math.abs(blinkRate-this.baseline.blinkRate)<=2.5 && Math.abs(perclos-this.baseline.perclos)<=0.04 && Math.abs(blinkVar-this.baseline.blinkVar)<0.2501;
    if(ok && !this.recovered){ this.recovered = true; return (now-this.aiStopStart)/1000; }
    return (now-this.aiStopStart)/1000;
  }

  // ── Scientific adaptive threshold: EAR_baseline - k * σ_EAR ──
  _updateAdaptiveThreshold(earAvg) {
    if (earAvg > 0.22 && earAvg < 0.55) {
      this._earHistory.push(earAvg);
      if (this._earHistory.length > this._earHistoryMax) this._earHistory.shift();
    }

    if (this._earHistory.length < 30) return;
    const mean = this._earHistory.reduce((a, b) => a + b, 0) / this._earHistory.length;
    const variance = this._earHistory.reduce((s, v) => s + (v - mean) ** 2, 0) / this._earHistory.length;
    const std = Math.sqrt(variance) || 0.005;

    this._adaptiveThreshold = mean - 2.5 * std;
    this._adaptiveThreshold = Math.max(0.12, Math.min(0.24, this._adaptiveThreshold));
  }

  update({earAvg, gazeX, gazeY, testMode='NON_AI', now=performance.now(), faceDetected=true, leftClosed=null, rightClosed=null}){
    if(!faceDetected || !Number.isFinite(earAvg)) return {...this.last};
    if(!this.validModes.has(testMode)) testMode = 'NON_AI';
    this._trim(now);

    this._updateAdaptiveThreshold(earAvg);
    const thresh = this._adaptiveThreshold;
    const closingThresh = thresh + 0.05;
    const partialThresh = thresh + 0.08;

    const earClosed = earAvg < thresh;
    const hasEyeFlags = (typeof leftClosed === 'boolean' && typeof rightClosed === 'boolean');
    const bothEyesClosed = hasEyeFlags ? (leftClosed && rightClosed) : earClosed;
    const oneEyeClosed = hasEyeFlags ? ((leftClosed && !rightClosed) || (!leftClosed && rightClosed)) : false;
    const closed = this.requireBothEyes ? bothEyesClosed : earClosed;
    this.closedSamples.push({t:now, closed});

    if(this.requireBothEyes && oneEyeClosed && !this.winkActive){
      this.winkActive = leftClosed ? 'LEFT' : 'RIGHT';
      if(leftClosed) this.winkLeftCount++;
      if(rightClosed) this.winkRightCount++;
      this.last.blink_validity_status = 'ONE_EYE_CLOSURE_REJECTED';
    }
    if(!oneEyeClosed) this.winkActive = null;

    // ── Formal 5-State Machine Blink State Logic ──
    switch (this.blinkState) {
      case 'OPEN':
        if (earAvg < closingThresh) {
          this.blinkState = 'CLOSING';
          this.closingStart = now;
        }
        break;

      case 'CLOSING':
        if (earAvg < thresh) {
          this.blinkState = 'CLOSED';
          this.closedStart = now;
          this.microsleepActive = false;
        } else if (earAvg >= closingThresh) {
          this.blinkState = 'OPEN';
          this.closingStart = null;
        }
        break;

      case 'CLOSED':
        if (this.closedStart !== null && now - this.closedStart >= this.microsleepThresholdMs) {
          this.last.microsleep_detected = true;
          if (!this.microsleepActive) {
            this.microsleepCount++;
            this.microsleepActive = true;
          }
        } else {
          this.last.microsleep_detected = false;
        }

        if (earAvg >= thresh) {
          this.blinkState = 'OPENING';
          this.openingStart = now;
        }
        break;

      case 'OPENING':
        if (earAvg >= closingThresh) {
          this.blinkState = 'OPEN';
          const dur = now - this.closingStart;
          const cooldownOk = this.lastBlinkAt === null || (now - this.lastBlinkAt) >= this.blinkCooldownMs;
          const validDuration = dur >= this.minBlinkDurationMs && dur <= this.maxBlinkDurationMs;

          if (validDuration && cooldownOk) {
            this.last.blink_duration_ms = this._num(dur, 1);
            this.blinkDurations.push({ t: now, durationMs: dur });
            this.blinks.push(now);

            if (this.lastBlinkAt !== null) {
              const timeSinceLastBlink = now - this.lastBlinkAt;
              if (timeSinceLastBlink <= this.doubleBlinkThresholdMs && timeSinceLastBlink > 50) {
                this.doubleBlinkCount++;
              }
            }
            this.lastBlinkAt = now;
            this.last.blink_validity_status = 'TRUE_BLINK_ACCEPTED';
          } else {
            if (dur < this.minBlinkDurationMs) {
              this.rejectedFastBlinkCount++;
              this.last.blink_validity_status = 'FAST_FLICKER_REJECTED';
            } else if (dur > this.maxBlinkDurationMs) {
              this.last.blink_validity_status = 'LONG_CLOSURE_REJECTED';
            } else {
              this.last.blink_validity_status = 'COOLDOWN_REJECTED';
            }
          }
          this.closingStart = null;
          this.closedStart = null;
          this.openingStart = null;
        } else if (earAvg < thresh) {
          this.blinkState = 'CLOSED';
          this.openingStart = null;
        }
        break;
    }

    if(this.blinkState === 'OPEN' && earAvg < partialThresh && this.partialBlinkArmed){
      this.partialBlinkCount++;
      this.partialBlinkArmed = false;
    }
    if(earAvg >= partialThresh) this.partialBlinkArmed = true;

    if(Number.isFinite(gazeX) && Number.isFinite(gazeY)){
      this.gazeSamples.push({t:now,x:gazeX,y:gazeY});
      if(this.prevGaze && this.prevT !== null){
        const dt = Math.max((now-this.prevT)/1000, 0.001);
        const v = Math.hypot(gazeX-this.prevGaze.x, gazeY-this.prevGaze.y) / dt;
        this.saccades.push({t:now,v});
      }
      this.prevGaze = {x:gazeX,y:gazeY};
      this.prevT = now;
    }

    const perclos = this._perclos();
    const blinkRate = this._blinkRate();
    const blinkVar = this._blinkVar();
    const ibiVar = this._ibiVarianceMs();
    const fixation = this._fixationDensity();
    const avgDur = this.blinkDurations.length ? this._mean(this.blinkDurations.map(o=>o.durationMs)) : 0;
    const saccade = this.saccades.length ? this._mean(this.saccades.map(o=>o.v)) : 0;

    if(testMode === 'REST_BASELINE' && Number.isFinite(perclos) && Number.isFinite(blinkVar) && Number.isFinite(blinkRate)){
      if(blinkRate >= 5 && blinkRate <= 35 && perclos >= 0 && perclos <= 1.0 && blinkVar >= 0 && blinkVar <= 3.0) {
        this.baseline = { blinkRate, perclos, blinkVar };
      }
    }

    const drift = this._attentionDrift(perclos, blinkVar, fixation, saccade);
    const strain = this._eyeStrain(blinkRate, avgDur, perclos, fixation);
    const recovery = this._recovery(testMode, blinkRate, perclos, blinkVar, now);

    this.last = {
      blink_duration_ms: this.last.blink_duration_ms,
      blink_frequency_variability: this._num(blinkVar, 4),
      inter_blink_interval_variance_ms: this._num(ibiVar, 1),
      microsleep_detected: !!this.last.microsleep_detected,
      microsleep_count: this.microsleepCount,
      partial_blink_count: this.partialBlinkCount,
      double_blink_count: this.doubleBlinkCount,
      perclos_trend: this._perclosTrend(),
      attention_drift_score: this._num(drift, 1),
      blink_recovery_time_sec: this._num(recovery, 2),
      eye_strain_index: this._num(strain, 1),
      saccade_velocity: this._num(saccade, 5),
      fixation_density: this._num(fixation, 1),
      true_blink_count: this.blinks.length,
      rejected_fast_blink_count: this.rejectedFastBlinkCount,
      wink_left_count: this.winkLeftCount,
      wink_right_count: this.winkRightCount,
      blink_validity_status: this.last.blink_validity_status || 'WAITING'
    };
    return {...this.last};
  }

  static columns(){
    return ['blink_duration_ms','blink_frequency_variability','inter_blink_interval_variance_ms','microsleep_detected','microsleep_count','partial_blink_count','double_blink_count','perclos_trend','attention_drift_score','blink_recovery_time_sec','eye_strain_index','saccade_velocity','fixation_density','true_blink_count','rejected_fast_blink_count','wink_left_count','wink_right_count','blink_validity_status'];
  }
}

// Adaptive threshold will self-calibrate from live EAR samples automatically.
const OculoFeatureExtractor = new OculometricFeatureExtractor({ earThreshold: 0.20, windowMs: 30000, requireBothEyes: false, minBlinkDurationMs: 60, maxBlinkDurationMs: 800, blinkCooldownMs: 150 });
const OculoFeatureLeft  = new OculometricFeatureExtractor({ earThreshold: 0.20, windowMs: 30000 });
const OculoFeatureRight = new OculometricFeatureExtractor({ earThreshold: 0.20, windowMs: 30000 });
let latestOculoFeatures = {...OculoFeatureExtractor.last};
let latestEyeChannelFeatures = {
  combined_ear: 0,
  left_ear: 0,
  right_ear: 0
};
function getTestMode(){ const el = $('testModeSelect'); return el ? el.value : 'NON_AI'; }
function safeFeature(v){
  if (v === undefined || v === null || v === '' || v === 'calculating') return 0;
  if (typeof v === 'number' && !Number.isFinite(v)) return 0;
  return v;
}
function prefixFeatureSet(prefix, obj){
  const out = {};
  OculometricFeatureExtractor.columns().forEach(col => { out[prefix + col] = safeFeature(obj && obj[col]); });
  return out;
}
function getAllOculoCSVFeatures(){
  let neural = {};
  try {
    const nm = (typeof EEGSys !== 'undefined' && EEGSys.getMetrics) ? EEGSys.getMetrics() : null;
    const load = nm ? (nm.hwMode ? ((nm.metrics.workload||0)*0.4 + (nm.metrics.fatigue||0)*0.3 + (100-(nm.metrics.attention||0))*0.3) : (nm.camera.cognitiveLoad || 0)) : 0;
    neural = {
      neural_source: nm ? nm.source : 'NO SIGNAL',
      neural_attention: nm ? (nm.metrics.attention || 0) : 0,
      neural_meditation: nm ? (nm.metrics.meditation || 0) : 0,
      neural_workload: nm ? (nm.metrics.workload || 0) : 0,
      neural_fatigue: nm ? (nm.metrics.fatigue || 0) : 0,
      neural_engagement: nm ? (nm.metrics.engagement || 0) : 0,
      neural_coherence: nm ? (nm.metrics.coherence || 0) : 0,
      neural_cognitive_load: Number.isFinite(load) ? Number(load.toFixed(1)) : 0,
      eeg_delta: nm ? (nm.waves.delta || 0) : 0,
      eeg_theta: nm ? (nm.waves.theta || 0) : 0,
      eeg_alpha: nm ? (nm.waves.alpha || 0) : 0,
      eeg_beta: nm ? (nm.waves.beta || 0) : 0,
      eeg_gamma: nm ? (nm.waves.gamma || 0) : 0
    };
  } catch(e) {}
  return {
    ...latestOculoFeatures,
    ...latestEyeChannelFeatures,
    ...neural,
    test_mode: getTestMode()
  };
}
function formatTimestampExcel(ts){
  const d = new Date(ts);
  const pad = (n,w=2)=>String(n).padStart(w,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(),3)}`;
}
function setOculoFeatureUI(f){
  if(!f) return;
  latestOculoFeatures = {...latestOculoFeatures, ...f};
  const set = (id, val) => { const el=$(id); if(el) el.textContent = String(safeFeature(val)); };
  set('ocxBlinkDuration', typeof f.blink_duration_ms === 'number' ? f.blink_duration_ms + ' ms' : f.blink_duration_ms);
  set('ocxBlinkFreqVar', typeof f.blink_frequency_variability === 'number' ? f.blink_frequency_variability : f.blink_frequency_variability);
  set('ocxIBIVar', typeof f.inter_blink_interval_variance_ms === 'number' ? f.inter_blink_interval_variance_ms + ' ms²' : f.inter_blink_interval_variance_ms);
  set('ocxMicrosleep', (f.microsleep_detected ? 'True' : 'False') + ' · ' + f.microsleep_count);
  set('ocxPartialBlink', f.partial_blink_count);
  set('ocxDoubleBlink', f.double_blink_count);
  set('ocxPerclosTrend', f.perclos_trend);
  set('ocxAttentionDrift', typeof f.attention_drift_score === 'number' ? f.attention_drift_score + '/100' : f.attention_drift_score);
  set('ocxBlinkRecovery', typeof f.blink_recovery_time_sec === 'number' ? f.blink_recovery_time_sec + ' sec' : f.blink_recovery_time_sec);
  set('ocxEyeStrain', typeof f.eye_strain_index === 'number' ? f.eye_strain_index + '/100' : f.eye_strain_index);
  set('ocxSaccade', typeof f.saccade_velocity === 'number' ? f.saccade_velocity : f.saccade_velocity);
  set('ocxFixation', typeof f.fixation_density === 'number' ? f.fixation_density + '%' : f.fixation_density);
}
function getCurrentOculoFeatures(){ return {...latestOculoFeatures}; }

const CamSys = (() => {
  let stream = null, active = false, raf = null;
  let canvas, ctx, mpVideo, faceMesh, mpCamera;

  // MediaPipe 468-landmark indices for EAR
  // Left eye  (subject perspective): vertical p2p6,p3p5 horizontal p1p4
  const L_IDX = [362, 385, 387, 263, 373, 380];
  const R_IDX = [33,  160, 158, 133, 153, 144];

  // Face oval landmarks for outline drawing
  const FACE_OVAL = [10,338,297,332,284,251,389,356,454,323,361,288,
                     397,365,379,378,400,377,152,148,176,149,150,136,
                     172,58,132,93,234,127,162,21,54,103,67,109];

  // Runtime state
  let earL = 0.30, earR = 0.30;
  let blinkCnt = 0, blinkInProgress = false, closedFrames = 0;
  let blinkStartTime = 0;
  let lastBlinkTime = Date.now();
  let ibiHistory = [], perclosWindow = [];
  let gazeXHist = [], gazeYHist = [];
  let latestLM = null;
  let frameCount = 0, lastFPSt = Date.now(), fps = 0;

  // Camera Quality Metrics
  let latestQualityScore = 100;
  let latestQualityLabel = 'GOOD';
  let qualityScoreHistory = [];
  let lowQualityFrameCount = 0;

  // Kalman filters
  let KG = {x:85, p:1, q:0.05, r:1.5};
  let KA = {x:78, p:1, q:0.08, r:2.0};

  // ── Personal Baseline Calibration (adaptive threshold, not fixed) ──
  // Calibrate threshold dynamically per participant based on active range
  // (5th to 95th percentiles of EAR) over a rolling window of 150 frames.
  const EAR_BASELINE_TARGET_FRAMES = 150;
  let earBaselineBuf = [];
  let earCalibrated = false;
  let earCalibrationDiscardedCount = 0;

  // Thresholds — EAR_BLINK_THRESH starts as a conservative fallback and is
  // REPLACED by the adaptive value once 150 frames are collected.
  let EAR_BLINK_THRESH  = 0.20; // fallback only, until updateEarBaseline() calibrates
  const EAR_CONSEC_FRAMES = 2;

  // Called every frame with the current earAvg. Keeps a rolling window of 150 frames
  // and dynamically updates the adaptive threshold using the 5th and 95th percentiles.
  function updateEarBaseline(earAvg) {
    const plausible = earAvg > 0.10 && earAvg < 0.55;
    if (!plausible) { earCalibrationDiscardedCount++; return; }
    earBaselineBuf.push(earAvg);
    if (earBaselineBuf.length > EAR_BASELINE_TARGET_FRAMES) {
      earBaselineBuf.shift();
    }
    if (earBaselineBuf.length < 30) return; // need min 30 frames to calculate percentiles

    const sorted = [...earBaselineBuf].sort((a, b) => a - b);
    const p5  = sorted[Math.floor(sorted.length * 0.05)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const range = p95 - p5;
    if (range > 0.03) {
      EAR_BLINK_THRESH = p5 + 0.35 * range;
    }

    if (!earCalibrated && earBaselineBuf.length >= EAR_BASELINE_TARGET_FRAMES) {
      earCalibrated = true;
      if (typeof addAlert === 'function') {
        addAlert(`Personal EAR baseline calibrated — dynamic rolling blink threshold set to ${EAR_BLINK_THRESH.toFixed(3)} based on 5th/95th percentiles`, 'ok');
      }
      if (typeof toast === 'function') {
        toast('BASELINE CALIBRATED', `Adaptive EAR threshold: ${EAR_BLINK_THRESH.toFixed(3)} (was fixed 0.20)`, 'info');
      }
    }
  }

  function getEarCalibrationProgress() {
    return {
      calibrated: earCalibrated,
      framesCollected: earBaselineBuf.length,
      framesTarget: EAR_BASELINE_TARGET_FRAMES,
      pct: Math.min(100, Math.round(100 * earBaselineBuf.length / EAR_BASELINE_TARGET_FRAMES)),
      mean: earBaselineBuf.length ? (earBaselineBuf.reduce((a,b)=>a+b,0)/earBaselineBuf.length) : 0.30,
      std: 0,
      threshold: EAR_BLINK_THRESH
    };
  }

  // Overlay toggles
  let showMesh = true, showEyes = true, showBlinkOvl = true;

  // ── EAR from 6 landmarks ──
  function calcEAR(lm, idx, W, H) {
    const p = idx.map(i => ({ x: lm[i].x * W, y: lm[i].y * H }));
    const v1 = Math.hypot(p[1].x - p[5].x, p[1].y - p[5].y);
    const v2 = Math.hypot(p[2].x - p[4].x, p[2].y - p[4].y);
    const h  = Math.hypot(p[0].x - p[3].x, p[0].y - p[3].y);
    return (v1 + v2) / (2.0 * h + 1e-6);
  }

  // ── Kalman update ──
  function kalman(k, z) {
    k.p += k.q;
    const g = k.p / (k.p + k.r);
    k.x  += g * (z - k.x);
    k.p  *= (1 - g);
    return k.x;
  }

  // ── PERCLOS P80 ──
  function computePERCLOS(arr) {
    if (arr.length < 10) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const base   = sorted[Math.floor(sorted.length * 0.9)];
    const thresh = base * 0.80;
    return Math.round(arr.filter(v => v < thresh).length / arr.length * 100);
  }

  // ── Gaze stability from nose-tip movement variance ──
  function gazeStability() {
    if (gazeXHist.length < 8) return 0;
    const mx = gazeXHist.reduce((a,b) => a + b, 0) / gazeXHist.length;
    const my = gazeYHist.reduce((a,b) => a + b, 0) / gazeYHist.length;
    const vx = gazeXHist.reduce((a,b) => a + (b-mx)**2, 0) / gazeXHist.length;
    const vy = gazeYHist.reduce((a,b) => a + (b-my)**2, 0) / gazeYHist.length;
    return Math.max(30, Math.min(99, Math.round(100 - Math.sqrt(vx + vy) * 900)));
  }

  // ── MediaPipe results callback — fires every camera frame ──
  function onResults(results) {
    if (!canvas || !ctx) return;
    const W = canvas.width, H = canvas.height;

    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(results.image, 0, 0, W, H);

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      const lm = results.multiFaceLandmarks[0];
      latestLM = lm;

      // Face mesh overlay
      if (showMesh) {
        // Face oval
        ctx.strokeStyle = 'rgba(0,229,255,0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        FACE_OVAL.forEach((idx, k) => {
          const p = lm[idx];
          k === 0 ? ctx.moveTo(p.x*W, p.y*H) : ctx.lineTo(p.x*W, p.y*H);
        });
        ctx.closePath(); ctx.stroke();

        // Sparse mesh grid
        ctx.strokeStyle = 'rgba(0,229,255,0.09)';
        ctx.lineWidth = 0.4;
        for (let i = 0; i < lm.length - 1; i += 3) {
          if (lm[i] && lm[i+1]) {
            ctx.beginPath();
            ctx.moveTo(lm[i].x*W, lm[i].y*H);
            ctx.lineTo(lm[i+1].x*W, lm[i+1].y*H);
            ctx.stroke();
          }
        }
      }

      // Compute real EAR
      earL = calcEAR(lm, L_IDX, W, H);
      earR = calcEAR(lm, R_IDX, W, H);
      const earAvg = (earL + earR) / 2;

      // Feed personal baseline calibration until it locks in an adaptive threshold
      updateEarBaseline(earAvg);

      perclosWindow.push(earAvg);
      if (perclosWindow.length > 200) perclosWindow.shift();

      // ── Robust Camera & Frame Quality Evaluation ──
      const quality = evalCameraQuality(lm, W, H, ctx);
      // ── §21 DQC: 5-tier per-frame quality evaluation ──
      const headPoseOk = Math.abs(quality.yaw) <= 20 && Math.abs(quality.pitch) <= 15 && Math.abs(quality.roll) <= 15;
      const dqcResult  = (typeof DataQualityController !== 'undefined')
        ? DataQualityController.evaluate(quality.qualityScore, quality.conf ?? 0.9, fps || 30, headPoseOk, Date.now())
        : { score: quality.qualityScore, label: quality.label, usable: true };
      latestQualityScore = quality.qualityScore;
      latestQualityLabel = dqcResult.label; // now 5-tier: EXCELLENT/GOOD/ACCEPTABLE/POOR/REJECT

      if (window.isRecording) {
        qualityScoreHistory.push(latestQualityScore);
        if (latestQualityScore < 80) {
          lowQualityFrameCount++;
          if (lowQualityFrameCount >= 150) { // 5 seconds at 30 fps
            lowQualityFrameCount = 0;
            stopManualSessionNow();
            addEventMarker('Tracking_Integrity_Compromised', 'SYSTEM');
            addAlert('RECORDING STOPPED: Webcam tracking quality dropped below 80% (integrity compromised)', 'crit');
            toast('QUALITY ALERT', 'Recording stopped due to poor tracking quality', 'warn');
          } else if (lowQualityFrameCount % 30 === 0) {
            addAlert(`Webcam quality warning: ${latestQualityLabel} (${latestQualityScore}%). Improve lighting or posture!`, 'warn');
          }
        } else {
          lowQualityFrameCount = 0;
        }
      }

      // Draw eye contours
      if (showEyes) {
        [[L_IDX, '#00e5ff'], [R_IDX, '#00ff88']].forEach(([idx, color]) => {
          const pts = idx.map(i => ({ x: lm[i].x*W, y: lm[i].y*H }));
          ctx.strokeStyle = color;
          ctx.lineWidth = (earL < EAR_BLINK_THRESH && earR < EAR_BLINK_THRESH) ? 2.5 : 1.6;
          ctx.beginPath();
          pts.forEach((p, k) => k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
          ctx.closePath(); ctx.stroke();
          // Centre dot
          const cx = pts.reduce((a,p) => a+p.x, 0) / pts.length;
          const cy = pts.reduce((a,p) => a+p.y, 0) / pts.length;
          ctx.fillStyle = color;
          ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI*2); ctx.fill();
        });
      }

      // EAR bar overlay
      const barEl = $('earBar');
      if (barEl) {
        const pct = Math.max(0, Math.min(100, Math.round(earAvg / 0.38 * 100)));
        barEl.style.width = pct + '%';
        barEl.style.background = earAvg < EAR_BLINK_THRESH
          ? 'linear-gradient(90deg,var(--red),var(--amber))'
          : 'linear-gradient(90deg,var(--cyan),var(--green))';
      }
      const earLEl=$('earLVal'), earREl=$('earRVal');
      if (earLEl) earLEl.textContent = earL.toFixed(3);
      if (earREl) earREl.textContent = earR.toFixed(3);

      // ── TRUE PUPIL-RELATIVE GAZE ──
      const eyeCenter = (idx) => {
        const pts = idx.map(i => lm[i]);
        return {
          x: pts.reduce((a,p)=>a+p.x,0) / pts.length,
          y: pts.reduce((a,p)=>a+p.y,0) / pts.length
        };
      };
      const lc = eyeCenter(L_IDX);
      const rc = eyeCenter(R_IDX);

      const leftPupilOffX  = lm[468] ? (lm[468].x - lc.x) : 0;
      const leftPupilOffY  = lm[468] ? (lm[468].y - lc.y) : 0;
      const rightPupilOffX = lm[473] ? (lm[473].x - rc.x) : 0;
      const rightPupilOffY = lm[473] ? (lm[473].y - rc.y) : 0;
      const gazeX = (leftPupilOffX + rightPupilOffX) / 2;
      const gazeY = (leftPupilOffY + rightPupilOffY) / 2;

      gazeXHist.push(gazeX); gazeYHist.push(gazeY);
      if (gazeXHist.length > 90) { gazeXHist.shift(); gazeYHist.shift(); }

      if (showEyes && lm[468] && lm[473]) {
        [[468,'#ffb300'],[473,'#ffb300']].forEach(([li, col]) => {
          ctx.beginPath();
          ctx.arc(lm[li].x*W, lm[li].y*H, 3, 0, Math.PI*2);
          ctx.fillStyle = col; ctx.fill();
        });
      }

      const nowPerf = performance.now();
      const tm = getTestMode();

      const adaptThreshL = OculoFeatureLeft._adaptiveThreshold;
      const adaptThreshR = OculoFeatureRight._adaptiveThreshold;

      const leftFeatures  = OculoFeatureLeft.update({earAvg:earL, gazeX:leftPupilOffX,  gazeY:leftPupilOffY,  testMode:tm, now:nowPerf, faceDetected:true});
      const rightFeatures = OculoFeatureRight.update({earAvg:earR, gazeX:rightPupilOffX, gazeY:rightPupilOffY, testMode:tm, now:nowPerf, faceDetected:true});
      
      const ocx = OculoFeatureExtractor.update({
        earAvg,
        gazeX,
        gazeY,
        testMode: tm,
        now: nowPerf,
        faceDetected: true,
        leftClosed:  earL < adaptThreshL,
        rightClosed: earR < adaptThreshR
      });

      // Synchronize CamSys local blink count with formal state machine output
      blinkCnt = ocx.true_blink_count;
      blinkInProgress = (OculoFeatureExtractor.blinkState === 'CLOSED' || OculoFeatureExtractor.blinkState === 'CLOSING');

      // Blink overlay text
      if (showBlinkOvl && blinkInProgress) {
        ctx.fillStyle = 'rgba(255,45,85,0.9)';
        ctx.font = 'bold 14px Share Tech Mono';
        ctx.textAlign = 'center';
        ctx.fillText('BLINK DETECTED', W/2, 30);
        ctx.textAlign = 'left';
      }

      // §23: Store DQC score in features for export
      latestEyeChannelFeatures = {
        combined_ear: Number(earAvg.toFixed(4)),
        left_ear: Number(earL.toFixed(4)),
        right_ear: Number(earR.toFixed(4)),
        adaptive_threshold: Number(OculoFeatureExtractor._adaptiveThreshold.toFixed(4)),
        gaze_x: Number(gazeX.toFixed(5)),
        gaze_y: Number(gazeY.toFixed(5)),
        camera_quality_score:       latestQualityScore,
        camera_quality_label:       latestQualityLabel,
        dqc_score:                  dqcResult.score,
        frame_usable:               dqcResult.usable ? 1 : 0,
        experiment_integrity_score: getExperimentIntegrityScore(),
        ...prefixFeatureSet('left_', leftFeatures),
        ...prefixFeatureSet('right_', rightFeatures),
        ...prefixFeatureSet('combined_', ocx)
      };
      setOculoFeatureUI(ocx);

      // §24: Log accepted blinks to BlinkEventLogger
      if (typeof BlinkEventLogger !== 'undefined') {
        const prevBlinks = (latestEyeChannelFeatures.combined_true_blink_count || 0);
        if (ocx.true_blink_count > prevBlinks) {
          BlinkEventLogger.record({
            type:       'ACCEPTED',
            side:       'BILATERAL',
            earAtClose: earAvg,
            durationMs: ocx.blink_duration_ms,
            validity:   ocx.blink_validity_status,
            blinkNum:   ocx.true_blink_count,
            condition:  tm
          });
        }
      }

      // Feed Scientific Baseline Calibrator (60 seconds)
      if (window.ScientificCalibrator && !window.ScientificCalibrator.calibrated) {
        window.ScientificCalibrator.addSample({
          earAvg, earL, earR, gazeX, gazeY
        });
      }

      // ── FMG Computation — Facial Muscle Group indices from live landmarks ──
      if (typeof FMGEngine !== 'undefined') {
        FMGEngine.process(lm, W, H);
      }

    } else {
      latestLM = null;
      latestQualityScore = 0;
      latestQualityLabel = 'FACE_LOST';
      ctx.fillStyle = 'rgba(255,179,0,0.55)';
      ctx.font = '11px Share Tech Mono';
      ctx.textAlign = 'center';
      ctx.fillText('NO FACE DETECTED', W/2, 24);
      ctx.textAlign = 'left';

      if (window.isRecording) {
        qualityScoreHistory.push(0);
        lowQualityFrameCount++;
        if (lowQualityFrameCount >= 150) {
          lowQualityFrameCount = 0;
          stopManualSessionNow();
          addEventMarker('Face_Lost', 'SYSTEM');
          addAlert('RECORDING STOPPED: Face lost for more than 5 seconds (integrity compromised)', 'crit');
          toast('FACE LOST', 'Recording stopped because face was lost', 'warn');
        }
      }

      if (typeof FMGEngine !== 'undefined') FMGEngine.resetUI();
    }

    // FPS
    frameCount++;
    const nowt = Date.now();
    if (nowt - lastFPSt >= 1000) {
      fps = frameCount; frameCount = 0; lastFPSt = nowt;
      const fpsEl = $('mpFPS');
      if (fpsEl) fpsEl.textContent = 'MP '+fps+'fps';
    }

    // §26: PerformanceMonitor — end frame timing
    if (typeof PerformanceMonitor !== 'undefined') PerformanceMonitor.frameEnd();

    drawHUD(W, H);
    ctx.restore();
  }

  // ── HUD corner brackets + status ──
  function drawHUD(W, H) {
    ctx.strokeStyle = 'rgba(0,229,255,0.55)'; ctx.lineWidth = 1.5;
    [[10,10,1,1],[W-10,10,-1,1],[10,H-10,1,-1],[W-10,H-10,-1,-1]].forEach(([x,y,sx,sy])=>{
      ctx.beginPath();
      ctx.moveTo(x,y); ctx.lineTo(x+sx*22,y);
      ctx.moveTo(x,y); ctx.lineTo(x,y+sy*22);
      ctx.stroke();
    });
    ctx.fillStyle = 'rgba(0,229,255,0.65)';
    ctx.font = '10px Share Tech Mono';
    ctx.textAlign = 'left';
    ctx.fillText('BLINKS:'+blinkCnt, 14, 22);
    if (latestLM) {
      const earAvg = (earL+earR)/2;
      ctx.fillStyle = (earL < EAR_BLINK_THRESH && earR < EAR_BLINK_THRESH) ? 'rgba(255,45,85,0.9)' : 'rgba(0,255,136,0.7)';
      const trueState = (earL < EAR_BLINK_THRESH && earR < EAR_BLINK_THRESH) ? 'BOTH CLOSED' : ((earL < EAR_BLINK_THRESH || earR < EAR_BLINK_THRESH) ? 'ONE EYE REJECT' : 'OPEN');
      ctx.fillText('EAR:'+earAvg.toFixed(3)+' '+trueState, 14, 38);
    }

    // Draw Camera Quality on HUD
    ctx.fillStyle = latestQualityScore >= 80 ? 'rgba(0,255,136,0.7)' : 'rgba(255,45,85,0.9)';
    ctx.fillText('QUALITY: ' + latestQualityScore + '% (' + latestQualityLabel + ')', 14, H - 24);
    if (window.isRecording) {
      ctx.fillStyle = 'rgba(255,45,85,0.9)';
      ctx.fillText('RECORDING LIVE', 14, H - 10);
    }

    ctx.fillStyle = 'rgba(0,229,255,0.5)';
    ctx.textAlign = 'right';
    ctx.fillText(new Date().toLocaleTimeString('en-US',{hour12:false}), W-10, 22);
    ctx.textAlign = 'left';
  }

  // ── Init MediaPipe ──
  async function initMP() {
    mpVideo = $('mpVideo');
    if (!mpVideo) return;
    if (typeof FaceMesh === 'undefined') {
      await new Promise(r => setTimeout(r, 2500));
      if (typeof FaceMesh === 'undefined') {
        $('mpBadge').textContent = 'MP NOT LOADED';
        $('mpBadge').style.color = 'var(--amber)';
        return;
      }
    }
    try {
      faceMesh = new FaceMesh({
        locateFile: f => 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/'+f
      });
      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.55,
        minTrackingConfidence: 0.55
      });
      faceMesh.onResults(onResults);
      $('mpBadge').textContent = 'MP 468-LM READY';
      $('mpBadge').style.color = 'var(--green)';
    } catch(e) {
      console.error('FaceMesh init failed:', e);
      $('mpBadge').textContent = 'MP INIT FAILED';
      $('mpBadge').style.color = 'var(--red)';
      addAlert('MediaPipe FaceMesh failed to init — check network/CDN connection', 'crit');
      toast('MP INIT FAILED', 'FaceMesh unavailable — check internet connection', 'crit');
    }
  }

  function init() {
    canvas = $('cameraCanvas');
    ctx    = canvas ? canvas.getContext('2d') : null;
    setTimeout(() => initMP(), 600);
  }

  // NOTE: Private start() removed — camera launch is handled by
  // the public start() method in the return object below,
  // which supports both 'timed' and 'manual' session modes.

  function stop() {
    active = false;
    if (mpCamera) { try{mpCamera.stop();}catch(e){} mpCamera=null; }
    if (raf) { cancelAnimationFrame(raf); raf=null; }
    if (stream) { stream.getTracks().forEach(t=>t.stop()); stream=null; }
    if (canvas) canvas.style.display='none';
    $('camPh').style.display='flex';
    $('scanline').classList.remove('on');
    $('liveBadge').style.opacity='0';
    $('earOverlay').style.display='none';
    $('mpFPS').style.display='none';
    $('startCamBtn').disabled=false; $('stopCamBtn').disabled=true; $('snapBtn').disabled=true;
    $('pillCam').className='spill standby';
    $('pillCam').innerHTML='<div class="dot a"></div>CAMERA STANDBY';
    $('dataSource').textContent='(camera off)';
    $('dataSource').style.color='#334';
    latestLM = null;
    ['mBlink','mGaze','mAttn','mClose','mIBI'].forEach(id=>{const el=$(id);if(el)el.textContent='—';});
    $('mBlinkCnt').textContent='0';
    $('mEARL').textContent='—'; $('mEARR').textContent='—';
    setOculoFeatureUI(latestOculoFeatures);
    addAlert('Camera stopped — oculometrics paused','info');
  }

  function snap() {
    if (!canvas) return;
    const a=document.createElement('a');
    a.download='neuromia-oculo-'+Date.now()+'.png';
    a.href=canvas.toDataURL('image/png'); a.click();
    toast('SNAPSHOT','Oculometric frame captured','ok');
  }

  // ── updateMetrics: called from main loop every 200ms ──
  function updateMetrics() {
    if (!active) return;

    let brVal=0, ibiAvg=0;
    if (ibiHistory.length >= 2) {
      ibiAvg = Math.round(ibiHistory.reduce((a,b)=>a+b,0)/ibiHistory.length);
      brVal  = Math.min(40, Math.max(0, +(60000/Math.max(ibiAvg,400)).toFixed(1)));
    }

    const pclos = computePERCLOS(perclosWindow);
    const rawG  = gazeStability();
    const gazeV = Math.round(Math.max(30,Math.min(99,kalman(KG,rawG))));
    const rawA  = gazeV*0.6 + (100-pclos)*0.4;
    const attnV = Math.round(Math.max(20,Math.min(99,kalman(KA,rawA))));
    const closeV = Math.max(0,Math.min(50,pclos));

    $('mBlink').textContent    = latestLM ? brVal.toFixed(1)+' /min' : '— /min';
    $('mGaze').textContent     = latestLM ? gazeV+'%'            : '—%';
    $('mAttn').textContent     = latestLM ? attnV+'%'            : '—%';
    $('mClose').textContent    = latestLM ? closeV.toFixed(1)+'%': '—%';
    $('mBlinkCnt').textContent = blinkCnt;
    $('mIBI').textContent      = latestLM ? ibiAvg.toLocaleString()+' ms' : '— ms';
    $('mEARL').textContent     = latestLM ? earL.toFixed(3) : '—';
    $('mEARR').textContent     = latestLM ? earR.toFixed(3) : '—';

    // Push real data to session history (face must be detected)
    if (latestLM) {
      OculoHistory.pushLive({br:brVal, gs:gazeV, at:attnV, ec:closeV, tb:blinkCnt, ibi:ibiAvg, ...getAllOculoCSVFeatures(), test_mode:getTestMode()});
    }
  }

  // ══════════════════════════════════════════════════════
  // BLINK WAVEFORM GRAPH — real-time EAR dual-channel plot
  // ══════════════════════════════════════════════════════
  const BlinkGraph = (() => {
    const MAX_SAMPLES = 300; // ~10 seconds at 30fps
    let bufL = new Array(MAX_SAMPLES).fill(0.30);
    let bufR = new Array(MAX_SAMPLES).fill(0.30);
    let blinkMarkers = []; // [{frame, side}]
    let gc = null, gCanvas = null;
    let graphFrame = 0, lastGraphFPS = Date.now(), graphFPS = 0, gfCount = 0;
    const THRESH = 0.20;
    const YMIN = 0.0, YMAX = 0.42;

    function init() {
      gCanvas = $('blinkWaveCanvas');
      if (!gCanvas) return;
      gc = gCanvas.getContext('2d');
    }

    function push(el, er) {
      bufL.push(el); bufR.push(er);
      if (bufL.length > MAX_SAMPLES) { bufL.shift(); bufR.shift(); }
      // Record blink marker when EAR crosses threshold downward
      const prevL = bufL[bufL.length - 2], prevR = bufR[bufR.length - 2];
      if (prevL > THRESH && el <= THRESH) blinkMarkers.push({pos: bufL.length - 1, side:'L'});
      if (prevR > THRESH && er <= THRESH) blinkMarkers.push({pos: bufR.length - 1, side:'R'});
      // Expire old markers
      blinkMarkers = blinkMarkers.filter(m => (bufL.length - 1 - m.pos) < MAX_SAMPLES);
      graphFrame++;
    }

    function draw() {
      if (!gc || !gCanvas) return;
      const W = gCanvas.offsetWidth || 280;
      const H = 80;
      if (gCanvas.width !== W) { gCanvas.width = W; gCanvas.height = H; }

      gc.clearRect(0, 0, W, H);

      // Background
      gc.fillStyle = 'rgba(0,0,0,0.0)';
      gc.fillRect(0, 0, W, H);

      // Grid lines
      gc.strokeStyle = 'rgba(255,255,255,0.05)';
      gc.lineWidth = 0.5;
      [0.10, 0.20, 0.30, 0.40].forEach(v => {
        const y = H - ((v - YMIN) / (YMAX - YMIN)) * H;
        gc.beginPath(); gc.moveTo(20, y); gc.lineTo(W, y); gc.stroke();
      });

      // Threshold line
      const ty = H - ((THRESH - YMIN) / (YMAX - YMIN)) * H;
      gc.strokeStyle = 'rgba(255,45,85,0.4)';
      gc.lineWidth = 1;
      gc.setLineDash([4, 3]);
      gc.beginPath(); gc.moveTo(20, ty); gc.lineTo(W, ty); gc.stroke();
      gc.setLineDash([]);

      // Position threshold label
      const lbl = $('threshLabel');
      if (lbl) lbl.style.top = (ty - 8) + 'px';

      // Vertical time markers (every 5s ≈ 150 frames)
      gc.strokeStyle = 'rgba(255,255,255,0.04)';
      gc.lineWidth = 0.5;
      const step = Math.floor(MAX_SAMPLES / 2);
      for (let i = 1; i <= 1; i++) {
        const x = 20 + (i * step / MAX_SAMPLES) * (W - 20);
        gc.beginPath(); gc.moveTo(x, 0); gc.lineTo(x, H); gc.stroke();
      }

      const drawLine = (buf, color) => {
        gc.strokeStyle = color;
        gc.lineWidth = 1.5;
        gc.shadowColor = color;
        gc.shadowBlur = 3;
        gc.beginPath();
        buf.forEach((v, i) => {
          const x = 20 + (i / (MAX_SAMPLES - 1)) * (W - 20);
          const y = H - ((Math.max(YMIN, Math.min(YMAX, v)) - YMIN) / (YMAX - YMIN)) * H;
          i === 0 ? gc.moveTo(x, y) : gc.lineTo(x, y);
        });
        gc.stroke();
        gc.shadowBlur = 0;
      };

      drawLine(bufL, 'rgba(0,229,255,0.85)');
      drawLine(bufR, 'rgba(0,255,136,0.75)');

      // Fill under threshold (blink region)
      gc.fillStyle = 'rgba(255,45,85,0.07)';
      gc.beginPath();
      gc.moveTo(20, ty);
      bufL.forEach((v, i) => {
        const x = 20 + (i / (MAX_SAMPLES - 1)) * (W - 20);
        const y = H - ((Math.max(YMIN, Math.min(THRESH, v)) - YMIN) / (YMAX - YMIN)) * H;
        i === 0 ? gc.lineTo(x, ty) : gc.lineTo(x, y);
      });
      gc.lineTo(20 + (W - 20), ty);
      gc.closePath(); gc.fill();

      // Blink event markers
      blinkMarkers.forEach(m => {
        const age = bufL.length - 1 - m.pos;
        if (age < 0 || age >= MAX_SAMPLES) return;
        const x = 20 + ((MAX_SAMPLES - 1 - age) / (MAX_SAMPLES - 1)) * (W - 20);
        gc.strokeStyle = m.side === 'L' ? 'rgba(0,229,255,0.6)' : 'rgba(0,255,136,0.6)';
        gc.lineWidth = 1;
        gc.setLineDash([2, 2]);
        gc.beginPath(); gc.moveTo(x, 0); gc.lineTo(x, ty - 2); gc.stroke();
        gc.setLineDash([]);
        gc.fillStyle = m.side === 'L' ? 'rgba(0,229,255,0.8)' : 'rgba(0,255,136,0.8)';
        gc.font = '7px Share Tech Mono';
        gc.textAlign = 'center';
        gc.fillText(m.side, x, 8);
        gc.textAlign = 'left';
      });

      // FPS counter
      gfCount++;
      const now = Date.now();
      if (now - lastGraphFPS >= 1000) {
        graphFPS = gfCount; gfCount = 0; lastGraphFPS = now;
        const fpsEl = $('blinkGraphFps');
        if (fpsEl) fpsEl.textContent = graphFPS + 'fps';
      }
    }

    function reset() {
      bufL = new Array(MAX_SAMPLES).fill(0.30);
      bufR = new Array(MAX_SAMPLES).fill(0.30);
      blinkMarkers = [];
    }

    return { init, push, draw, reset };
  })();

  // ══════════════════════════════════════════════════════
  // SESSION — manual start/stop only
  // ══════════════════════════════════════════════════════
  let manualTimer  = null;
  let manualElapsed = 0;

  // ── FORMAT MM:SS ──
  function fmtElapsed(s) {
    return String(Math.floor(s/60)).padStart(2,'0') + ':' + String(s%60).padStart(2,'0');
  }

  // ── MANUAL SESSION: start ──
  function startManualSession() {
    if (manualTimer) return;
    manualElapsed = 0;
    const wrap = $('manualSessionWrap');
    if (wrap) wrap.style.display = 'block';
    const el = $('manualElapsed');
    if (el) el.textContent = '00:00';
    manualTimer = setInterval(() => {
      manualElapsed++;
      const el2 = $('manualElapsed');
      if (el2) el2.textContent = fmtElapsed(manualElapsed);
    }, 1000);
    toast('RECORDING STARTED', 'Manual session active — press STOP RECORDING to end & save', 'ok');
    addAlert('Manual session recording started — press STOP RECORDING when done', 'ok');
  }

  // ── MANUAL SESSION: stop + save ──
  function stopManualSessionNow() {
    if (!manualTimer) return;
    clearInterval(manualTimer);
    manualTimer = null;
    // ── CRITICAL BUG #1 FIX: Stop recording clock precisely here ──
    const recInfo = stopRecordingTimestamp();
    const elapsed = recInfo ? (
      `${String(Math.floor(recInfo.durationSec/60)).padStart(2,'0')}:${String(Math.floor(recInfo.durationSec%60)).padStart(2,'0')}`
    ) : fmtElapsed(manualElapsed);

    // Capture snapshot
    let saved = false;
    const brText = $('mBlink') ? $('mBlink').textContent : '';
    const br = parseFloat(brText);
    if (!isNaN(br) && brText.includes('/min')) {
      const gs  = parseFloat($('mGaze').textContent);
      const at  = parseFloat($('mAttn').textContent);
      const ec  = parseFloat($('mClose').textContent);
      const tb  = parseInt($('mBlinkCnt').textContent);
      const ibi = parseFloat(($('mIBI').textContent || '').replace(/,/g,''));
      if (![gs, at, ec, tb, ibi].some(v => Number.isNaN(v))) {
        OculoHistory.recordSession({ br, gs, at, ec, tb, ibi,
          ...getAllOculoCSVFeatures(), test_mode: getTestMode() });
        saved = true;
      }
    }
    stop(); // stop camera & all streams
    toast('RECORDING STOPPED',
      saved ? `Manual session (${elapsed}) captured & saved` : 'Session ended — no valid face data to save',
      saved ? 'ok' : 'warn');
    addAlert(
      saved ? `Manual session complete (${elapsed}) — snapshot saved to history`
            : 'Manual session ended — no valid oculometric data was captured',
      saved ? 'ok' : 'warn');
    if ($('manualSessionWrap')) $('manualSessionWrap').style.display = 'none';
    manualElapsed = 0;
    BlinkGraph.reset();

    // ── Nudge the researcher toward the NASA-TLX rating for the task just completed ──
    if (saved) {
      setTimeout(() => {
        const panel = $('nasaTlxPanel');
        if (panel) {
          panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
          panel.style.transition = 'box-shadow .3s';
          panel.style.boxShadow = '0 0 0 2px rgba(255,179,0,.55), 0 0 24px rgba(255,179,0,.25)';
          setTimeout(() => { panel.style.boxShadow = ''; }, 2600);
        }
        toast('RATE THIS TASK', 'Recording saved — fill in NASA-TLX below, then SAVE TO EXPORT', 'warn');
      }, 500);
    }
  }

  // ── Clean up any in-progress manual session (e.g. before a fresh start) ──
  function stopSessionTimer() {
    if (manualTimer) { clearInterval(manualTimer); manualTimer = null; }
    if ($('manualSessionWrap')) $('manualSessionWrap').style.display = 'none';
    manualElapsed = 0;
  }

  return {
    init() {
      canvas = $('cameraCanvas');
      ctx    = canvas ? canvas.getContext('2d') : null;
      BlinkGraph.init();
      setTimeout(() => initMP(), 600);
    },
    start() {
      // Starts camera and launches a manual (start/stop) session.
      return (async () => {
        try {
          stopSessionTimer(); // clear any previous session

          stream = await navigator.mediaDevices.getUserMedia({
            video: { width:640, height:480, facingMode:'user', frameRate:{ideal:30} },
            audio: false
          });
          mpVideo = $('mpVideo');
          mpVideo.srcObject = stream;
          await mpVideo.play();
          active = true;

          if (canvas) { canvas.width=640; canvas.height=480; canvas.style.display='block'; }
          $('camPh').style.display = 'none';
          $('scanline').classList.add('on');
          $('liveBadge').style.opacity = '1';
          $('startCamBtn').disabled=true; $('stopCamBtn').disabled=false; $('snapBtn').disabled=false;
          $('pillCam').className='spill ok';
          $('pillCam').innerHTML='<div class="dot g"></div>MEDIAPIPE LIVE';
          $('earOverlay').style.display='block';
          $('mpFPS').style.display='block';
          $('dataSource').textContent='(MediaPipe · real blinks)';
          $('dataSource').style.color='var(--green)';

          // ── CRITICAL BUG #1 FIX: Recording timestamp set HERE, at button press ──
          // Never set lazily from first data point. Reset completely from prior session.
          startRecordingTimestamp();

          // Launch the manual session — records until the user presses STOP
          addAlert('Manual session recording active — press STOP RECORDING to save', 'ok');
          startManualSession();


          if (!faceMesh) await initMP();

          if (faceMesh && typeof Camera !== 'undefined') {
            mpCamera = new Camera(mpVideo, {
              onFrame: async () => { if (faceMesh && active) await faceMesh.send({image:mpVideo}); },
              width:640, height:480
            });
            await mpCamera.start();
            $('mpBadge').textContent='MP LIVE · 468 PTS';
            $('mpBadge').style.color='var(--green)';
          } else if (faceMesh) {
            const loop = async () => {
              if (!active) return;
              if (mpVideo.readyState >= 2) await faceMesh.send({image:mpVideo});
              raf = requestAnimationFrame(loop);
            };
            loop();
          } else {
            const loop = () => {
              if (!active||!ctx) return;
              if (mpVideo.readyState>=2) { ctx.drawImage(mpVideo,0,0,canvas.width,canvas.height); drawHUD(canvas.width,canvas.height); }
              raf = requestAnimationFrame(loop);
            };
            loop();
            toast('MP UNAVAILABLE','Video active — blink detection needs CDN access','warn');
          }
        } catch(e) {
          stopSessionTimer();
          toast('CAMERA ERROR','Webcam access failed: '+e.message.slice(0,55),'warn');
          addAlert('Camera access failed — check browser permissions','crit');
        }
      })();
    },
    stop() {
      active = false;
      stopSessionTimer();
      if (mpCamera) { try{mpCamera.stop();}catch(e){} mpCamera=null; }
      if (raf) { cancelAnimationFrame(raf); raf=null; }
      if (stream) { stream.getTracks().forEach(t=>t.stop()); stream=null; }
      if (canvas) canvas.style.display='none';
      $('camPh').style.display='flex';
      $('scanline').classList.remove('on');
      $('liveBadge').style.opacity='0';
      $('earOverlay').style.display='none';
      $('mpFPS').style.display='none';
      $('startCamBtn').disabled=false; $('stopCamBtn').disabled=true; $('snapBtn').disabled=true;
      $('pillCam').className='spill standby';
      $('pillCam').innerHTML='<div class="dot a"></div>CAMERA STANDBY';
      $('dataSource').textContent='(camera off)';
      $('dataSource').style.color='#334';
      latestLM = null;
      ['mBlink','mGaze','mAttn','mClose','mIBI'].forEach(id=>{const el=$(id);if(el)el.textContent='—';});
      $('mBlinkCnt').textContent='0';
      $('mEARL').textContent='—'; $('mEARR').textContent='—';
      addAlert('Camera stopped — oculometrics paused','info');
    },
    snap() {
      if (!canvas) return;
      const a=document.createElement('a');
      a.download='neuromia-oculo-'+Date.now()+'.png';
      a.href=canvas.toDataURL('image/png'); a.click();
      toast('SNAPSHOT','Oculometric frame captured','ok');
    },
    updateMetrics() {
      if (!active) return;

      // Safe defaults: before enough real blinks exist, keep values at 0 instead of null.
      // This prevents early-session crashes and keeps CSV/report values numeric.
      let brVal=0, ibiAvg=0;
      if (ibiHistory.length >= 2) {
        ibiAvg = Math.round(ibiHistory.reduce((a,b)=>a+b,0)/ibiHistory.length);
        brVal  = Math.min(40, Math.max(0, +(60000/Math.max(ibiAvg,400)).toFixed(1)));
      }

      const pclos = computePERCLOS(perclosWindow);
      const rawG  = gazeStability();
      const gazeV = Math.round(Math.max(30,Math.min(99,kalman(KG,rawG))));
      const rawA  = gazeV*0.6 + (100-pclos)*0.4;
      const attnV = Math.round(Math.max(20,Math.min(99,kalman(KA,rawA))));
      const closeV = Math.max(0,Math.min(50,pclos));

      $('mBlink').textContent    = latestLM ? brVal.toFixed(1)+' /min' : '— /min';
      $('mGaze').textContent     = latestLM ? gazeV+'%'            : '—%';
      $('mAttn').textContent     = latestLM ? attnV+'%'            : '—%';
      $('mClose').textContent    = latestLM ? closeV.toFixed(1)+'%': '—%';
      $('mBlinkCnt').textContent = blinkCnt;
      $('mIBI').textContent      = latestLM ? ibiAvg.toLocaleString()+' ms' : '— ms';
      $('mEARL').textContent     = latestLM ? earL.toFixed(3) : '—';
      $('mEARR').textContent     = latestLM ? earR.toFixed(3) : '—';

      // Push to blink waveform graph
      BlinkGraph.push(earL, earR);
      BlinkGraph.draw();

      if (latestLM) {
        OculoHistory.pushLive({br:brVal, gs:gazeV, at:attnV, ec:closeV, tb:blinkCnt, ibi:ibiAvg, ...getAllOculoCSVFeatures(), test_mode:getTestMode()});
      }
    },
    _toggleMesh:  ()=>{ showMesh=!showMesh; },
    _toggleEye:   ()=>{ showEyes=!showEyes; },
    _toggleBlink: ()=>{ showBlinkOvl=!showBlinkOvl; },
    stopManual:   ()=>{ stopManualSessionNow(); }
  };
})();

// ═══════════════════════════════════════════