// ═══════════════════════════════════════════
function fireBurst() {
  const canvas = $('burstCanvas');
  const ctx = canvas.getContext('2d');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.classList.add('show');

  const cx = canvas.width  / 2;
  const cy = canvas.height / 2;

  const colors = ['#00e5ff','#ff00aa','#00ff88','#ffb300','#aa44ff','#ffffff'];
  const particles = [];
  const count = 130;

  for(let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.3;
    const speed = 3 + Math.random() * 9;
    const size  = 2 + Math.random() * 5;
    particles.push({
      x: cx, y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      alpha: 1,
      size,
      color: colors[Math.floor(Math.random() * colors.length)],
      decay: 0.012 + Math.random() * 0.018,
      trail: [],
    });
  }

  // Ring wave
  let ringR = 0, ringAlpha = 1;

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Expanding ring
    if(ringAlpha > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(0,229,255,${ringAlpha * 0.6})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ringR   += 14;
      ringAlpha -= 0.03;

      // Second ring (magenta)
      ctx.beginPath();
      ctx.arc(cx, cy, ringR * 0.6, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,0,170,${ringAlpha * 0.4})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    let alive = false;
    particles.forEach(p => {
      if(p.alpha <= 0) return;
      alive = true;

      p.trail.push({x: p.x, y: p.y});
      if(p.trail.length > 8) p.trail.shift();

      // Draw trail
      if(p.trail.length > 1) {
        ctx.beginPath();
        ctx.moveTo(p.trail[0].x, p.trail[0].y);
        for(let t = 1; t < p.trail.length; t++) ctx.lineTo(p.trail[t].x, p.trail[t].y);
        ctx.strokeStyle = p.color.replace(')', `,${p.alpha * 0.25})`).replace('rgb','rgba').replace('##','rgba(').replace('#00e5ff',`rgba(0,229,255,${p.alpha*0.2})`).replace('#ff00aa',`rgba(255,0,170,${p.alpha*0.2})`).replace('#00ff88',`rgba(0,255,136,${p.alpha*0.2})`).replace('#ffb300',`rgba(255,179,0,${p.alpha*0.2})`).replace('#aa44ff',`rgba(170,68,255,${p.alpha*0.2})`).replace('#ffffff',`rgba(255,255,255,${p.alpha*0.2})`);
        ctx.lineWidth = p.size * 0.5;
        ctx.stroke();
      }

      // Draw particle
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      const hexToRGBA = (hex, a) => {
        const r = parseInt(hex.slice(1,3),16);
        const g = parseInt(hex.slice(3,5),16);
        const b = parseInt(hex.slice(5,7),16);
        return `rgba(${r},${g},${b},${a})`;
      };
      ctx.fillStyle = hexToRGBA(p.color, p.alpha);
      ctx.shadowBlur = 8;
      ctx.shadowColor = p.color;
      ctx.fill();
      ctx.shadowBlur = 0;

      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.12; // gravity
      p.vx *= 0.98;
      p.alpha -= p.decay;
      p.size  *= 0.993;
    });

    if(alive || ringAlpha > 0) requestAnimationFrame(draw);
    else {
      canvas.classList.remove('show');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
  draw();
}

// ═══════════════════════════════════════════
// RESULT OVERLAY
// ═══════════════════════════════════════════
function showResultOverlay() {
  if(!window.regData) return;
  const d = window.regData;

  // Populate personal
  $('rAvatar').textContent = d.avatar;
  $('rAvatar').style.borderColor = d.color + '55';
  $('rAvatar').style.boxShadow   = `0 0 24px ${d.color}30`;
  $('rName').textContent  = d.fullName.toUpperCase();
  $('rRole').textContent  = `${d.role.toUpperCase()} — SESSION ACTIVE`;
  $('rIdBadge').textContent = d.subjectId;

  // Status pills
  $('rHandPill').textContent = d.handedness.toUpperCase();
  const consents = [d.consentEEG, d.consentVideo, d.consentResearch, d.consentExport].filter(Boolean).length;
  $('rConsentPill').textContent = `${consents}/4 CONSENTS`;

  // Result fields
  $('rf-fullname').textContent  = d.fullName;
  $('rf-dob').textContent       = new Date(d.dob).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
  $('rf-age').textContent       = `${d.age} years old`;
  $('rf-gender').textContent    = d.gender;
  $('rf-email').textContent     = d.email;
  $('rf-phone').textContent     = d.phone;
  $('rf-org').textContent       = d.org;
  $('rf-sid').textContent       = d.subjectId;
  $('rf-role').textContent      = d.role;
  $('rf-hand').textContent      = d.handedness;
  $('rf-prior').textContent     = d.priorSessions + ' sessions';
  $('rf-freq').textContent      = d.domFreq;
  $('rf-conditions').textContent = d.conditions;
  $('rf-regtime').textContent   = d.regTime;
  $('rf-notes').textContent     = d.notes;

  // EEG snapshot
  const snap = d.eegSnapshot;
  if(snap && snap.waves) {
    const bands = [
      { id:'delta', label:'DELTA', val: snap.waves.delta, max: 40 },
      { id:'theta', label:'THETA', val: snap.waves.theta, max: 50 },
      { id:'alpha', label:'ALPHA', val: snap.waves.alpha, max: 45 },
      { id:'beta',  label:'BETA',  val: snap.waves.beta,  max: 60 },
      { id:'gamma', label:'GAMMA', val: snap.waves.gamma, max: 20 },
    ];
    bands.forEach(b => {
      const valEl  = $(`rw-${b.id}`);
      const fillEl = $(`rwf-${b.id}`);
      if(valEl)  valEl.textContent = (b.val || 0).toFixed(1) + ' μV';
      if(fillEl) fillEl.style.width = Math.min(100, ((b.val||0) / b.max) * 100) + '%';
    });
  }

  // Session timer (counts up from registration)
  const startTime = Date.now();
  const timerInterval = setInterval(() => {
    if(!$('resultOverlay').classList.contains('show')) {
      clearInterval(timerInterval); return;
    }
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const mm = String(Math.floor(elapsed / 60)).padStart(2,'0');
    const ss = String(elapsed % 60).padStart(2,'0');
    $('rTimePill').textContent = `SESSION: ${mm}:${ss}`;
  }, 1000);

  // Show overlay
  $('resultOverlay').classList.add('show');
  document.body.style.overflow = 'hidden';

  // Fire burst effect
  setTimeout(() => fireBurst(), 150);
}

function closeResultOverlay() {
  $('resultOverlay').classList.remove('show');
  document.body.style.overflow = '';
}

// Result overlay buttons
$('rCloseBtn').addEventListener('click', () => {
  closeResultOverlay();
  addAlert(`Session started for ${window.regData ? window.regData.fullName : 'subject'}`, 'ok');
  toast('SESSION ACTIVE', 'Neural monitoring has begun', 'ok');
});

$('rEditBtn').addEventListener('click', () => {
  closeResultOverlay();
  setTimeout(() => openRegModal(true), 300);
});

$('rExportBtn').addEventListener('click', () => {
  if(!window.regData) return;
  const eegMetrics = EEGSys.getMetrics();
  const exportObj = {
    ...window.regData,
    exportTimestamp: new Date().toISOString(),
    liveEEG: eegMetrics,
    sessionId: $('sessId').textContent,
  };
  const blob = new Blob([JSON.stringify(exportObj, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `neuromia-subject-${window.regData.subjectId}-${Date.now()}.json`;
  a.click();
  toast('SUBJECT DATA EXPORTED', `${window.regData.subjectId} profile saved`, 'ok');
});

// Re-open result overlay when clicking register button if already registered
$('openRegBtn').addEventListener('click', () => {
  // (Handled above — but if already registered, show result instead)
});
// Override: if registered, click shows result overlay
(function(){
  const origHandler = $('openRegBtn').onclick;
  $('openRegBtn').onclick = null;
  $('openRegBtn').addEventListener('click', () => {
    if(window.regData) {
      showResultOverlay();
    } else {
      openRegModal();
    }
  });
})();

// ── rExportBtn also calls PDF ──
$('rExportBtn').addEventListener('click', () => exportSessionPDF());

// ═══════════════════════════════════════════
// PDF REPORT GENERATION ENGINE
// ═══════════════════════════════════════════
async function exportSessionPDF() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    toast('PDF NOT READY', 'jsPDF library not loaded yet — try again in a moment', 'warn');
    addAlert('PDF export failed — jsPDF library not available', 'warn');
    return;
  }
  toast('GENERATING PDF','Building full session report...','info');
  addAlert('PDF report generation initiated','info');

  await new Promise(r => setTimeout(r, 120)); // let toast render

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const W = 210, H = 297;
  const margin = 14;
  const col = W - margin * 2;

  // ── Colour palette ──
  const C = {
    bg:      [5,   5,  16],
    panel:   [10,  10,  28],
    border:  [0,   60,  80],
    cyan:    [0,  229, 255],
    magenta: [255,  0, 170],
    green:   [0,  255, 136],
    amber:   [255,179,   0],
    red:     [255, 45,  85],
    purple:  [170, 68, 255],
    blue:    [0,  170, 255],
    white:   [255,255, 255],
    text:    [184,204,220],
    muted:   [80, 100,120],
    dimmed:  [40,  55, 70],
  };

  const eeg  = EEGSys.getMetrics();
  const reg  = window.regData || {};
  const now  = new Date();
  const sid  = reg.subjectId || $('sessId').textContent || 'NM-UNKNOWN';
  const reportSessions = (window.OculoHistory && typeof window.OculoHistory.getSessions === 'function') ? window.OculoHistory.getSessions() : [];
  const lastSession = reportSessions.length ? reportSessions[reportSessions.length - 1] : null;
  const dpCnt = lastSession ? reportSessions.length : (parseInt($('dpCnt').textContent) || 0);
  const hwConnected = EEGSys.isHWConnected();
  const reportValue = (field, fallback='0') => lastSession && lastSession[field] !== undefined && lastSession[field] !== null && lastSession[field] !== '' ? lastSession[field] : fallback;
  const reportText = (field, suffix='', decimals=null, fallback='0') => {
    const v = reportValue(field, fallback);
    const n = Number(v);
    if (decimals !== null && Number.isFinite(n)) return n.toFixed(decimals) + suffix;
    return String(v) + suffix;
  };

  // ── helpers ──
  function fillRect(x, y, w, h, rgb) {
    doc.setFillColor(...rgb);
    doc.rect(x, y, w, h, 'F');
  }
  function setFont(style, size, rgb) {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...rgb);
  }
  function txt(text, x, y, opts) {
    doc.text(String(text), x, y, opts || {});
  }
  function hline(y, x1, x2, rgb, lw) {
    doc.setDrawColor(...(rgb || C.border));
    doc.setLineWidth(lw || 0.25);
    doc.line(x1 || margin, y, x2 || (W - margin), y);
  }
  function roundRect(x, y, w, h, r, fillRgb, strokeRgb) {
    if (fillRgb) { doc.setFillColor(...fillRgb); }
    if (strokeRgb) { doc.setDrawColor(...strokeRgb); doc.setLineWidth(0.3); }
    doc.roundedRect(x, y, w, h, r, r, fillRgb && strokeRgb ? 'FD' : fillRgb ? 'F' : 'D');
  }
  function sectionHeader(label, y) {
    setFont('bold', 7, C.cyan);
    txt(label, margin, y);
    // Underline
    const tw = doc.getTextWidth(label);
    doc.setDrawColor(...C.cyan);
    doc.setLineWidth(0.4);
    doc.line(margin, y + 0.8, margin + tw, y + 0.8);
  }

  // Helper: draw a bar
  function bar(x, y, w, h, pct, fillRgb, bgRgb) {
    fillRect(x, y, w, h, bgRgb || [20,30,40]);
    fillRect(x, y, w * Math.min(1, pct / 100), h, fillRgb);
  }

  // ── Mini chart drawer using raw canvas ──
  function makeChartCanvas(width, height, drawFn) {
    const cvs = document.createElement('canvas');
    cvs.width  = width;
    cvs.height = height;
    const ctx = cvs.getContext('2d');
    drawFn(ctx, width, height);
    return cvs.toDataURL('image/png');
  }

  // ─────────────────────────────────────────
  // PAGE 1 — COVER
  // ─────────────────────────────────────────
  // Full dark background
  fillRect(0, 0, W, H, C.bg);

  // Top gradient bar
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    const r = Math.round(C.cyan[0]*t + C.magenta[0]*(1-t));
    const g = Math.round(C.cyan[1]*t + C.magenta[1]*(1-t));
    const b = Math.round(C.cyan[2]*t + C.magenta[2]*(1-t));
    fillRect(0, i * 0.5, W, 0.52, [r,g,b]);
  }

  // Grid pattern (subtle)
  doc.setDrawColor(0, 229, 255);
  doc.setLineWidth(0.05);
  doc.setGState(new doc.GState({opacity: 0.04}));
  for (let x = 0; x <= W; x += 10) doc.line(x, 0, x, H);
  for (let y = 0; y <= H; y += 10) doc.line(0, y, W, y);
  doc.setGState(new doc.GState({opacity: 1}));

  // Glow circle
  doc.setFillColor(0, 40, 60);
  doc.circle(W/2, 80, 55, 'F');
  doc.setFillColor(0, 25, 40);
  doc.circle(W/2, 80, 40, 'F');

  // Brain icon placeholder (cyan circle with B)
  doc.setFillColor(...C.cyan);
  doc.setGState(new doc.GState({opacity: 0.12}));
  doc.circle(W/2, 75, 32, 'F');
  doc.setGState(new doc.GState({opacity: 1}));
  doc.setDrawColor(...C.cyan);
  doc.setLineWidth(0.6);
  doc.circle(W/2, 75, 28, 'D');

  // NEUROMIA logo
  setFont('bold', 26, C.cyan);
  txt('NEUROMIA', W/2, 62, {align:'center'});
  setFont('normal', 7.5, C.magenta);
  txt('COGNITIVE INTELLIGENCE SYSTEM', W/2, 70, {align:'center'});

  // Brain waves motif
  const waveY = 88;
  doc.setDrawColor(...C.cyan);
  doc.setLineWidth(0.5);
  doc.setGState(new doc.GState({opacity: 0.35}));
  const wPath = [];
  for (let i = 0; i <= 120; i++) {
    const xp = W/2 - 30 + (i/120)*60;
    const yp = waveY + Math.sin(i * 0.28) * 3.5 + Math.sin(i * 0.7) * 1.5;
    wPath.push([xp, yp]);
  }
  for (let i = 1; i < wPath.length; i++) {
    doc.line(wPath[i-1][0], wPath[i-1][1], wPath[i][0], wPath[i][1]);
  }
  doc.setGState(new doc.GState({opacity: 1}));

  // Title
  setFont('bold', 20, C.white);
  txt('NEURAL COGNITIVE ASSESSMENT REPORT', W/2, 108, {align:'center'});
  setFont('normal', 7.5, C.text);
  txt('Electroencephalographic & Oculometric Performance Analysis — Confidential Clinical Document', W/2, 116, {align:'center'});

  // Horizontal divider
  for (let i = 0; i < 4; i++) {
    const t = i/3;
    const r = Math.round(C.cyan[0]*t + C.magenta[0]*(1-t));
    const g = Math.round(C.cyan[1]*t + C.magenta[1]*(1-t));
    const b = Math.round(C.cyan[2]*t + C.magenta[2]*(1-t));
    fillRect(margin + (col/3)*i, 122, col/3 + 1, 0.6, [r,g,b]);
  }

  // Subject info card
  roundRect(margin, 128, col, 50, 3, [8,12,28], C.border);

  // Avatar circle
  doc.setFillColor(0, 60, 80);
  doc.circle(margin + 20, 153, 14, 'F');
  doc.setDrawColor(...C.cyan);
  doc.setLineWidth(0.5);
  doc.circle(margin + 20, 153, 14, 'D');
  setFont('bold', 14, C.cyan);
  txt(reg.avatar || '🧠', margin + 20, 157, {align:'center'});

  // Subject name
  setFont('bold', 14, C.white);
  txt((reg.fullName || 'ANONYMOUS SUBJECT').toUpperCase(), margin + 40, 147);
  setFont('normal', 7.5, C.muted);
  txt((reg.role || 'RESEARCH SUBJECT') + '  •  ' + sid, margin + 40, 154);
  setFont('normal', 7, C.text);
  txt(reg.org !== 'N/A' && reg.org ? reg.org : 'Independent', margin + 40, 160);

  // Sub-info row
  const coverFields = [
    ['AGE', reg.age ? reg.age + ' yrs' : '—'],
    ['GENDER', reg.gender || '—'],
    ['HANDEDNESS', reg.handedness || '—'],
    ['PRIOR SESSIONS', (reg.priorSessions || '0') + ' sess.'],
  ];
  coverFields.forEach(([label, val], i) => {
    const fx = margin + 40 + i * 38;
    setFont('normal', 6, C.muted);
    txt(label, fx, 170);
    setFont('bold', 8, C.cyan);
    txt(val, fx, 175);
  });

  // Session meta cards — row of 4
  const metaCards = [
    { label: 'SESSION ID',   val: sid,                           col: C.cyan    },
    { label: 'DATE',          val: now.toLocaleDateString('en-GB'),col: C.green  },
    { label: 'TIME',          val: now.toLocaleTimeString('en-GB',{hour12:false}), col: C.amber },
    { label: 'DATA POINTS',  val: String(dpCnt),                 col: C.magenta },
  ];
  const cw = (col - 9) / 4;
  metaCards.forEach(({label, val, col: c}, i) => {
    const cx2 = margin + i * (cw + 3);
    roundRect(cx2, 185, cw, 22, 2, [8,12,28], C.border);
    setFont('normal', 5.5, C.muted);
    txt(label, cx2 + cw/2, 192, {align:'center'});
    setFont('bold', 8, c);
    txt(val, cx2 + cw/2, 199, {align:'center'});
  });

  // Footer
  setFont('normal', 6, C.dimmed);
  txt('GENERATED BY NEUROMIA COGNITIVE INTELLIGENCE SYSTEM  •  CONFIDENTIAL', W/2, H - 10, {align:'center'});
  txt('Page 1 of 3', W - margin, H - 10, {align:'right'});

  // ─────────────────────────────────────────
  // PAGE 2 — EEG ANALYSIS + CHARTS
  // ─────────────────────────────────────────
  doc.addPage();
  fillRect(0, 0, W, H, C.bg);

  // Header bar
  fillRect(0, 0, W, 18, C.panel);
  doc.setDrawColor(...C.cyan);
  doc.setLineWidth(0.4);
  doc.line(0, 18, W, 18);
  setFont('bold', 10, C.cyan);
  txt('EEG SPECTRAL ANALYSIS', margin, 12);
  setFont('normal', 6.5, C.muted);
  txt(sid + '  •  ' + now.toLocaleString('en-GB', {hour12:false}), W - margin, 12, {align:'right'});

  let cy2 = 26;

  // ── Hardware Status Notice ──
  if(!hwConnected) {
    roundRect(margin, cy2, col, 16, 2, [30,8,12], [180,30,50]);
    setFont('bold', 7, C.red);
    txt('⚠  EEG HARDWARE NOT CONNECTED', margin + 5, cy2 + 7);
    setFont('normal', 6, [200,100,110]);
    txt('All EEG spectral values are unavailable. Connect a compatible EEG device to acquire live neural data.', margin + 68, cy2 + 7);
    cy2 += 22;
  }

  // ── SECTION: Frequency Band Power ──
  sectionHeader('FREQUENCY BAND POWER SPECTRUM', cy2);
  cy2 += 8;

  const waves = hwConnected ? (eeg.waves || {}) : null;
  const bands = [
    { name:'DELTA', hz:'0.5 – 4 Hz',  val: waves ? waves.delta : null, max:50, rgb: C.blue,    norm:'20–30%',  meaning:'Deep sleep, recovery' },
    { name:'THETA', hz:'4 – 8 Hz',    val: waves ? waves.theta : null, max:55, rgb: [0,150,220], norm:'10–20%', meaning:'Drowsiness, creativity' },
    { name:'ALPHA', hz:'8 – 13 Hz',   val: waves ? waves.alpha : null, max:45, rgb: C.green,   norm:'25–35%',  meaning:'Relaxed awareness' },
    { name:'BETA',  hz:'13 – 30 Hz',  val: waves ? waves.beta  : null, max:65, rgb: C.amber,   norm:'30–40%',  meaning:'Active focus, cognition' },
    { name:'GAMMA', hz:'30 – 100 Hz', val: waves ? waves.gamma : null, max:25, rgb: C.magenta, norm:'5–10%',   meaning:'High-level processing' },
  ];
  const totalPow = waves ? bands.reduce((s,b) => s + (b.val||0), 0) || 1 : 1;

  bands.forEach((b, i) => {
    const bx = margin + i * ((col + 3) / 5);
    const bw2 = (col - 12) / 5;
    const pct = b.val !== null ? Math.min(1, (b.val||0) / b.max) : 0;
    const barH = 38 * pct;

    // background column
    roundRect(bx, cy2, bw2, 44, 2, [8,14,24]);

    if(b.val !== null) {
      // fill bar (bottom-aligned)
      doc.setFillColor(...b.rgb);
      doc.setGState(new doc.GState({opacity: 0.85}));
      doc.roundedRect(bx + 2, cy2 + 2 + (38 - barH), bw2 - 4, barH + 2, 1.5, 1.5, 'F');
      doc.setGState(new doc.GState({opacity: 1}));

      // glow top
      doc.setFillColor(...b.rgb);
      doc.setGState(new doc.GState({opacity: 0.2}));
      doc.roundedRect(bx + 2, cy2 + 2 + (38 - barH), bw2 - 4, 3, 1.5, 1.5, 'F');
      doc.setGState(new doc.GState({opacity: 1}));
    } else {
      // NO SIGNAL indicator
      setFont('normal', 5.5, C.muted);
      txt('NO', bx + bw2/2, cy2 + 18, {align:'center'});
      txt('SIGNAL', bx + bw2/2, cy2 + 24, {align:'center'});
    }

    // Labels
    setFont('bold', 6, b.rgb);
    txt(b.name, bx + bw2/2, cy2 + 48, {align:'center'});
    setFont('normal', 5, C.muted);
    txt(b.hz, bx + bw2/2, cy2 + 53, {align:'center'});
    setFont('bold', 7, b.val !== null ? C.white : C.muted);
    txt(b.val !== null ? (b.val||0).toFixed(1) + ' μV' : 'N/A', bx + bw2/2, cy2 + 59, {align:'center'});
    setFont('normal', 5.5, C.muted);
    txt(b.val !== null ? ((b.val||0)/totalPow*100).toFixed(1) + '%' : '—', bx + bw2/2, cy2 + 64, {align:'center'});
  });
  cy2 += 70;

  // ── EEG Waveform Chart ──
  sectionHeader('EEG LIVE WAVEFORM TRACE  —  CH: Fp1 · Fp2 · C3 · C4  ·  256 Hz', cy2);
  cy2 += 6;

  const wfImg = makeChartCanvas(900, 140, (ctx, cw3, ch) => {
    ctx.fillStyle = '#080818';
    ctx.fillRect(0, 0, cw3, ch);

    // Grid lines
    ctx.strokeStyle = 'rgba(0,229,255,0.08)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x < cw3; x += 45) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,ch); ctx.stroke(); }
    for (let y = 0; y < ch; y += 20)  { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(cw3,y); ctx.stroke(); }

    const channels = [
      { name:'Fp1', color:'rgba(0,229,255,0.85)', offset: ch*0.2 },
      { name:'Fp2', color:'rgba(0,255,136,0.75)', offset: ch*0.4 },
      { name:'C3',  color:'rgba(255,179,0,0.75)', offset: ch*0.6 },
      { name:'C4',  color:'rgba(255,0,170,0.75)', offset: ch*0.8 },
    ];

    channels.forEach(({name, color, offset}, ci) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      for (let i = 0; i < cw3; i++) {
        let y2;
        if(hwConnected) {
          const t = i / 30;
          const v = Math.sin(t * 2.1 + ci) * 9
                  + Math.sin(t * 6.5 + ci * 0.7) * 4
                  + Math.sin(t * 14  + ci * 1.3) * 2
                  + Math.sin(t * 28  + ci * 0.4) * 1.2;
          y2 = offset + v;
        } else {
          // Flat baseline — no signal
          y2 = offset;
        }
        i === 0 ? ctx.moveTo(i, y2) : ctx.lineTo(i, y2);
      }
      ctx.stroke();

      // Channel label
      ctx.fillStyle = color;
      ctx.font = 'bold 11px monospace';
      ctx.fillText(name, 6, offset - 4);
    });

    if(!hwConnected) {
      // "NO HARDWARE CONNECTED" overlay text
      ctx.fillStyle = 'rgba(255,45,85,0.7)';
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('NO EEG HARDWARE CONNECTED — FLAT LINE BASELINE', cw3/2, ch/2 - 6);
      ctx.fillStyle = 'rgba(80,100,120,0.6)';
      ctx.font = '11px monospace';
      ctx.fillText('Connect EEG device to begin signal acquisition', cw3/2, ch/2 + 12);
    } else {
      // Timestamp marks
      ctx.fillStyle = 'rgba(0,229,255,0.3)';
      ctx.font = '9px monospace';
      for (let t2 = 0; t2 < 6; t2++) {
        const x2 = (t2 / 5) * cw3;
        ctx.fillText(`${t2}s`, x2 + 2, ch - 3);
      }
    }
  });
  roundRect(margin, cy2, col, 42, 2, [8,12,24]);
  doc.addImage(wfImg, 'PNG', margin + 1, cy2 + 1, col - 2, 40);
  cy2 += 48;

  // ── Radar / spider chart for cognitive state ──
  sectionHeader('COGNITIVE STATE RADAR', cy2);
  cy2 += 6;

  const metrics = hwConnected ? (eeg.metrics || {}) : null;
  const radarData = [
    { label: 'ATTENTION',   val: metrics ? Math.round(metrics.attention  || 0) : null },
    { label: 'MEDITATION',  val: metrics ? Math.round(metrics.meditation || 0) : null },
    { label: 'WORKLOAD',    val: metrics ? Math.round(metrics.workload   || 0) : null },
    { label: 'ENGAGEMENT',  val: metrics ? Math.round(metrics.engagement || 0) : null },
    { label: 'COHERENCE',   val: metrics ? Math.round(metrics.coherence  || 0) : null },
    { label: 'FATIGUE',     val: metrics ? Math.round(metrics.fatigue    || 0) : null },
  ];

  const radarImg = makeChartCanvas(340, 340, (ctx, cw3, ch) => {
    ctx.fillStyle = '#050510';
    ctx.fillRect(0, 0, cw3, ch);
    const cx3 = cw3/2, cy3 = ch/2, R = Math.min(cw3, ch) * 0.38;
    const N = radarData.length;
    const angles = radarData.map((_, i) => (i/N)*Math.PI*2 - Math.PI/2);

    // Concentric rings
    [0.25, 0.5, 0.75, 1.0].forEach(r => {
      ctx.beginPath();
      angles.forEach((a, i) => {
        const x2 = cx3 + Math.cos(a)*R*r, y2 = cy3 + Math.sin(a)*R*r;
        i === 0 ? ctx.moveTo(x2, y2) : ctx.lineTo(x2, y2);
      });
      ctx.closePath();
      ctx.strokeStyle = `rgba(0,229,255,${0.12 + r*0.08})`;
      ctx.lineWidth = 0.8;
      ctx.stroke();
      if (r < 1) {
        ctx.fillStyle = 'rgba(100,130,160,0.5)';
        ctx.font = '9px monospace';
        ctx.fillText(Math.round(r*100), cx3 + 4, cy3 - R*r + 4);
      }
    });

    // Spokes
    angles.forEach(a => {
      ctx.beginPath();
      ctx.moveTo(cx3, cy3);
      ctx.lineTo(cx3 + Math.cos(a)*R, cy3 + Math.sin(a)*R);
      ctx.strokeStyle = 'rgba(0,229,255,0.15)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    });

    if(hwConnected && radarData[0].val !== null) {
      // Data polygon
      ctx.beginPath();
      radarData.forEach(({val}, i) => {
        const r = (val/100) * R;
        const x2 = cx3 + Math.cos(angles[i]) * r;
        const y2 = cy3 + Math.sin(angles[i]) * r;
        i === 0 ? ctx.moveTo(x2, y2) : ctx.lineTo(x2, y2);
      });
      ctx.closePath();
      ctx.fillStyle = 'rgba(0,229,255,0.18)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,229,255,0.9)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Data points
      radarData.forEach(({val}, i) => {
        const r = (val/100) * R;
        const x2 = cx3 + Math.cos(angles[i]) * r;
        const y2 = cy3 + Math.sin(angles[i]) * r;
        ctx.beginPath();
        ctx.arc(x2, y2, 4, 0, Math.PI*2);
        ctx.fillStyle = '#00e5ff';
        ctx.fill();
        ctx.strokeStyle = '#050510';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
    } else {
      // No HW — show "No Data" in center
      ctx.fillStyle = 'rgba(255,45,85,0.5)';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('NO EEG DATA', cx3, cy3 + 2);
      ctx.fillStyle = 'rgba(80,100,120,0.6)';
      ctx.font = '10px monospace';
      ctx.fillText('Hardware not connected', cx3, cy3 + 18);
    }

    // Labels
    radarData.forEach(({label, val}, i) => {
      const lR = R + 26;
      const lx = cx3 + Math.cos(angles[i]) * lR;
      const ly = cy3 + Math.sin(angles[i]) * lR;
      ctx.fillStyle = '#b8ccdc';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(label, lx, ly);
      ctx.fillStyle = val !== null ? '#00e5ff' : '#445566';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(val !== null ? val : 'N/A', lx, ly + 14);
    });
  });

  // Cognitive load bars (right side)
  const radarW = 68, radarH = 68;
  doc.addImage(radarImg, 'PNG', margin, cy2, radarW, radarH);

  // Metric bars right of radar
  const barsX = margin + radarW + 6;
  const barsW = col - radarW - 6;
  const bColors = [C.cyan, C.green, C.amber, C.magenta, [0,150,220], C.red];

  radarData.forEach(({label, val}, i) => {
    const by = cy2 + i * (radarH / radarData.length) + 2;
    const bh = 7.5;
    setFont('normal', 5.5, C.muted);
    txt(label, barsX, by + 5);
    const numW = doc.getTextWidth(label) + 3;
    if(val !== null) {
      bar(barsX + numW, by, barsW - numW - 12, bh, val, bColors[i], [12,18,30]);
      setFont('bold', 6, bColors[i]);
      txt(val, barsX + barsW - 10, by + 6, {align:'right'});
    } else {
      bar(barsX + numW, by, barsW - numW - 12, bh, 0, bColors[i], [12,18,30]);
      setFont('bold', 5.5, C.muted);
      txt('N/A', barsX + barsW - 10, by + 6, {align:'right'});
    }
  });
  cy2 += radarH + 8;

  // ── Cognitive Load Ring info ──
  const cogLoad = hwConnected ? (parseFloat($('cogVal').textContent) || 0) : null;
  const cogState = hwConnected ? ($('cogState').textContent || 'N/A') : 'N/A — NO HARDWARE';

  sectionHeader('COGNITIVE LOAD INDEX', cy2);
  cy2 += 7;

  const ringImg = makeChartCanvas(200, 200, (ctx, cw3, ch) => {
    ctx.fillStyle = '#050510';
    ctx.fillRect(0, 0, cw3, ch);
    const cx3 = cw3/2, cy3 = ch/2, r = 70;
    const startA = -Math.PI/2;
    const endA = cogLoad !== null ? startA + (cogLoad/100) * Math.PI * 2 : startA;

    // Track
    ctx.beginPath(); ctx.arc(cx3, cy3, r, 0, Math.PI*2);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 14; ctx.stroke();

    if(cogLoad !== null) {
      const grad = ctx.createLinearGradient(cx3-r, cy3, cx3+r, cy3);
      grad.addColorStop(0, '#00e5ff'); grad.addColorStop(1, '#00ff88');
      ctx.beginPath(); ctx.arc(cx3, cy3, r, startA, endA);
      ctx.strokeStyle = grad; ctx.lineWidth = 14; ctx.lineCap = 'round'; ctx.stroke();
    }

    ctx.fillStyle = cogLoad !== null ? '#b8ccdc' : '#445566';
    ctx.font = 'bold 28px monospace'; ctx.textAlign = 'center';
    ctx.fillText(cogLoad !== null ? cogLoad.toFixed(1) : 'N/A', cx3, cy3 + 5);
    ctx.fillStyle = '#445566'; ctx.font = '11px monospace';
    ctx.fillText('COG LOAD', cx3, cy3 + 22);
  });
  doc.addImage(ringImg, 'PNG', margin, cy2, 38, 38);

  setFont('bold', 12, hwConnected ? C.green : C.muted);
  txt(cogState, margin + 44, cy2 + 16);
  setFont('normal', 7, C.muted);
  if(hwConnected) {
    txt('Current cognitive state classification based on combined', margin + 44, cy2 + 24);
    txt('EEG spectral power and oculometric engagement metrics.', margin + 44, cy2 + 30);
    setFont('bold', 7, C.cyan);
    txt(`Load Index: ${cogLoad.toFixed(1)} / 100`, margin + 44, cy2 + 38);
  } else {
    txt('EEG hardware not connected. Cognitive load data unavailable.', margin + 44, cy2 + 24);
    txt('Connect EEG hardware to acquire live cognitive metrics.', margin + 44, cy2 + 30);
    setFont('bold', 7, C.muted);
    txt('Load Index: N/A', margin + 44, cy2 + 38);
  }

  cy2 += 48;

  // ── Dominant wave / data summary ──
  const dom = hwConnected ? ($('domWave').textContent || 'N/A') : 'N/A';
  roundRect(margin, cy2, col, 14, 2, [8,14,26], C.border);
  setFont('bold', 6.5, C.muted);
  txt('DOMINANT FREQUENCY BAND:', margin + 4, cy2 + 9);
  setFont('bold', 8, hwConnected ? C.green : C.muted);
  txt(dom, margin + 64, cy2 + 9);
  setFont('normal', 6, C.muted);
  txt('DATA POINTS COLLECTED:', margin + 100, cy2 + 9);
  setFont('bold', 7.5, C.cyan);
  txt(String(dpCnt), margin + 140, cy2 + 9);
  setFont('normal', 6, C.muted);
  txt('EEG MODE:', margin + 152, cy2 + 9);
  setFont('bold', 7, hwConnected ? C.green : C.red);
  txt(hwConnected ? 'HARDWARE LIVE' : 'NO SIGNAL', margin + 170, cy2 + 9);

  // Footer
  setFont('normal', 6, C.dimmed);
  txt('NEUROMIA COGNITIVE INTELLIGENCE SYSTEM  •  CONFIDENTIAL', W/2, H - 10, {align:'center'});
  txt('Page 2 of 3', W - margin, H - 10, {align:'right'});

  // ─────────────────────────────────────────
  // PAGE 3 — SUBJECT PROFILE + OCULOMETRICS + SYSTEM INFO
  // ─────────────────────────────────────────
  doc.addPage();
  fillRect(0, 0, W, H, C.bg);

  // Header
  fillRect(0, 0, W, 18, C.panel);
  doc.setDrawColor(...C.cyan);
  doc.setLineWidth(0.4);
  doc.line(0, 18, W, 18);
  setFont('bold', 10, C.cyan);
  txt('SUBJECT PROFILE & OCULOMETRIC DATA', margin, 12);
  setFont('normal', 6.5, C.muted);
  txt(sid + '  •  ' + now.toLocaleString('en-GB', {hour12:false}), W - margin, 12, {align:'right'});

  let cy3 = 26;

  // ── Subject profile (two columns) ──
  sectionHeader('REGISTERED SUBJECT DATA', cy3);
  cy3 += 7;

  const leftCol  = margin;
  const rightCol = margin + col/2 + 3;
  const colW2    = col/2 - 3;

  // Left panel
  roundRect(leftCol, cy3, colW2, 72, 2, C.panel, C.border);
  const leftFields = [
    ['FULL NAME',    reg.fullName     || '—'],
    ['SUBJECT ID',   sid],
    ['DATE OF BIRTH',reg.dob ? new Date(reg.dob).toLocaleDateString('en-GB') : '—'],
    ['AGE',          reg.age ? reg.age + ' years' : '—'],
    ['GENDER',       reg.gender       || '—'],
    ['EMAIL',        reg.email        || '—'],
    ['PHONE',        reg.phone        || '—'],
    ['ORGANIZATION', reg.org          || '—'],
  ];
  leftFields.forEach(([lbl, val], i) => {
    const fy = cy3 + 7 + i * 8;
    setFont('normal', 5.5, C.muted);
    txt(lbl, leftCol + 4, fy);
    setFont('bold', 6.5, C.text);
    txt(val.length > 26 ? val.slice(0,25)+'…' : val, leftCol + 42, fy);
    if (i < leftFields.length - 1) hline(fy + 1.5, leftCol + 2, leftCol + colW2 - 2, [20,30,45], 0.15);
  });

  // Right panel
  roundRect(rightCol, cy3, colW2, 72, 2, C.panel, C.border);
  const rightFields = [
    ['STUDY ROLE',     reg.role            || '—'],
    ['HANDEDNESS',     reg.handedness      || '—'],
    ['PRIOR SESSIONS', (reg.priorSessions  || '0') + ' sessions'],
    ['DOM. FREQUENCY', reg.domFreq         || '—'],
    ['CONDITIONS',     reg.conditions      || 'None reported'],
    ['CONSENT - EEG',  reg.consentEEG     ? 'GRANTED ✓' : 'DENIED'],
    ['CONSENT - VIDEO',reg.consentVideo   ? 'GRANTED ✓' : 'DENIED'],
    ['REGISTERED AT',  reg.regTime         || '—'],
  ];
  rightFields.forEach(([lbl, val], i) => {
    const fy = cy3 + 7 + i * 8;
    setFont('normal', 5.5, C.muted);
    txt(lbl, rightCol + 4, fy);
    const isGranted = val.includes('GRANTED');
    const isDenied  = val.includes('DENIED');
    setFont('bold', 6.5, isGranted ? C.green : isDenied ? C.red : C.text);
    txt(val.length > 26 ? val.slice(0,25)+'…' : val, rightCol + 42, fy);
    if (i < rightFields.length - 1) hline(fy + 1.5, rightCol + 2, rightCol + colW2 - 2, [20,30,45], 0.15);
  });

  cy3 += 78;

  // ── Oculometric Data ──
  sectionHeader('OCULOMETRIC DATA — VISUAL CORTEX FEED', cy3);
  cy3 += 7;

  const ocuData = [
    { label: 'BLINK RATE',     val: lastSession ? reportText('br',' /min',1) : ($('mBlink').textContent || '0 /min'), color: C.green   },
    { label: 'GAZE STABILITY', val: lastSession ? reportText('gs','%',0)     : ($('mGaze').textContent  || '0%'),     color: C.cyan    },
    { label: 'ATTENTION',      val: lastSession ? reportText('at','%',0)     : ($('mAttn').textContent  || '0%'),     color: C.green   },
    { label: 'EYE CLOSURE',    val: lastSession ? reportText('ec','%',1)     : ($('mClose').textContent || '0%'),     color: C.cyan    },
    { label: 'TOTAL BLINKS',   val: lastSession ? String(reportValue('tb',0)): ($('mBlinkCnt').textContent || '0'),   color: C.amber   },
  ];

  const ocuCw = (col - 16) / 5;
  ocuData.forEach(({label, val, color}, i) => {
    const ox = margin + i*(ocuCw + 4);
    roundRect(ox, cy3, ocuCw, 22, 2, [8,14,24], C.border);
    setFont('normal', 5, C.muted);
    txt(label, ox + ocuCw/2, cy3 + 7, {align:'center'});
    setFont('bold', 8.5, color);
    txt(val, ox + ocuCw/2, cy3 + 16, {align:'center'});
  });
  cy3 += 30;

  // ── Oculometric timeline chart ──
  const ocuImg = makeChartCanvas(900, 100, (ctx, cw3, ch) => {
    ctx.fillStyle = '#080818';
    ctx.fillRect(0, 0, cw3, ch);

    // Grid
    ctx.strokeStyle = 'rgba(0,229,255,0.07)';
    ctx.lineWidth = 0.5;
    for (let x2 = 0; x2 <= cw3; x2 += 60)  { ctx.beginPath(); ctx.moveTo(x2,0); ctx.lineTo(x2,ch); ctx.stroke(); }
    for (let y2 = 0; y2 <= ch;  y2 += 20)   { ctx.beginPath(); ctx.moveTo(0,y2); ctx.lineTo(cw3,y2); ctx.stroke(); }

    // Attention trend line from real recorded session values only.
    const realSessions = reportSessions.slice(-60);
    ctx.beginPath(); ctx.strokeStyle = 'rgba(0,229,255,0.9)'; ctx.lineWidth = 1.8;
    if(realSessions.length > 0){
      realSessions.forEach((s, idx) => {
        const x2 = realSessions.length === 1 ? 0 : (idx / (realSessions.length - 1)) * cw3;
        const v = Math.max(0, Math.min(100, Number(s.at || 0))) / 100;
        const y2 = ch - v * ch * 0.85 - 5;
        idx===0 ? ctx.moveTo(x2,y2) : ctx.lineTo(x2,y2);
      });
    } else {
      ctx.moveTo(0, ch - 5); ctx.lineTo(cw3, ch - 5);
    }
    ctx.stroke();

    // Blink events from real recorded total-blink changes only.
    ctx.strokeStyle = 'rgba(255,0,170,0.8)'; ctx.lineWidth = 1.2;
    if(realSessions.length > 1){
      realSessions.forEach((s, idx) => {
        const prev = idx > 0 ? Number(realSessions[idx-1].tb || 0) : 0;
        if(Number(s.tb || 0) > prev){
          const x2 = (idx / (realSessions.length - 1)) * cw3;
          ctx.beginPath(); ctx.moveTo(x2, ch * 0.3); ctx.lineTo(x2, ch * 0.95); ctx.stroke();
        }
      });
    }

    // Legend
    ctx.fillStyle = 'rgba(0,229,255,0.8)'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'left';
    ctx.fillText('ATTENTION SCORE', 8, 14);
    ctx.fillStyle = 'rgba(255,0,170,0.8)';
    ctx.fillText('BLINK EVENTS', 200, 14);
    ctx.fillStyle = 'rgba(80,100,120,0.6)'; ctx.font = '9px monospace';
    ctx.fillText('TIME →', cw3 - 55, ch - 4);
  });
  roundRect(margin, cy3, col, 30, 2, [8,12,24]);
  doc.addImage(ocuImg, 'PNG', margin+1, cy3+1, col-2, 28);
  cy3 += 36;

  // ── Session Notes ──
  if (reg.notes && reg.notes !== 'None') {
    sectionHeader('SESSION NOTES', cy3);
    cy3 += 6;
    roundRect(margin, cy3, col, 18, 2, [8,14,24], C.border);
    setFont('normal', 7, C.text);
    const noteLines = doc.splitTextToSize(reg.notes, col - 8);
    noteLines.slice(0, 2).forEach((line, i) => txt(line, margin + 4, cy3 + 8 + i * 6));
    cy3 += 24;
  }

  // ── Consent Summary ──
  sectionHeader('CONSENT & COMPLIANCE RECORD', cy3);
  cy3 += 7;

  const consents = [
    { label:'EEG DATA COLLECTION',     granted: reg.consentEEG },
    { label:'VIDEO / OCULOMETRIC',     granted: reg.consentVideo },
    { label:'ANONYMIZED RESEARCH USE', granted: reg.consentResearch },
    { label:'EXPORT & SHARING',        granted: reg.consentExport },
  ];
  const ccw = (col - 9) / 4;
  consents.forEach(({label, granted}, i) => {
    const cx4 = margin + i * (ccw + 3);
    roundRect(cx4, cy3, ccw, 18, 2, granted ? [0,30,20] : [25,8,12], granted ? [0,80,50] : [80,20,30]);
    setFont('bold', 7, granted ? C.green : C.red);
    txt(granted ? '✓' : '✗', cx4 + ccw/2, cy3 + 8, {align:'center'});
    setFont('normal', 5, granted ? C.green : C.red);
    txt(label, cx4 + ccw/2, cy3 + 14, {align:'center'});
  });
  cy3 += 26;

  // Digital signature
  if (reg) {
    roundRect(margin, cy3, col, 16, 2, [6,10,20], C.border);
    setFont('normal', 6, C.muted);
    txt('DIGITAL SIGNATURE:', margin + 4, cy3 + 10);
    setFont('bold', 8, C.cyan);
    txt(reg.fullName || '—', margin + 46, cy3 + 10);
    setFont('normal', 5.5, C.muted);
    txt('Signed at registration  •  ' + (reg.regTime || '—'), W - margin - 4, cy3 + 10, {align:'right'});
    cy3 += 22;
  }

  // ── Data Integrity & Experiment Quality ──
  sectionHeader('DATA INTEGRITY & EXPERIMENT QUALITY', cy3);
  cy3 += 7;

  const integrityScore  = (typeof getExperimentIntegrityScore === 'function') ? getExperimentIntegrityScore() : 0;
  const camQualScore    = (typeof latestQualityScore !== 'undefined') ? latestQualityScore : 0;
  const camQualLabel    = (typeof latestQualityLabel !== 'undefined') ? latestQualityLabel : 'UNKNOWN';
  const qualWarn        = integrityScore < 80;
  const qualColor       = integrityScore >= 90 ? C.green : integrityScore >= 80 ? C.amber : C.red;
  const camColor        = camQualScore  >= 90 ? C.green : camQualScore  >= 70 ? C.amber : C.red;

  // Background panel
  roundRect(margin, cy3, col, 32, 2, qualWarn ? [25,8,12] : [8,14,24], qualWarn ? [80,20,30] : C.border);

  // Experiment Integrity Score
  setFont('normal', 5.5, C.muted);
  txt('EXPERIMENT INTEGRITY SCORE', margin + 4, cy3 + 8);
  setFont('bold', 9, qualColor);
  txt(integrityScore.toFixed(1) + ' / 100', margin + 4, cy3 + 17);

  // Camera Quality Score
  setFont('normal', 5.5, C.muted);
  txt('CAMERA QUALITY SCORE', margin + 55, cy3 + 8);
  setFont('bold', 9, camColor);
  txt(camQualScore.toFixed(1) + ' / 100', margin + 55, cy3 + 17);

  // Quality Label
  setFont('normal', 5.5, C.muted);
  txt('QUALITY LABEL', margin + 106, cy3 + 8);
  setFont('bold', 8, camColor);
  txt(camQualLabel, margin + 106, cy3 + 17);

  // Calibration status
  const calReady = (window.ScientificCalibrator && window.ScientificCalibrator.calibrated);
  setFont('normal', 5.5, C.muted);
  txt('BASELINE CALIBRATOR', margin + 145, cy3 + 8);
  setFont('bold', 7.5, calReady ? C.green : C.amber);
  txt(calReady ? 'CALIBRATED ✓' : 'COLLECTING…', margin + 145, cy3 + 17);

  // Quality warning badge
  if (qualWarn) {
    roundRect(W - margin - 42, cy3 + 2, 40, 12, 2, [60,10,18], [180,30,50]);
    setFont('bold', 6.5, C.red);
    txt('⚠  LOW INTEGRITY', W - margin - 40, cy3 + 10);
  } else {
    roundRect(W - margin - 38, cy3 + 2, 36, 12, 2, [0,25,15], [0,80,50]);
    setFont('bold', 6.5, C.green);
    txt('✓  INTEGRITY OK', W - margin - 36, cy3 + 10);
  }

  // Quality events from event markers
  const qEvents = (window._recordingEventMarkers || []).filter(e =>
    e.event && (e.event.toLowerCase().includes('quality') || e.event.toLowerCase().includes('face_lost'))
  );
  if (qEvents.length > 0) {
    setFont('normal', 5.5, C.red);
    txt('QUALITY EVENTS: ' + qEvents.map(e => e.event).join('  •  '), margin + 4, cy3 + 27);
  } else {
    setFont('normal', 5.5, C.green);
    txt('No quality interruptions recorded during this session.', margin + 4, cy3 + 27);
  }

  cy3 += 38;

  // ── System Info ──
  sectionHeader('SYSTEM INFORMATION', cy3);
  cy3 += 7;

  roundRect(margin, cy3, col, 24, 2, C.panel, C.border);
  const sysInfo = [
    ['SYSTEM',       'NEUROMIA v3.1 — Neural Cognitive Intelligence Platform'],
    ['EEG STATUS',   hwConnected ? 'HARDWARE CONNECTED — Live Acquisition Active' : 'NO HARDWARE — Device Not Connected'],
    ['CHANNELS',     hwConnected ? 'Fp1, Fp2, C3, C4  ·  Sample Rate: 256 Hz' : 'N/A — Hardware required for channel data'],
    ['BRAIN MODEL',  'Procedural 3D Gyri/Sulci  ·  6 Cortical Regions Mapped'],
  ];
  sysInfo.forEach(([lbl, val], i) => {
    const fy = cy3 + 6 + i * 5;
    setFont('bold', 5.5, C.muted);
    txt(lbl + ':', margin + 4, fy);
    setFont('normal', 5.5, C.text);
    txt(val, margin + 34, fy);
  });

  // Footer bar
  fillRect(0, H - 16, W, 16, [6, 6, 18]);
  doc.setDrawColor(...C.cyan);
  doc.setLineWidth(0.3);
  doc.line(0, H - 16, W, H - 16);
  setFont('normal', 5.5, C.dimmed);
  txt('NEUROMIA COGNITIVE INTELLIGENCE SYSTEM  •  CONFIDENTIAL  •  FOR AUTHORIZED PERSONNEL ONLY', W/2, H - 8, {align:'center'});
  txt('Page 3 of 3', W - margin, H - 8, {align:'right'});
  setFont('bold', 6, C.cyan);
  txt('NEUROMIA', margin, H - 8);

  // ── Save ──
  const filename = `NEUROMIA_Report_${sid}_${now.toISOString().slice(0,10)}.pdf`;
  doc.save(filename);

  toast('PDF EXPORTED', `${filename} downloaded`, 'ok');
  addAlert(`Full session PDF report exported: ${filename}`, 'ok');
}

// ═══════════════════════════════════════════════════════════════