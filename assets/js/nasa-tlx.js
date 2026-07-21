// NASA-TLX PANEL WIRING
// ════════════════════════════════════════════
window.nasaTLXData = {};
// One entry per SAVE press — lets a participant complete several tasks
// (e.g. Easy / Medium / Hard) in one sitting and export all of them together.
window.nasaTLXHistory = [];

// ── Raw NASA-TLX → workload band ──
// Thresholds below are heuristic (not experimentally validated cutoffs).
// Adjust them once you have enough labelled sessions to calibrate against
// an independent measure (e.g. task accuracy, EEG-derived workload, etc).
function classifyRTLX(score) {
  if (score < 20)  return { label: 'RELAXED',  color: 'var(--green)', rgb: '0,255,136'  };
  if (score < 40)  return { label: 'LOW',      color: 'var(--cyan)',  rgb: '0,229,255'  };
  if (score < 70)  return { label: 'MODERATE', color: 'var(--amber)', rgb: '255,179,0'  };
  return               { label: 'HIGH',     color: 'var(--red)',   rgb: '255,45,85'  };
}
window.classifyRTLX = classifyRTLX;

(function initNasaTLX() {
  const sliders = [
    { id: 'tlx-mental',       valId: 'tlx-mental-val',      key: 'mental_demand'   },
    { id: 'tlx-physical',     valId: 'tlx-physical-val',    key: 'physical_demand' },
    { id: 'tlx-temporal',     valId: 'tlx-temporal-val',    key: 'temporal_demand' },
    { id: 'tlx-performance',  valId: 'tlx-performance-val', key: 'performance'     },
    { id: 'tlx-effort',       valId: 'tlx-effort-val',      key: 'effort'          },
    { id: 'tlx-frustration',  valId: 'tlx-frustration-val', key: 'frustration'     }
  ];

  function updateTLXOverall() {
    let sum = 0;
    sliders.forEach(s => {
      const el = document.getElementById(s.id);
      sum += el ? parseFloat(el.value) : 50;
    });
    const avg = parseFloat((sum / sliders.length).toFixed(1));
    const ov = document.getElementById('tlx-overall');
    if (ov) ov.textContent = avg.toFixed(1);

    const band = classifyRTLX(avg);
    const badge = document.getElementById('tlx-classification');
    if (badge) {
      badge.textContent = band.label;
      badge.style.color = band.color;
      badge.style.borderColor = `rgba(${band.rgb},.4)`;
      badge.style.background = `rgba(${band.rgb},.08)`;
    }
    return avg;
  }

  function renderHistory() {
    const list = document.getElementById('tlx-history-list');
    const count = document.getElementById('tlx-history-count');
    if (count) count.textContent = `${window.nasaTLXHistory.length} SAVED`;
    if (!list) return;
    if (!window.nasaTLXHistory.length) {
      list.innerHTML = '<div style="color:#334;padding:6px 0;">No ratings saved yet — rate the task below, then press SAVE TO EXPORT.</div>';
      return;
    }
    list.innerHTML = [...window.nasaTLXHistory].reverse().map((e, revIdx) => {
      const idx = window.nasaTLXHistory.length - revIdx;
      const band = classifyRTLX(e.overall_nasa_tlx);
      const time = new Date(e.saved_at).toLocaleTimeString('en-GB', { hour12: false });
      return `<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.04);">
        <span style="color:#556;">#${idx} ${e.task_type} / ${e.task_difficulty}</span>
        <span style="color:#334;">${time}</span>
        <span style="color:${band.color};">${e.overall_nasa_tlx.toFixed(1)} · ${band.label}</span>
      </div>`;
    }).join('');
  }
  window.renderNasaTLXHistory = renderHistory;

  function setupSliders() {
    sliders.forEach(s => {
      const el = document.getElementById(s.id);
      const valEl = document.getElementById(s.valId);
      if (!el) return;
      el.addEventListener('input', () => {
        if (valEl) valEl.textContent = el.value;
        updateTLXOverall();
      });
    });

    const saveBtn = document.getElementById('nasaTlxSaveBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const data = {};
        sliders.forEach(s => {
          const el = document.getElementById(s.id);
          data[s.key] = el ? parseInt(el.value) : 50;
        });
        data.task_type       = (document.getElementById('tlx-task-type')       || {}).value || 'Monitoring';
        data.task_difficulty = (document.getElementById('tlx-task-difficulty') || {}).value || 'Medium';
        data.completion_time = parseFloat((document.getElementById('tlx-completion-time') || {}).value) || 0;
        data.accuracy        = parseFloat((document.getElementById('tlx-accuracy')        || {}).value) || 0;
        data.errors           = parseInt((document.getElementById('tlx-errors')            || {}).value)  || 0;
        data.ai_prompts      = parseInt((document.getElementById('tlx-ai-prompts')        || {}).value)  || 0;
        const vals = sliders.map(s => data[s.key]);
        data.overall_nasa_tlx = parseFloat((vals.reduce((a,b)=>a+b,0) / vals.length).toFixed(2));
        data.workload_band    = classifyRTLX(data.overall_nasa_tlx).label;
        data.saved_at         = Date.now();

        window.nasaTLXData = data;                     // latest (backward-compat with existing export code)
        window.nasaTLXHistory.push({ ...data });        // full per-task log
        renderHistory();

        if (typeof toast === 'function') toast('NASA-TLX SAVED', `${data.task_type} (${data.task_difficulty}) rated ${data.overall_nasa_tlx} — ${data.workload_band}`, 'ok');
        if (typeof addAlert === 'function') addAlert('NASA-TLX ground truth saved: Overall=' + data.overall_nasa_tlx + ' (' + data.workload_band + ')', 'ok');
      });
    }
    updateTLXOverall();
    renderHistory();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupSliders);
  } else {
    setupSliders();
  }
})();


// ════════════════════════════════════════════════════════════════════════════