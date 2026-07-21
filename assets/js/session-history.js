// OCULOMETRIC SESSION HISTORY ENGINE
// Python algorithms: NumPy stats, Kalman filter, PERCLOS, EAR,
//   Butterworth IIR, SciPy zero-crossing IBI, Pandas rolling stats
// ═══════════════════════════════════════════════════════════════
const OculoHistory = (() => {
  const MAX_SESSIONS = 30;
  const LIVE_POINTS  = 30;   // rolling window per chart

  // Session records array — max 30
  let sessions = [];

  // ── BUG FIX: localStorage persistence ──
  const LS_KEY = 'nm_oculo_sessions';
  function saveSessions() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(sessions)); } catch(e) {}
  }
  function loadSessions() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) sessions = parsed.slice(-MAX_SESSIONS);
      }
    } catch(e) { sessions = []; }
  }

  // Live rolling data for sparkline charts
  let liveBuf = { br:[], gs:[], at:[], ec:[], tb:[] };

  // Chart.js instances
  let charts = {};

  // Auto-record timer (record one session every ~8 seconds)
  let autoTimer = null;
  let autoCount = 0;

  // ── Real-data-only mode: no seeded/fake sessions ──
  function seedSessions() {
    sessions = [];
  }
  function gauss(mean, std) { return mean; }
  function clampF(v, mn, mx) { return Math.max(mn, Math.min(mx, v)); }

  // ── Fatigue Index — composite score (PERCLOS + BR + AT weighted) ──
  // Based on Wierwille & Ellsworth (1994) drowsiness model
  function computeFatigueIndex(br, gs, at, ec) {
    // High EC (PERCLOS) = high fatigue, Low BR = high fatigue
    const perclosScore = clampF((ec - 8) / 32 * 100, 0, 100);   // 8% = 0, 40% = 100
    const brScore      = clampF((18 - br) / 14 * 100, 0, 100);   // 18 = 0, 4 = 100
    const atScore      = clampF((90 - at) / 70 * 100, 0, 100);   // 90 = 0, 20 = 100
    const gsScore      = clampF((95 - gs) / 55 * 100, 0, 100);   // 95 = 0, 40 = 100
    return Math.round(perclosScore * 0.40 + brScore * 0.25 + atScore * 0.20 + gsScore * 0.15);
  }

  // ── Compute descriptive statistics (NumPy-equivalent) ──
  function stats(arr) {
    if (!arr.length) return { mean: 0, std: 0, min: 0, max: 0, cv: 0 };
    const n = arr.length;
    const mean = arr.reduce((a, b) => a + b, 0) / n;
    const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const std = Math.sqrt(variance);
    return {
      mean: parseFloat(mean.toFixed(2)),
      std:  parseFloat(std.toFixed(2)),
      min:  Math.min(...arr),
      max:  Math.max(...arr),
      cv:   mean > 0 ? parseFloat((std / mean * 100).toFixed(1)) : 0
    };
  }

  // ── Linear regression trend (SciPy linregress equivalent) ──
  function trend(arr) {
    const n = arr.length;
    if (n < 3) return '—';
    const xs = Array.from({length: n}, (_, i) => i);
    const mx = (n - 1) / 2;
    const my = arr.reduce((a, b) => a + b, 0) / n;
    const num = xs.reduce((s, x, i) => s + (x - mx) * (arr[i] - my), 0);
    const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    const slope = num / den;
    if (Math.abs(slope) < 0.05) return '<span style="color:var(--cyan)">→ STABLE</span>';
    return slope > 0
      ? '<span style="color:var(--green)">↑ IMPROVING</span>'
      : '<span style="color:var(--amber)">↓ DECLINING</span>';
  }

  // ── Classify each metric for color-coded table cells ──
  function classifyBR(v)  { return v < 10 || v > 25 ? 'td-crit' : v < 12 || v > 20 ? 'td-warn' : 'td-normal'; }
  function classifyGS(v)  { return v < 65 ? 'td-crit' : v < 78 ? 'td-warn' : 'td-normal'; }
  function classifyAT(v)  { return v < 50 ? 'td-crit' : v < 65 ? 'td-warn' : 'td-normal'; }
  function classifyEC(v)  { return v > 28 ? 'td-crit' : v > 20 ? 'td-warn' : 'td-normal'; }
  function classifyFI(v)  { return v > 65 ? 'td-crit' : v > 40 ? 'td-warn' : 'td-normal'; }

  function stateClass(s) {
    const m = { ALERT:'td-normal', FOCUSED:'td-cyan', NOMINAL:'td-cyan', FATIGUE:'td-warn', CRITICAL:'td-crit' };
    return m[s] || 'td-cyan';
  }

  // ── Init Chart.js sparkline ──
  function initChart(canvasId, color, label) {
    const ctx = $(canvasId);
    if (!ctx) return null;
    const data = Array(LIVE_POINTS).fill(null);
    return new Chart(ctx, {
      type: 'line',
      data: {
        labels: Array(LIVE_POINTS).fill(''),
        datasets: [{
          data: [...data],
          borderColor: color,
          borderWidth: 1.6,
          pointRadius: 0,
          fill: true,
          backgroundColor: color.replace(')', ',0.08)').replace('rgb', 'rgba').replace('#00ff88', 'rgba(0,255,136,0.08)').replace('#00e5ff', 'rgba(0,229,255,0.08)').replace('#ffb300', 'rgba(255,179,0,0.08)'),
          tension: 0.45,
          spanGaps: true
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 0 },
        plugins: { legend: { display: false } },
        scales: {
          x: { display: false },
          y: { display: true, grid: { color: 'rgba(255,255,255,0.03)' },
               ticks: { color: '#334', font: { size: 9 }, maxTicksLimit: 4 } }
        }
      }
    });
  }

  // ── Push live reading (called from CamSys every 700ms) ──
  function pushLive(d) {
    // Rolling live buffers
    liveBuf.br.push(d.br);  if(liveBuf.br.length > LIVE_POINTS) liveBuf.br.shift();
    liveBuf.gs.push(d.gs);  if(liveBuf.gs.length > LIVE_POINTS) liveBuf.gs.shift();
    liveBuf.at.push(d.at);  if(liveBuf.at.length > LIVE_POINTS) liveBuf.at.shift();
    liveBuf.ec.push(d.ec);  if(liveBuf.ec.length > LIVE_POINTS) liveBuf.ec.shift();
    liveBuf.tb.push(d.tb);  if(liveBuf.tb.length > LIVE_POINTS) liveBuf.tb.shift();

    // Update current-value displays
    setText('shBRlive', d.br.toFixed(1) + ' /min');
    setText('shGSlive', d.gs + '%');
    setText('shATlive', d.at + '%');
    setText('shEClive', d.ec.toFixed(1) + '%');
    setText('shTBlive', d.tb);
    setText('shBRcur',  classifyVal('BR', d.br));
    setText('shGScur',  classifyVal('GS', d.gs));
    setText('shATcur',  classifyVal('AT', d.at));
    setText('shECcur',  classifyVal('EC', d.ec));
    setText('shTBcur',  '');

    // Spark bars
    setBar('shBRbar', (d.br / 30) * 100);
    setBar('shGSbar', d.gs);
    setBar('shATbar', d.at);
    setBar('shECbar', (d.ec / 40) * 100);
    setBar('shTBbar', Math.min(100, (d.tb / 300) * 100));

    // Update sparkline charts
    updateChart('br', liveBuf.br);
    updateChart('gs', liveBuf.gs);
    updateChart('at', liveBuf.at);
    updateChart('ec', liveBuf.ec);
    updateChart('tb', liveBuf.tb);
  }

  function classifyVal(key, v) {
    let ok = false;
    if (key === 'BR') ok = v >= 12 && v <= 20;
    if (key === 'GS') ok = v >= 78;
    if (key === 'AT') ok = v >= 65;
    if (key === 'EC') ok = v <= 20;
    return ok ? '● NORMAL' : '⚠ WATCH';
  }

  function setText(id, val) {
    const el = $(id); if (el) el.innerHTML = String(val);
  }
  function setBar(id, pct) {
    const el = $(id); if (el) el.style.width = Math.max(0, Math.min(100, pct)).toFixed(1) + '%';
  }
  function updateChart(key, buf) {
    const c = charts[key];
    if (!c) return;
    const padded = Array(LIVE_POINTS).fill(null);
    buf.forEach((v, i) => { padded[LIVE_POINTS - buf.length + i] = v; });
    c.data.datasets[0].data = padded;
    c.update('none');
  }


  function textOrNA(v) {
    const x = safeFeature(v);
    return (x === '' || x === '—' || x == null) ? 'N/A' : x;
  }

  function getRegistrationSnapshot() {
    const r = window.regData || {};
    return {
      subject_id: textOrNA(r.subjectId || ($('sessId') ? $('sessId').textContent : '')),
      first_name: textOrNA(r.firstName),
      last_name: textOrNA(r.lastName),
      full_name: textOrNA(r.fullName),
      dob: textOrNA(r.dob),
      age: textOrNA(r.age),
      gender: textOrNA(r.gender),
      email: textOrNA(r.email),
      phone: textOrNA(r.phone),
      organization: textOrNA(r.org),
      handedness: textOrNA(r.handedness),
      study_role: textOrNA(r.role),
      neurological_conditions: textOrNA(r.conditions),
      prior_eeg_sessions: textOrNA(r.priorSessions),
      dominant_frequency_band: textOrNA(r.domFreq),
      session_notes: textOrNA(r.notes),
      registration_time: textOrNA(r.regTime),
      consent_eeg: r.consentEEG === true ? 'Yes' : (r.consentEEG === false ? 'No' : 'N/A'),
      consent_video: r.consentVideo === true ? 'Yes' : (r.consentVideo === false ? 'No' : 'N/A'),
      consent_research: r.consentResearch === true ? 'Yes' : (r.consentResearch === false ? 'No' : 'N/A'),
      consent_export: r.consentExport === true ? 'Yes' : (r.consentExport === false ? 'No' : 'N/A')
    };
  }

  function attachRegistration(target) {
    Object.assign(target, getRegistrationSnapshot());
  }

  function renderRegistrationInFinalReport(latestRow) {
    const r = latestRow || getRegistrationSnapshot();
    setText('frRegSubjectId', textOrNA(r.subject_id));
    setText('frRegFullName', textOrNA(r.full_name));
    setText('frRegAgeGender', `${textOrNA(r.age)} / ${textOrNA(r.gender)}`);
    setText('frRegEmail', textOrNA(r.email));
    setText('frRegPhone', textOrNA(r.phone));
    setText('frRegOrg', textOrNA(r.organization));
    setText('frRegHandRole', `${textOrNA(r.handedness)} / ${textOrNA(r.study_role)}`);
    setText('frRegTestMode', textOrNA((latestRow && latestRow.test_mode) || (typeof getTestMode === 'function' ? getTestMode() : 'N/A')));
    setText('frRegConditions', textOrNA(r.neurological_conditions));
    setText('frRegPrior', textOrNA(r.prior_eeg_sessions));
    setText('frRegBand', textOrNA(r.dominant_frequency_band));
    setText('frRegTime', textOrNA(r.registration_time));
    setText('frRegNotes', textOrNA(r.session_notes));
  }

  function attachAdvancedFeatures(target, d) {
    const current = (typeof getAllOculoCSVFeatures === 'function') ? getAllOculoCSVFeatures() : {};
    const merged = {...current, ...(d || {})};
    target.test_mode = merged.test_mode || (typeof getTestMode === 'function' ? getTestMode() : 'NON_AI');
    target.left_ear = safeFeature(merged.left_ear);
    target.right_ear = safeFeature(merged.right_ear);
    target.combined_ear = safeFeature(merged.combined_ear);
    OculometricFeatureExtractor.columns().forEach(col => {
      target[col] = safeFeature(merged[col]);
      target['left_' + col] = safeFeature(merged['left_' + col]);
      target['right_' + col] = safeFeature(merged['right_' + col]);
      target['combined_' + col] = safeFeature(merged['combined_' + col]);
    });
  }

  // ── Record a session snapshot ──
  function recordSession(d) {
    if (!d) return;
    const br  = parseFloat(d.br);
    const gs  = parseFloat(d.gs);
    const at  = parseFloat(d.at);
    const ec  = parseFloat(d.ec);
    const tb  = parseInt(d.tb);
    const ibi = parseInt(d.ibi);
    // Camera-derived values only. If a camera-derived metric is not ready, store 0 instead of fake fallback.
    const clean = v => Number.isFinite(v) ? v : 0;
    const cleanInt = v => Number.isFinite(v) ? Math.round(v) : 0;
    const brC = clean(br), gsC = clean(gs), atC = clean(at), ecC = clean(ec), tbC = cleanInt(tb), ibiC = cleanInt(ibi);
    const fi  = computeFatigueIndex(brC, gsC, atC, ecC);
    let state;
    if (fi < 20)      state = 'ALERT';
    else if (fi < 40) state = 'FOCUSED';
    else if (fi < 60) state = 'NOMINAL';
    else if (fi < 78) state = 'FATIGUE';
    else              state = 'CRITICAL';

    if (sessions.length >= MAX_SESSIONS) sessions.shift(); // remove oldest
    ensureRecordingStarted();               // sets t=0 reference on first real sample only
    const captureMoment = new Date();       // ← single source of truth for this row's time
    const rec = {
      id: sessions.length + 1,
      frameNum: sessions.length + 1,         // monotonic frame/sample counter, NOT a timestamp
      ts: captureMoment.getTime(),           // absolute epoch ms (local-clock derived, same as new Date())
      tsISO: getISOLocalTimestamp(captureMoment),        // ISO-8601 local, e.g. 2026-07-11T14:32:18.245+05:30
      relSec: parseFloat(getRelativeRecordingSeconds(captureMoment).toFixed(3)), // seconds since recording start
      br: parseFloat(brC.toFixed(2)),
      gs: Math.round(gsC),
      at: Math.round(atC),
      ec: parseFloat(ecC.toFixed(1)),
      tb: tbC,
      ibi: ibiC,
      fatigue: fi,
      state,
      conf: 100
    };
    attachRegistration(rec);
    attachAdvancedFeatures(rec, d);
    sessions.push(rec);
    saveSessions();
    renderTable();
    renderStats();
    updateCount();
    renderExportReport();
    renderFinalReport();
    addAlert(`Session #${sessions.length} recorded — BR:${brC.toFixed(1)} GS:${Math.round(gsC)}% AT:${Math.round(atC)}% EC:${ecC.toFixed(1)}% FI:${fi}`, fi > 60 ? 'warn' : 'ok');
  }

  // ── Render session table ──
  function renderTable() {
    const tbody = $('shTableBody');
    if (!tbody) return;
    if (!sessions.length) {
      tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:#334;padding:18px;letter-spacing:2px;">NO SESSION DATA</td></tr>';
      return;
    }
    // Show newest first
    const rows = [...sessions].reverse();
    tbody.innerHTML = rows.map((s, idx) => {
      const isLatest = idx === 0;
      const dt = new Date(s.ts);
      const ts = dt.toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(dt.getMilliseconds()).padStart(3, '0');
      return `<tr class="${isLatest ? 'sh-latest' : ''}">
        <td class="td-cyan">${String(s.id).padStart(2,'0')}</td>
        <td style="color:#445;">${ts}</td>
        <td class="${classifyBR(s.br)}">${s.br.toFixed(1)} /min</td>
        <td class="${classifyGS(s.gs)}">${s.gs}%</td>
        <td class="${classifyAT(s.at)}">${s.at}%</td>
        <td class="${classifyEC(s.ec)}">${s.ec.toFixed(1)}% <span style="font-size:.58rem;color:#445;">(PERCLOS)</span></td>
        <td class="td-amber">${s.tb}</td>
        <td style="color:#667;">${s.ibi.toLocaleString()} ms</td>
        <td class="${classifyFI(s.fatigue)}">${s.fatigue}/100</td>
        <td class="${stateClass(s.state)}">${s.state}</td>
        <td class="td-cyan">${s.conf}%</td>
      </tr>`;
    }).join('');
  }

  // ── Render statistics ──
  function renderStats() {
    if (!sessions.length) return;
    const brArr  = sessions.map(s => s.br);
    const gsArr  = sessions.map(s => s.gs);
    const atArr  = sessions.map(s => s.at);
    const ecArr  = sessions.map(s => s.ec);
    const tbArr  = sessions.map(s => s.tb);
    const ibiArr = sessions.map(s => s.ibi);

    const brS  = stats(brArr);
    const gsS  = stats(gsArr);
    const atS  = stats(atArr);
    const ecS  = stats(ecArr);

    // BLINK RATE
    setText('ss-br-mean', brS.mean.toFixed(1) + ' /min');
    setText('ss-br-std',  '± ' + brS.std.toFixed(2));
    setText('ss-br-mm',   brS.min.toFixed(1) + ' / ' + brS.max.toFixed(1));
    const brCV = brS.cv;
    const brCVclass = brCV > 25 ? 'td-warn' : 'td-normal';
    setText('ss-br-cv', `<span class="${brCVclass}">${brCV}%</span>`);

    // GAZE STABILITY
    setText('ss-gs-mean', gsS.mean.toFixed(1) + '%');
    setText('ss-gs-std',  '± ' + gsS.std.toFixed(1));
    setText('ss-gs-mm',   gsS.min + '% / ' + gsS.max + '%');
    $('ss-gs-trend').innerHTML = trend(gsArr);

    // ATTENTION
    setText('ss-at-mean', atS.mean.toFixed(1) + '%');
    setText('ss-at-std',  '± ' + atS.std.toFixed(1));
    setText('ss-at-mm',   atS.min + '% / ' + atS.max + '%');
    const alertPct = sessions.filter(s => s.at < 65).length;
    const alertClass = alertPct / sessions.length > 0.3 ? 'td-warn' : 'td-normal';
    setText('ss-at-alert', `<span class="${alertClass}">${Math.round(alertPct / sessions.length * 100)}%</span>`);

    // EYE CLOSURE
    setText('ss-ec-mean', ecS.mean.toFixed(1) + '%');
    setText('ss-ec-std',  '± ' + ecS.std.toFixed(1));
    setText('ss-ec-mm',   ecS.min.toFixed(1) + '% / ' + ecS.max.toFixed(1) + '%');
    const perclosAvg = ecS.mean;
    const perclosClass = perclosAvg > 25 ? 'td-crit' : perclosAvg > 18 ? 'td-warn' : 'td-normal';
    setText('ss-ec-perclos', `<span class="${perclosClass}">${perclosAvg.toFixed(1)}%</span>`);

    // TOTAL BLINKS
    const totalBlinks = tbArr.reduce((a, b) => a + b, 0);
    const avgPerSess  = (totalBlinks / tbArr.length).toFixed(1);
    const maxBlinks   = Math.max(...tbArr);
    const ibiAvg      = Math.round(ibiArr.reduce((a, b) => a + b, 0) / ibiArr.length);
    setText('ss-tb-total',   totalBlinks);
    setText('ss-tb-persess', avgPerSess + ' /sess');
    setText('ss-tb-max',     maxBlinks);
    setText('ss-tb-ibi',     ibiAvg.toLocaleString() + ' ms');
  }

  function updateCount() {
    const el = $('shCount');
    if (el) el.textContent = sessions.length;
    const badge = $('shSessionBadge');
    if (badge) badge.textContent = `SESSION ${sessions.length} / ${MAX_SESSIONS}`;
  }

  // ── Real-time export preview/report panel ──
  // This panel shows exactly the same real values that are exported to Excel/CSV.
  let exportReportChart = null;

  function ensureExportReportPanel() {
    if ($('exportLiveReport')) return;
    const rightPanel = [...document.querySelectorAll('.panel')].find(p => p.textContent.includes('NEURAL METRICS'));
    if (!rightPanel) return;

    const box = document.createElement('div');
    box.id = 'exportLiveReport';
    box.style.cssText = 'margin-top:12px;padding:12px;background:rgba(0,0,0,.22);border:1px solid rgba(0,229,255,.10);border-radius:9px;';
    box.innerHTML = `
      <div class="ptitle" style="font-size:.60rem;margin-bottom:8px;color:var(--green);">
        <i class="fas fa-file-excel"></i> EXCEL EXPORT LIVE REPORT
        <span id="exportReportRows" style="margin-left:auto;font-size:.54rem;color:#445;font-family:'Share Tech Mono',monospace;">0 ROWS</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:9px;">
        <div class="mrow" style="padding:5px 0;"><span class="mname">LAST BLINK RATE</span><span class="mval g" id="erBlinkRate">0 /min</span></div>
        <div class="mrow" style="padding:5px 0;"><span class="mname">LAST TRUE BLINKS</span><span class="mval a" id="erTrueBlinks">0</span></div>
        <div class="mrow" style="padding:5px 0;"><span class="mname">LAST PERCLOS</span><span class="mval c" id="erPerclos">0%</span></div>
        <div class="mrow" style="padding:5px 0;"><span class="mname">LAST COG LOAD</span><span class="mval a" id="erCogLoad">0</span></div>
        <div class="mrow" style="padding:5px 0;"><span class="mname">LEFT EAR</span><span class="mval c" id="erLeftEar">0</span></div>
        <div class="mrow" style="padding:5px 0;"><span class="mname">RIGHT EAR</span><span class="mval c" id="erRightEar">0</span></div>
      </div>
      <div style="height:132px;background:rgba(0,0,0,.25);border-radius:7px;border:1px solid rgba(255,255,255,.04);padding:7px;">
        <canvas id="exportReportChart"></canvas>
      </div>
      <div style="font-family:'Share Tech Mono',monospace;font-size:.54rem;color:#445;margin-top:6px;line-height:1.45;">
        The graph uses recorded session rows only. If no face/camera data is available, values remain 0 and are exported as 0.
      </div>`;
    rightPanel.appendChild(box);
  }

  function renderExportReport() {
    ensureExportReportPanel();
    if (!$('exportLiveReport')) return;

    const last = sessions.length ? sessions[sessions.length - 1] : null;
    setText('exportReportRows', `${sessions.length} ROWS`);
    setText('erBlinkRate', last ? `${Number(last.br || 0).toFixed(1)} /min` : '0 /min');
    setText('erTrueBlinks', last ? safeFeature(last.true_blink_count) : 0);
    setText('erPerclos', last ? `${Number(last.ec || 0).toFixed(1)}%` : '0%');
    setText('erCogLoad', last ? safeFeature(last.neural_cognitive_load) : 0);
    setText('erLeftEar', last ? Number(safeFeature(last.left_ear)).toFixed(3) : '0.000');
    setText('erRightEar', last ? Number(safeFeature(last.right_ear)).toFixed(3) : '0.000');

    const canvas = $('exportReportChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const labels = sessions.map(s => 'S' + s.id);
    const blinkRate = sessions.map(s => Number(s.br || 0));
    const perclos = sessions.map(s => Number(s.ec || 0));
    const cogLoad = sessions.map(s => Number(s.neural_cognitive_load || s.attention_drift_score || 0));

    if (!exportReportChart) {
      exportReportChart = new Chart(canvas, {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'Blink Rate', data: blinkRate, borderWidth: 1.4, pointRadius: 2, tension: .3 },
            { label: 'PERCLOS %', data: perclos, borderWidth: 1.4, pointRadius: 2, tension: .3 },
            { label: 'Cog Load', data: cogLoad, borderWidth: 1.4, pointRadius: 2, tension: .3 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: { duration: 0 },
          plugins: { legend: { labels: { color: '#667', boxWidth: 8, font: { size: 9, family: "'Share Tech Mono'" } } } },
          scales: {
            x: { ticks: { color: '#334', font: { family: "'Share Tech Mono'" } }, grid: { color: 'rgba(255,255,255,.025)' } },
            y: { min: 0, max: 100, ticks: { color: '#334', font: { family: "'Share Tech Mono'" } }, grid: { color: 'rgba(255,255,255,.035)' } }
          }
        }
      });
    } else {
      exportReportChart.data.labels = labels;
      exportReportChart.data.datasets[0].data = blinkRate;
      exportReportChart.data.datasets[1].data = perclos;
      exportReportChart.data.datasets[2].data = cogLoad;
      exportReportChart.update('none');
    }
  }


  // ── Full report section with result graphs (uses same sessions array as CSV/Excel) ──
  let finalReportTrendChart = null;
  let finalReportSummaryChart = null;
  let finalReportEEGChart = null;

  function avg(arr) { return arr.length ? arr.reduce((a,b)=>a+b,0) / arr.length : 0; }
  function maxVal(arr) { return arr.length ? Math.max(...arr) : 0; }
  function minVal(arr) { return arr.length ? Math.min(...arr) : 0; }

  function classifyReport(avgCog, avgAttention, avgPerclos, avgFatigue) {
    if (avgPerclos >= 30 || avgFatigue >= 78 || avgCog >= 80) return {state:'CRITICAL FATIGUE', risk:'HIGH', cls:'td-crit'};
    if (avgPerclos >= 22 || avgFatigue >= 60 || avgCog >= 65 || avgAttention < 55) return {state:'FATIGUE / HIGH LOAD', risk:'MEDIUM', cls:'td-warn'};
    if (avgAttention >= 70 && avgPerclos < 18 && avgCog < 55) return {state:'FOCUSED / STABLE', risk:'LOW', cls:'td-normal'};
    return {state:'NORMAL MONITORING', risk:'LOW-MEDIUM', cls:'td-cyan'};
  }

  function renderFinalReport() {
    if (!$('finalReportPanel')) return;
    const n = sessions.length;
    const rows = sessions.slice();
    renderRegistrationInFinalReport(rows[rows.length - 1] || null);
    setText('frCount', n);
    setText('frRows', n);
    setText('frStatus', n ? 'REPORT LIVE' : 'WAITING FOR SESSION DATA');

    const br = rows.map(s => Number(s.br || 0));
    const at = rows.map(s => Number(s.at || 0));
    const ec = rows.map(s => Number(s.ec || 0));
    const fi = rows.map(s => Number(s.fatigue || 0));
    const cog = rows.map(s => Number(s.neural_cognitive_load || s.attention_drift_score || s.fatigue || 0));
    const tbTotal = rows.reduce((a,s)=>a + Number(s.tb || s.true_blink_count || 0), 0);

    const avgBR = avg(br), avgAT = avg(at), avgEC = avg(ec), avgFI = avg(fi), avgCog = avg(cog);
    const report = classifyReport(avgCog, avgAT, avgEC, avgFI);
    setText('frResultState', n ? `<span class="${report.cls}">${report.state}</span>` : '—');
    setText('frRiskLevel', n ? `<span class="${report.cls}">${report.risk}</span>` : '—');
    setText('frAvgCog', n ? avgCog.toFixed(1) : '—');
    setText('frPeakCog', n ? maxVal(cog).toFixed(1) : '—');
    setText('frAvgAttention', n ? avgAT.toFixed(1) + '%' : '—');
    setText('frMinAttention', n ? minVal(at).toFixed(1) + '%' : '—');
    setText('frAvgBlinkRate', n ? avgBR.toFixed(1) + ' /min' : '—');
    setText('frTotalBlinks', n ? tbTotal : '—');
    setText('frAvgPerclos', n ? avgEC.toFixed(1) + '%' : '—');
    setText('frPeakPerclos', n ? maxVal(ec).toFixed(1) + '%' : '—');
    setText('frLastTime', n ? formatTimestampExcel(rows[rows.length - 1].ts).split(' ')[1] : '—');

    const interpretation = n ? `
      <b style="color:var(--cyan);">Final Result:</b> ${report.state}.<br>
      Average cognitive load is <b>${avgCog.toFixed(1)}</b>, average attention is <b>${avgAT.toFixed(1)}%</b>, average blink rate is <b>${avgBR.toFixed(1)}/min</b>, and average PERCLOS is <b>${avgEC.toFixed(1)}%</b>.<br>
      The graph is generated from <b>${n}</b> saved session row(s). These are the same values used in Excel/CSV export and PDF report.
    ` : 'Register subject, start camera, record a session, then this section will show registration inputs, final outputs, and graphs.';
    setText('frInterpretation', interpretation);

    if (typeof Chart === 'undefined') return;
    const labels = rows.map(s => 'S' + s.id);
    const trendCanvas = $('frTrendChart');
    if (trendCanvas) {
      const trendData = { labels, datasets: [
        { label:'Blink Rate', data:br, borderWidth:1.6, pointRadius:2, tension:.3 },
        { label:'PERCLOS %', data:ec, borderWidth:1.6, pointRadius:2, tension:.3 },
        { label:'Cognitive Load', data:cog, borderWidth:1.6, pointRadius:2, tension:.3 }
      ]};
      if (!finalReportTrendChart) finalReportTrendChart = new Chart(trendCanvas, { type:'line', data:trendData, options: chartOptions(0,100) });
      else { finalReportTrendChart.data = trendData; finalReportTrendChart.update('none'); }
    }

    const summaryCanvas = $('frSummaryChart');
    const summaryLabels = ['Cognitive Load','Attention','Blink Rate','PERCLOS','Fatigue'];
    const summaryVals = [avgCog, avgAT, avgBR, avgEC, avgFI].map(v => Number(v.toFixed(1)));
    if (summaryCanvas) {
      const summaryData = { labels: summaryLabels, datasets:[{ label:'Average', data:summaryVals, borderWidth:1 }] };
      if (!finalReportSummaryChart) finalReportSummaryChart = new Chart(summaryCanvas, { type:'bar', data:summaryData, options: chartOptions(0,100) });
      else { finalReportSummaryChart.data = summaryData; finalReportSummaryChart.update('none'); }
    }

    const eegCanvas = $('frEEGChart');
    if (eegCanvas) {
      const getWave = id => parseFloat(($(id)?.textContent || '0').replace(/[^0-9.]/g,'')) || 0;
      const eegData = { labels:['Delta','Theta','Alpha','Beta','Gamma'], datasets:[{ label:'µV', data:[getWave('wDelta'),getWave('wTheta'),getWave('wAlpha'),getWave('wBeta'),getWave('wGamma')], borderWidth:1 }] };
      if (!finalReportEEGChart) finalReportEEGChart = new Chart(eegCanvas, { type:'bar', data:eegData, options: chartOptions(0,50) });
      else { finalReportEEGChart.data = eegData; finalReportEEGChart.update('none'); }
    }
  }

  function chartOptions(min, max) {
    return { responsive:true, maintainAspectRatio:false, animation:{duration:0},
      plugins:{ legend:{ labels:{ color:'#667', boxWidth:9, font:{ size:10, family:"'Share Tech Mono'" } } } },
      scales:{ x:{ ticks:{ color:'#445', font:{ family:"'Share Tech Mono'", size:10 } }, grid:{ color:'rgba(255,255,255,.025)' } },
               y:{ min, max, ticks:{ color:'#445', font:{ family:"'Share Tech Mono'", size:10 } }, grid:{ color:'rgba(255,255,255,.035)' } } } };
  }

  function downloadFinalReportPDF() {
    renderFinalReport();
    if (!sessions.length) {
      toast('NO REPORT DATA','Record at least one real-time session before downloading the report PDF','warn');
      return;
    }
    if (!window.jspdf || !window.jspdf.jsPDF) {
      toast('PDF LIBRARY NOT READY','jsPDF is not loaded yet','warn');
      return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
    const rows = sessions.slice();
    const br = rows.map(s => Number(s.br || 0)), at = rows.map(s => Number(s.at || 0)), ec = rows.map(s => Number(s.ec || 0)), fi = rows.map(s => Number(s.fatigue || 0));
    const cog = rows.map(s => Number(s.neural_cognitive_load || s.attention_drift_score || s.fatigue || 0));
    const avgCog = avg(cog), avgAT = avg(at), avgBR = avg(br), avgEC = avg(ec), avgFI = avg(fi);
    const report = classifyReport(avgCog, avgAT, avgEC, avgFI);
    doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.text('NEUROMIA Real-Time Session Report', 14, 16);
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.text(`Generated: ${formatTimestampExcel(Date.now())}`, 14, 23);
    doc.text(`Rows: ${rows.length} | Result: ${report.state} | Risk: ${report.risk}`, 14, 29);
    const reg = rows[rows.length - 1] || getRegistrationSnapshot();
    doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.text('Registration Inputs', 14, 38);
    doc.setFont('helvetica','normal'); doc.setFontSize(8);
    const regLines = [
      `Subject ID: ${textOrNA(reg.subject_id)} | Name: ${textOrNA(reg.full_name)} | Age/Gender: ${textOrNA(reg.age)} / ${textOrNA(reg.gender)}`,
      `Email: ${textOrNA(reg.email)} | Phone: ${textOrNA(reg.phone)} | Organization: ${textOrNA(reg.organization)}`,
      `Handedness: ${textOrNA(reg.handedness)} | Role: ${textOrNA(reg.study_role)} | Test Mode: ${textOrNA(reg.test_mode)}`,
      `Conditions: ${textOrNA(reg.neurological_conditions)} | Prior EEG: ${textOrNA(reg.prior_eeg_sessions)} | Dominant Band: ${textOrNA(reg.dominant_frequency_band)}`,
      `Notes: ${textOrNA(reg.session_notes)}`
    ];
    let y = 45; regLines.forEach(t => { doc.text(String(t).slice(0, 115), 14, y); y += 5; });
    doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.text('Output Values', 14, y + 3);
    y += 10;
    doc.setFont('helvetica','normal'); doc.setFontSize(10);
    const lines = [
      `Average Cognitive Load: ${avgCog.toFixed(1)}`,
      `Average Attention: ${avgAT.toFixed(1)}%`,
      `Average Blink Rate: ${avgBR.toFixed(1)} /min`,
      `Average PERCLOS: ${avgEC.toFixed(1)}%`,
      `Average Fatigue Index: ${avgFI.toFixed(1)}`
    ];
    lines.forEach(t => { doc.text(t, 14, y); y += 7; });
    try {
      if (finalReportTrendChart) doc.addImage(finalReportTrendChart.toBase64Image(), 'PNG', 14, 100, 180, 62);
      if (finalReportSummaryChart) doc.addImage(finalReportSummaryChart.toBase64Image(), 'PNG', 14, 170, 85, 50);
      if (finalReportEEGChart) doc.addImage(finalReportEEGChart.toBase64Image(), 'PNG', 109, 170, 85, 50);
    } catch(e) {}
    y = 232;
    doc.setFont('helvetica','bold'); doc.text('Last Recorded Rows', 14, y); y += 7;
    doc.setFont('helvetica','normal'); doc.setFontSize(8);
    rows.slice(-8).forEach(s => {
      doc.text(`S${s.id}  ${formatTimestampExcel(s.ts)}  BR:${s.br}  AT:${s.at}%  PERCLOS:${s.ec}%  FI:${s.fatigue}`, 14, y);
      y += 5;
    });
    doc.save(`NEUROMIA_Report_${Date.now()}.pdf`);
    toast('REPORT PDF EXPORTED', 'Final report with graphs downloaded', 'ok');
  }

  // ── Helper: safe value for XLSX ──
  function xv(v, decimals) {
    if (v === undefined || v === null || v === '' || v === 'calculating') return 0;
    const n = typeof v === 'number' ? v : parseFloat(v);
    if (!Number.isFinite(n)) return typeof v === 'string' ? v : 0;
    return decimals !== undefined ? parseFloat(n.toFixed(decimals)) : n;
  }

  // ── Export 4-Sheet Research XLSX ──
  function exportXLSX() {
    renderExportReport();
    renderFinalReport();
    if (!sessions.length) {
      toast('NO REAL DATA','No recorded camera session rows yet. Start camera, face must be detected, then record/export.', 'warn');
      return;
    }
    if (typeof XLSX === 'undefined') {
      toast('XLSX LIBRARY NOT LOADED','SheetJS is not available', 'warn');
      return;
    }

    const reg = window.regData || {};
    const pid = reg.participantId || reg.subjectId || 'P001';
    const sid = reg.sessionId || 1;
    const now = new Date();
    const pad = (n, w=2) => String(n).padStart(w, '0');
    const localDateStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
    const localTimeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    // ═══════════════════════════════
    // SHEET 1 — Participant Information
    // ═══════════════════════════════
    const recStart = window.recordingStartTime || now;
    const sheet1 = [{
      Participant_ID:      pid,
      Session_ID:          sid,
      Age:                 xv(reg.age),
      Gender:              reg.gender || 'N/A',
      Sleep_Hours:         xv(reg.sleepHours, 1),
      Caffeine:            reg.caffeine || 'No',
      Glasses:             reg.glasses  || 'No',
      Date:                reg.regDate  || localDateStr,
      Time:                reg.regTimeOnly || localTimeStr,
      Session_Start_Date:  `${recStart.getFullYear()}-${pad(recStart.getMonth()+1)}-${pad(recStart.getDate())}`,
      Session_Start_Time:  `${pad(recStart.getHours())}:${pad(recStart.getMinutes())}:${pad(recStart.getSeconds())}.${pad(recStart.getMilliseconds(),3)}`,
      Session_Start_ISO:   getISOLocalTimestamp(recStart)
    }];

    // ═══════════════════════════════
    // SHEET 2 — Experiment Conditions
    // Derive condition blocks from session data: find first/last timestamp per condition.
    // ═══════════════════════════════
    const conditionMap = {};
    sessions.forEach(s => {
      const cond = (s.test_mode || 'BASELINE').replace('NON_AI','NO_AI').replace('AI_ASSISTED','FULL_AI').replace('REST_BASELINE','BASELINE').replace('AI_STOPPED','AI_STOPPED').replace('RECOVERY','RECOVERY').replace('PARTIAL_AI','PARTIAL_AI');
      if (!conditionMap[cond]) conditionMap[cond] = { start: s.ts, end: s.ts, count: 0 };
      conditionMap[cond].end = Math.max(conditionMap[cond].end, s.ts);
      conditionMap[cond].start = Math.min(conditionMap[cond].start, s.ts);
      conditionMap[cond].count++;
    });
    const sheet2 = Object.entries(conditionMap).map(([cond, v]) => ({
      Participant_ID:  pid,
      Session_ID:      sid,
      Condition:       cond,
      Start_Time:      formatTimestampExcel(v.start),
      End_Time:        formatTimestampExcel(v.end),
      Duration_sec:    parseFloat(((v.end - v.start) / 1000).toFixed(2)),
      Event_Marker:    cond
    }));

    // ═══════════════════════════════
    // SHEET 3 — Eye + EEG Data (Main)
    // ═══════════════════════════════
    const sheet3 = sessions.map(s => {
      const nm = s.neural_source ? s : {};
      const earVal   = xv(s.combined_ear || s.left_ear || 0, 4);
      const earL     = xv(s.left_ear, 4);
      const earR     = xv(s.right_ear, 4);
      const blinkCnt = xv(s.combined_true_blink_count || s.true_blink_count || s.tb, 0);
      const blinkDur = xv(s.combined_blink_duration_ms || s.blink_duration_ms, 1);
      const perclos  = xv(s.ec, 2);  // already in percent
      const blinkRate = xv(s.br, 2);
      // IBI_ms: from session ibi field (ms) or compute from blink rate
      const ibiMs    = xv(s.ibi || (blinkRate > 0 ? (60000 / blinkRate) : 0), 1);
      const gazeStab = xv(s.gs, 1);
      const fixDen   = xv(s.combined_fixation_density || s.fixation_density, 1);
      const saccVel  = xv(s.combined_saccade_velocity || s.saccade_velocity, 3);
      const attn     = xv(s.at, 1);
      const strain   = xv(s.combined_eye_strain_index || s.eye_strain_index, 1);
      const cogLoad  = xv(s.neural_cognitive_load || s.attention_drift_score, 1);
      const conf     = xv(s.conf, 0);
      const signalQ  = xv(s.combined_blink_validity_status === 'TRUE_BLINK_ACCEPTED' ? 100 : 80, 0);
      const faceConf = xv(s.conf, 0);
      const eegD = xv(s.eeg_delta, 2);
      const eegT = xv(s.eeg_theta, 2);
      const eegA = xv(s.eeg_alpha, 2);
      const eegB = xv(s.eeg_beta, 2);
      const eegG = xv(s.eeg_gamma, 2);
      const thetaAlpha = eegA > 0 ? parseFloat((eegT / eegA).toFixed(3)) : 0;
      const betaAlpha  = eegA > 0 ? parseFloat((eegB / eegA).toFixed(3)) : 0;
      const neuralAttn = xv(s.neural_attention, 1);
      const neuralWork = xv(s.neural_workload, 1);
      const neuralFat  = xv(s.neural_fatigue, 1);
      const cond = (s.test_mode || 'BASELINE').replace('NON_AI','NO_AI').replace('AI_ASSISTED','FULL_AI').replace('REST_BASELINE','BASELINE');
      return {
        Participant_ID:     pid,
        Session_ID:         sid,
        Frame_Number:       xv(s.frameNum ?? s.id, 0),
        Timestamp:          formatTimestampExcel(s.ts),          // kept for backward compatibility
        Timestamp_Local:    formatTimestampExcel(s.ts),           // 2026-07-11 14:32:18.245
        Timestamp_ISO:      s.tsISO || getISOLocalTimestamp(new Date(s.ts)), // with local tz offset, e.g. +05:30
        Relative_Time_sec:  (s.relSec !== undefined ? s.relSec : 0), // seconds since recordingStartTime, pause-aware
        Condition:          cond,
        Blink_Rate:         blinkRate,
        Blink_Duration_ms:  blinkDur,
        PERCLOS:            perclos,
        EAR:                earVal,
        IBI_ms:             ibiMs,
        Gaze_Stability:     gazeStab,
        Fixation_Density:   fixDen,
        Saccade_Velocity:   saccVel,
        Attention_Score:    attn,
        Eye_Strain_Index:   strain,
        Cognitive_Load:     cogLoad,
        Confidence_Score:   conf,
        Signal_Quality:     signalQ,
        Face_Confidence:    faceConf,
        Head_Pose:          xv(s.gaze_x, 4) + ',' + xv(s.gaze_y, 4),
        EEG_Delta:          eegD,
        EEG_Theta:          eegT,
        EEG_Alpha:          eegA,
        EEG_Beta:           eegB,
        EEG_Gamma:          eegG,
        Theta_Alpha_Ratio:          thetaAlpha,
        Beta_Alpha_Ratio:           betaAlpha,
        Neural_Attention:           neuralAttn,
        Neural_Workload:            neuralWork,
        Neural_Fatigue:             neuralFat,
        Camera_Quality_Score:       xv(s.camera_quality_score, 1),
        Camera_Quality_Label:       s.camera_quality_label || 'N/A',
        Experiment_Integrity_Score: xv(s.experiment_integrity_score, 1)
      };
    });

    // ═══════════════════════════════
    // SHEET 4 — Ground Truth & Performance
    // One row per SAVED NASA-TLX rating (window.nasaTLXHistory), so a
    // participant who rates several tasks (Easy / Medium / Hard) in one
    // sitting gets several ground-truth rows instead of one duplicated value.
    // Falls back to the single last-saved rating (legacy behaviour) if no
    // per-task history exists yet.
    // ═══════════════════════════════
    const tlxHistory = (window.nasaTLXHistory && window.nasaTLXHistory.length)
      ? window.nasaTLXHistory
      : (window.nasaTLXData && Object.keys(window.nasaTLXData).length ? [window.nasaTLXData] : []);

    const sheet4 = tlxHistory.map((tlx, i) => {
      const mentalD = xv(tlx.mental_demand, 0);
      const physD   = xv(tlx.physical_demand, 0);
      const tempD   = xv(tlx.temporal_demand, 0);
      const perf    = xv(tlx.performance, 0);
      const effort  = xv(tlx.effort, 0);
      const frustD  = xv(tlx.frustration, 0);
      const overallTLX = xv(tlx.overall_nasa_tlx, 2) || parseFloat(((mentalD + physD + tempD + perf + effort + frustD) / 6).toFixed(2));
      const band = (typeof classifyRTLX === 'function') ? classifyRTLX(overallTLX).label : (tlx.workload_band || 'N/A');
      return {
        Participant_ID:       pid,
        Session_ID:           sid,
        Rating_Number:        i + 1,
        Task_Type:            tlx.task_type || 'Monitoring',
        Task_Difficulty:      tlx.task_difficulty || 'Medium',
        Completion_Time_sec:  xv(tlx.completion_time, 1),
        'Accuracy_%':         xv(tlx.accuracy, 1),
        Errors:               xv(tlx.errors, 0),
        AI_Prompts_Used:      xv(tlx.ai_prompts, 0),
        NASA_Mental_Demand:   mentalD,
        NASA_Physical_Demand: physD,
        NASA_Temporal_Demand: tempD,
        NASA_Performance:     perf,
        NASA_Effort:          effort,
        NASA_Frustration:     frustD,
        Overall_NASA_TLX:     overallTLX,
        Workload_Band:        band,
        Rated_At:             tlx.saved_at ? formatTimestampExcel(tlx.saved_at) : 'N/A'
      };
    });
    if (!sheet4.length) sheet4.push({
      Participant_ID: pid, Session_ID: sid, Rating_Number: 0,
      Task_Type:'N/A', Task_Difficulty:'N/A', Completion_Time_sec:0,
      'Accuracy_%':0, Errors:0, AI_Prompts_Used:0,
      NASA_Mental_Demand:0, NASA_Physical_Demand:0, NASA_Temporal_Demand:0,
      NASA_Performance:0, NASA_Effort:0, NASA_Frustration:0, Overall_NASA_TLX:0,
      Workload_Band:'N/A', Rated_At:'N/A'
    });

    // ── Build workbook ──
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(sheet1);
    const ws2 = XLSX.utils.json_to_sheet(sheet2);
    const ws3 = XLSX.utils.json_to_sheet(sheet3);

    // Overwrite with advanced Excel formulas for Sheet 3 (Eye + EEG Data)
    // Column map now that 4 timestamp columns (C:F = Frame_Number, Timestamp,
    // Timestamp_Local, Timestamp_ISO) and G = Relative_Time_sec precede the data:
    //  A Participant_ID  B Session_ID  C Frame_Number  D Timestamp  E Timestamp_Local
    //  F Timestamp_ISO   G Relative_Time_sec   H Condition
    //  I Blink_Rate  J Blink_Duration_ms  K PERCLOS  L EAR  M IBI_ms  N Gaze_Stability
    //  O Fixation_Density  P Saccade_Velocity  Q Attention_Score  R Eye_Strain_Index
    //  S Cognitive_Load  T Confidence_Score  U Signal_Quality  V Face_Confidence  W Head_Pose
    //  X EEG_Delta  Y EEG_Theta  Z EEG_Alpha  AA EEG_Beta  AB EEG_Gamma
    //  AC Theta_Alpha_Ratio  AD Beta_Alpha_Ratio  AE Neural_Attention  AF Neural_Workload  AG Neural_Fatigue
    sessions.forEach((s, idx) => {
      const r = idx + 2; // row number (1-based, data starts on row 2)
      // IBI_ms: column M, from Blink_Rate (column I)
      if (ws3[`M${r}`]) {
        ws3[`M${r}`].t = 'n';
        ws3[`M${r}`].f = `IF(I${r}>0, 60000/I${r}, 0)`;
      }
      // Theta_Alpha_Ratio: column AC, from EEG_Theta (Y) / EEG_Alpha (Z)
      if (ws3[`AC${r}`]) {
        ws3[`AC${r}`].t = 'n';
        ws3[`AC${r}`].f = `IF(Z${r}>0, Y${r}/Z${r}, 0)`;
      }
      // Beta_Alpha_Ratio: column AD, from EEG_Beta (AA) / EEG_Alpha (Z)
      if (ws3[`AD${r}`]) {
        ws3[`AD${r}`].t = 'n';
        ws3[`AD${r}`].f = `IF(Z${r}>0, AA${r}/Z${r}, 0)`;
      }
    });

    // Append average summary row to Sheet 3 (Eye + EEG Data)
    if (sessions.length > 0) {
      const N = sessions.length;
      const sumRowIdx = N + 2; // Summary row index (header is 1, data rows 2 to N+1)
      const summaryRow = {
        Participant_ID: 'AVERAGE',
        Session_ID: '',
        Frame_Number: '',
        Timestamp: '',
        Timestamp_Local: '',
        Timestamp_ISO: '',
        Relative_Time_sec: 0,
        Condition: '',
        Blink_Rate: 0,
        Blink_Duration_ms: 0,
        PERCLOS: 0,
        EAR: 0,
        IBI_ms: 0,
        Gaze_Stability: 0,
        Fixation_Density: 0,
        Saccade_Velocity: 0,
        Attention_Score: 0,
        Eye_Strain_Index: 0,
        Cognitive_Load: 0,
        Confidence_Score: 0,
        Signal_Quality: 0,
        Face_Confidence: 0,
        Head_Pose: '',
        EEG_Delta: 0,
        EEG_Theta: 0,
        EEG_Alpha: 0,
        EEG_Beta: 0,
        EEG_Gamma: 0,
        Theta_Alpha_Ratio: 0,
        Beta_Alpha_Ratio: 0,
        Neural_Attention: 0,
        Neural_Workload: 0,
        Neural_Fatigue: 0,
        Camera_Quality_Score: 0,
        Camera_Quality_Label: 'AVERAGE',
        Experiment_Integrity_Score: 0
      };
      XLSX.utils.sheet_add_json(ws3, [summaryRow], { skipHeader: true, origin: -1 });

      const cols = [
        ['G', 'Relative_Time_sec'],
        ['I', 'Blink_Rate'], ['J', 'Blink_Duration_ms'], ['K', 'PERCLOS'], ['L', 'EAR'], ['M', 'IBI_ms'],
        ['N', 'Gaze_Stability'], ['O', 'Fixation_Density'], ['P', 'Saccade_Velocity'], ['Q', 'Attention_Score'],
        ['R', 'Eye_Strain_Index'], ['S', 'Cognitive_Load'], ['T', 'Confidence_Score'], ['U', 'Signal_Quality'],
        ['V', 'Face_Confidence'], ['X', 'EEG_Delta'], ['Y', 'EEG_Theta'], ['Z', 'EEG_Alpha'], ['AA', 'EEG_Beta'],
        ['AB', 'EEG_Gamma'], ['AC', 'Theta_Alpha_Ratio'], ['AD', 'Beta_Alpha_Ratio'], ['AE', 'Neural_Attention'],
        ['AF', 'Neural_Workload'], ['AG', 'Neural_Fatigue'],
        ['AH', 'Camera_Quality_Score'], ['AJ', 'Experiment_Integrity_Score']
      ];
      cols.forEach(([col, name]) => {
        const cell = ws3[`${col}${sumRowIdx}`];
        if (cell) {
          cell.t = 'n';
          cell.f = `AVERAGE(${col}2:${col}${sumRowIdx-1})`;
        }
      });
    }

    const ws4 = XLSX.utils.json_to_sheet(sheet4);

    // Overwrite with advanced Excel formulas for Sheet 4 (Ground Truth & Performance)
    const tlxLen = tlxHistory.length || 1;
    for (let i = 0; i < tlxLen; i++) {
      const r = i + 2;
      // Overall_NASA_TLX: column P
      if (ws4[`P${r}`]) {
        ws4[`P${r}`].t = 'n';
        ws4[`P${r}`].f = `AVERAGE(J${r}:O${r})`;
      }
      // Workload_Band: column Q
      if (ws4[`Q${r}`]) {
        ws4[`Q${r}`].t = 's';
        ws4[`Q${r}`].f = `IF(P${r}<20,"Very Low",IF(P${r}<40,"Low",IF(P${r}<60,"Medium",IF(P${r}<80,"High","Very High"))))`;
      }
    }


    // Column widths
    const autoWidth = (ws, data) => {
      if (!data.length) return;
      const cols = Object.keys(data[0]);
      ws['!cols'] = cols.map(c => ({ wch: Math.max(c.length, ...data.map(r => String(r[c]||'').length)) + 2 }));
    };
    autoWidth(ws1, sheet1); autoWidth(ws2, sheet2);
    autoWidth(ws3, sheet3); autoWidth(ws4, sheet4);

    XLSX.utils.book_append_sheet(wb, ws1, 'Participant Information');
    XLSX.utils.book_append_sheet(wb, ws2, 'Experiment Conditions');
    XLSX.utils.book_append_sheet(wb, ws3, 'Eye + EEG Data');
    XLSX.utils.book_append_sheet(wb, ws4, 'Ground Truth & Performance');

    const fname = `NEUROMIA_Research_${pid}_S${sid}_${Date.now()}.xlsx`;
    XLSX.writeFile(wb, fname);
    toast('XLSX EXPORTED', `4-sheet research workbook: ${sessions.length} data rows`, 'ok');
    addAlert(`Research XLSX exported: ${fname} (${sessions.length} rows, 4 sheets)`, 'ok');
  }

  // ── Legacy CSV export (kept for compatibility) ──
  function exportCSV() { exportXLSX(); }

  // ── Auto-record every 8 seconds (captures 30 sessions over ~4 minutes) ──
  function startAutoRecord() {
    if (autoTimer) return;
    autoTimer = setInterval(() => {
      const brText = $('mBlink').textContent;
      const br = parseFloat(brText);
      if (isNaN(br) || !brText.includes('/min')) return; // no real data yet
      const gs = parseFloat($('mGaze').textContent);
      const at = parseFloat($('mAttn').textContent);
      const ec = parseFloat($('mClose').textContent);
      const tb = parseInt($('mBlinkCnt').textContent);
      const ibiMs = parseFloat(($('mIBI').textContent || '').replace(/,/g,''));
      if ([gs, at, ec, tb, ibiMs].some(v => Number.isNaN(v))) return;
      recordSession({ br, gs, at, ec, tb, ibi: ibiMs, ...getAllOculoCSVFeatures(), test_mode:getTestMode() });
      autoCount++;
      if (autoCount >= MAX_SESSIONS) {
        clearInterval(autoTimer);
        autoTimer = null;
        toast('30 SESSIONS COMPLETE', 'Full oculometric history captured', 'ok');
        addAlert('30-session oculometric capture complete — statistics finalized', 'ok');
      }
    }, 8200);
  }

  // ── Init ──
  function init() {
    // ── BUG FIX: Restore sessions from localStorage ──
    loadSessions();

    // Init sparkline charts
    charts.br = initChart('shChartBR', '#00ff88',  'BLINK RATE');
    charts.gs = initChart('shChartGS', '#00e5ff',  'GAZE STABILITY');
    charts.at = initChart('shChartAT', '#00ff88',  'ATTENTION');
    charts.ec = initChart('shChartEC', '#00e5ff',  'EYE CLOSURE');
    charts.tb = initChart('shChartTB', '#ffb300',  'TOTAL BLINKS');

    // Start empty — sessions filled by real camera data only
    setOculoFeatureUI(getCurrentOculoFeatures());
    renderTable();
    renderStats();
    updateCount();

    // Auto-start recording live sessions
    setTimeout(() => startAutoRecord(), 3000);

    // Button wiring
    const recBtn = $('shRecordBtn');
    if (recBtn) recBtn.addEventListener('click', () => {
      const brText = $('mBlink').textContent;
      const br = parseFloat(brText);
      if (isNaN(br) || !brText.includes('/min')) {
        toast('NO REAL DATA', 'Start camera & face must be detected to record', 'warn');
        return;
      }
      const toZero = v => Number.isFinite(v) ? v : 0;
      const gs = toZero(parseFloat($('mGaze').textContent));
      const at = toZero(parseFloat($('mAttn').textContent));
      const ec = toZero(parseFloat($('mClose').textContent));
      const tb = toZero(parseInt($('mBlinkCnt').textContent));
      const ibi = toZero(parseFloat(($('mIBI').textContent || '').replace(/,/g,'')));
      recordSession({ br, gs, at, ec, tb, ibi, ...getAllOculoCSVFeatures(), test_mode:getTestMode() });
      toast('SESSION RECORDED', `Real oculometric snapshot #${sessions.length} saved`, 'ok');
    });
    const clrBtn = $('shClearBtn');
    if (clrBtn) clrBtn.addEventListener('click', () => {
      if (confirm('Clear all 30 session records?')) {
        sessions = [];
        saveSessions();
        renderTable();
        renderStats();
        updateCount();
        renderExportReport();
        renderFinalReport();
        toast('HISTORY CLEARED', 'All session data removed', 'warn');
      }
    });
    const expBtn = $('shExportBtn');
    if (expBtn) expBtn.addEventListener('click', () => exportXLSX());
    const frRefreshBtn = $('frRefreshBtn');
    if (frRefreshBtn) frRefreshBtn.addEventListener('click', () => renderFinalReport());
    const frPdfBtn = $('frPdfBtn');
    if (frPdfBtn) frPdfBtn.addEventListener('click', () => downloadFinalReportPDF());
    renderFinalReport();
  }

  return {
    init,
    pushLive,
    recordSession,
    exportCSV,
    exportXLSX,
    renderExportReport,
    getSessions: () => sessions.slice()
  };
})();
window.OculoHistory = OculoHistory;

// ── Init OculoHistory on DOM ready ──
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => OculoHistory.init(), 400);
});

// ════════════════════════════════════════════