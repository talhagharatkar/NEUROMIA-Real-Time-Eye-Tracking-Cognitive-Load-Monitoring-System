// ═══════════════════════════════════════════
// NEUROMIA BACKEND CONNECTOR
// ═══════════════════════════════════════════
(function() {
  let ws = null;
  let retryTimer = null;
  let isConnecting = false;

  function initBackendConnector() {
    console.log('[Backend] Initializing connector...');
    
    // Append RF Status row to futuristic-overlay HUD if it exists
    const hud = $('f_overlay');
    if (hud && !$('f_rf_row')) {
      const row = document.createElement('div');
      row.className = 'ui-row';
      row.id = 'f_rf_row';
      row.innerHTML = `<span>RF Load (Backend)</span> <span class="ui-val" id="f_rf">OFFLINE</span>`;
      hud.appendChild(row);
    }
    
    // Connect websocket
    connectWebSocket();
    
    // Override registration submit to notify backend
    const originalSubmit = window.submitRegistration;
    if (originalSubmit) {
      window.submitRegistration = function() {
        originalSubmit();
        if (window.regData) {
          startBackendSession(window.regData);
        }
      };
    }
    
    // Override stop manual session to notify backend
    const originalStop = window.stopManualSessionNow;
    if (originalStop) {
      window.stopManualSessionNow = function() {
        originalStop();
        stopBackendSession();
      };
    }
  }

  function connectWebSocket() {
    if (ws || isConnecting) return;
    isConnecting = true;
    
    const url = 'ws://localhost:8000/ws/stream';
    console.log(`[Backend] Connecting to ${url}...`);
    
    try {
      ws = new WebSocket(url);
      
      ws.onopen = () => {
        isConnecting = false;
        console.log('[Backend] WebSocket connection established.');
        const rfVal = $('f_rf');
        if (rfVal) {
          rfVal.textContent = 'CONNECTED';
          rfVal.className = 'ui-val';
        }
        toast('BACKEND ONLINE', 'Random Forest stream connected', 'ok');
        
        // If we already have registration data, start the backend session too
        if (window.regData) {
          startBackendSession(window.regData);
        }
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.status === 'success') {
            updateRFUI(data.prediction, data.confidence);
          } else if (data.status === 'unavailable') {
            const rfVal = $('f_rf');
            if (rfVal) {
              rfVal.textContent = 'NO RF MODEL';
              rfVal.className = 'ui-val red';
            }
          }
        } catch (e) {
          console.error('[Backend] Error parsing message:', e);
        }
      };
      
      ws.onerror = (err) => {
        isConnecting = false;
        const rfVal = $('f_rf');
        if (rfVal) {
          rfVal.textContent = 'OFFLINE';
          rfVal.className = 'ui-val red';
        }
      };
      
      ws.onclose = () => {
        ws = null;
        isConnecting = false;
        const rfVal = $('f_rf');
        if (rfVal) {
          rfVal.textContent = 'OFFLINE';
          rfVal.className = 'ui-val red';
        }
        // Auto-retry connection
        if (!retryTimer) {
          retryTimer = setTimeout(() => {
            retryTimer = null;
            connectWebSocket();
          }, 5000);
        }
      };
    } catch (e) {
      isConnecting = false;
      console.error('[Backend] Failed to initialize WebSocket:', e);
    }
  }

  function startBackendSession(reg) {
    const payload = {
      subject_id: reg.subjectId || 'P001',
      session_id: String(reg.sessionId || 1),
      age: reg.age || 25,
      gender: reg.gender || 'Unknown',
      glasses: reg.glasses || 'No'
    };
    
    fetch('http://localhost:8000/api/session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        console.log('[Backend] Session started:', data);
        toast('BACKEND SESSION START', `Session ${payload.session_id} active`, 'ok');
      }
    })
    .catch(err => {
      console.error('[Backend] Error starting session:', err);
    });
  }

  function stopBackendSession() {
    fetch('http://localhost:8000/api/session/stop', {
      method: 'POST'
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        console.log('[Backend] Session stopped:', data);
        toast('BACKEND SESSION END', 'Session recorded & closed', 'info');
        
        // Trigger model training automatically to improve accuracy over time!
        trainBackendModel();
      }
    })
    .catch(err => {
      console.error('[Backend] Error stopping session:', err);
    });
  }

  function trainBackendModel() {
    console.log('[Backend] Triggering auto-training...');
    fetch('http://localhost:8000/api/training/train', {
      method: 'POST'
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        toast('MODEL RE-TRAINED', `Accuracy: ${(data.metrics.accuracy * 100).toFixed(1)}%`, 'ok');
        console.log('[Backend] Training completed:', data.metrics);
      } else {
        console.log('[Backend] Training unavailable:', data.error);
      }
    })
    .catch(err => {
      console.error('[Backend] Error during training:', err);
    });
  }

  function updateRFUI(pred, conf) {
    const rfVal = $('f_rf');
    if (!rfVal) return;
    
    let label = 'LOW';
    let colorClass = 'ui-val';
    
    if (pred === 1) {
      label = 'MODERATE';
      colorClass = 'ui-val';
    } else if (pred === 2) {
      label = 'HIGH';
      colorClass = 'ui-val red';
    } else if (pred === 3) {
      label = 'SHOCK';
      colorClass = 'ui-val red';
    }
    
    rfVal.textContent = `${label} (${(conf * 100).toFixed(0)}%)`;
    rfVal.className = colorClass;
  }

  // Periodically stream frame metrics if camera is running
  function startStreamingLoop() {
    setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN && window.isRecording) {
        const oculo = window.OculoHistory ? window.OculoHistory.getCurrentOculoFeatures() : null;
        if (!oculo) return;
        
        const payload = {
          timestamp: Date.now(),
          session_id: window.regData ? String(window.regData.sessionId) : '1',
          ear_l: oculo.left_ear || 0.0,
          ear_r: oculo.right_ear || 0.0,
          ear_avg: oculo.combined_ear || 0.0,
          blink_count: oculo.combined_true_blink_count || 0,
          blink_duration: oculo.combined_blink_duration_ms || 0.0,
          blink_frequency: oculo.combined_blink_frequency || 0.0,
          avg_blink_duration: oculo.combined_avg_blink_duration_ms || 0.0,
          inter_blink_interval: oculo.combined_inter_blink_interval_ms || 0.0,
          perclos: oculo.combined_perclos || 0.0,
          eye_closure_pct: oculo.combined_eye_closure_pct || 0.0,
          yaw: oculo.combined_yaw || 0.0,
          pitch: oculo.combined_pitch || 0.0,
          roll: oculo.combined_roll || 0.0,
          mouth_aspect_ratio: oculo.combined_mouth_aspect_ratio || 0.0,
          face_confidence: oculo.camera_quality_score || 90.0,
          fps: oculo.fps || 30.0,
          cognitive_load_label: oculo.neural_cognitive_load || 0.0
        };
        
        ws.send(JSON.stringify(payload));
      }
    }, 1000); // stream every 1 second during active recording
  }

  window.addEventListener('DOMContentLoaded', () => {
    initBackendConnector();
    startStreamingLoop();
  });
})();
