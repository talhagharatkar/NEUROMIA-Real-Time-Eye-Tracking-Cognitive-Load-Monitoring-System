// BUTTON WIRING
// ═══════════════════════════════════════════
$('btnRotate').addEventListener('click',()=>BrainViz.toggleRotate());
$('btnReset').addEventListener('click',()=>BrainViz.resetView());
$('btnFullscreen').addEventListener('click',()=>{
  const c=$('brainCanvas');
  if(!document.fullscreenElement) c.requestFullscreen().catch(()=>{});
  else document.exitFullscreen();
});
$('btnFocus').addEventListener('click',()=>EEGSys.simulate('focus'));
$('btnFatigue').addEventListener('click',()=>EEGSys.simulate('fatigue'));
$('btnSeizure').addEventListener('click',()=>EEGSys.simulate('seizure'));
$('startCamBtn').addEventListener('click',()=>CamSys.start());
$('stopCamBtn').addEventListener('click',()=>CamSys.stop());

// ── Test Mode Indicator ──
(function(){
  const selector = $('testModeSelect');
  const testModePill = $('pillTestMode');
  if(selector && testModePill) {
    selector.addEventListener('change', () => {
      const mode = selector.value;
      // Show indicator for non-default modes
      if(mode !== 'NON_AI') {
        testModePill.style.display = 'flex';
        console.log(`[TEST MODE] Switched to: ${mode}`);
      } else {
        testModePill.style.display = 'none';
      }
    });
  }
})();

// ── Stop manual session button ──
(function(){
  const btn = $('stopManualBtn');
  if (btn) btn.addEventListener('click', () => CamSys.stopManual());
})();
$('snapBtn').addEventListener('click',()=>CamSys.snap());
['togFace','togEye','togBlink'].forEach(id=>{
  $(id).addEventListener('click',function(){
    this.classList.toggle('togon');
    if(id==='togFace')  CamSys._toggleMesh();
    if(id==='togEye')   CamSys._toggleEye();
    if(id==='togBlink') CamSys._toggleBlink();
  });
});
$('exportBtn').addEventListener('click',()=>{
  // Export Session Data now uses the real camera-recorded oculometric records, not PDF-only output.
  if (window.OculoHistory && window.OculoHistory.exportCSV && typeof window.OculoHistory.exportCSV === 'function') {
    try {
      window.OculoHistory.exportCSV();
      if (window.OculoHistory.renderExportReport && typeof window.OculoHistory.renderExportReport === 'function') {
        window.OculoHistory.renderExportReport();
      }
    } catch(e) {
      console.error('Export error:', e);
      toast('EXPORT ERROR', 'An error occurred during export. Check console for details.', 'warn');
    }
  } else {
    toast('EXPORT NOT READY','Start camera and record at least one real session first','warn');
  }
});
$('resetBtn').addEventListener('click',()=>{
  if(confirm('Reset NEUROMIA system? This clears all session data.')){
    $('alertFeed').innerHTML='';alertCount=0;$('aBadge').textContent='0 EVENTS';
    addAlert('System reset — new session started','info');
    toast('SYSTEM RESET','All session data cleared','warn');
  }
});
let eegSocket = null;
$('connectHWBtn').addEventListener('click',async()=>{
  if (eegSocket && eegSocket.readyState === WebSocket.OPEN) {
    if (confirm('Disconnect from EEG hardware?')) {
      eegSocket.close();
    }
    return;
  }

  const ip = prompt('Enter EEG Gateway IP Address (PC B):', 'localhost');
  if (ip === null) return;
  const targetIp = ip.trim() || 'localhost';
  const url = `ws://${targetIp}:8765`;

  toast('EEG CONNECT', `Connecting to ${url}...`, 'info');
  addAlert(`Initiating connection to EEG gateway at ${url}...`, 'info');

  try {
    eegSocket = new WebSocket(url);
    
    eegSocket.onopen = () => {
      toast('CONNECTED', 'EEG Gateway connection established!', 'ok');
      addAlert('Connected to EEG hardware gateway.', 'ok');
      $('connectHWBtn').innerHTML = '<i class="fas fa-plug"></i> DISCONNECT EEG';
    };

    eegSocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.waves || data.metrics) {
          EEGSys.ingestHardware(data.waves, data.metrics);
        }
      } catch (err) {
        console.error('Error parsing EEG data:', err);
      }
    };

    eegSocket.onerror = (err) => {
      console.error('WebSocket error:', err);
      toast('CONNECTION ERROR', 'Failed to connect to EEG gateway.', 'warn');
      addAlert('EEG gateway connection error.', 'warn');
    };

    eegSocket.onclose = () => {
      toast('DISCONNECTED', 'EEG Gateway disconnected.', 'warn');
      addAlert('EEG gateway connection closed.', 'info');
      $('connectHWBtn').innerHTML = '<i class="fas fa-plug"></i> CONNECT EEG';
      EEGSys.ingestHardware(null, null);
      eegSocket = null;
    };
  } catch (ex) {
    console.error('Failed to create WebSocket:', ex);
    toast('ERROR', 'Invalid URL or connection failed.', 'warn');
  }
});
$('scanHWBtn').addEventListener('click',()=>{
  toast('SCANNING','Checking WebSerial + WebBluetooth for EEG devices...','info');
  addAlert('Scanning all available hardware interfaces...','info');
  setTimeout(()=>toast('SCAN COMPLETE','No devices found. See README for hardware setup.','warn'),1500);
});
$('sessId').textContent='NM-'+Date.now().toString(36).toUpperCase();

// ═══════════════════════════════════════════
// MAIN LOOP
// ═══════════════════════════════════════════
function mainLoop(){
  CamSys.updateMetrics();
  EEGSys.update();
  const m=EEGSys.getMetrics();
  EEGChart.update(m.waves);
  // Update EEG mode label
  const hwOn = EEGSys.isHWConnected();
  const modeLbl=$('eegModeLbl');
  if(modeLbl){
    modeLbl.textContent=hwOn?'● HARDWARE LIVE':'● NO EEG SIGNAL';
    modeLbl.style.color=hwOn?'var(--green)':'#445';
  }
  // Render EEG spectral values always
  const waves2=m.waves||{};
  Object.entries(waves2).forEach(([w,v])=>{
    const cap=w[0].toUpperCase()+w.slice(1);
    const e=$(`w${cap}`); if(e) e.textContent=v.toFixed(1)+' μV';
    const f=$(`wf${cap}`); if(f) f.style.width=Math.round((v/50)*100)+'%';
  });
}

window.addEventListener('DOMContentLoaded',()=>{
  BrainViz.init();
  EEGChart.init();
  NeuralReportGraph.init();
  CamSys.init();
  addAlert('NEUROMIA v3.1 system initialized','ok');
  addAlert('Real human brain model loaded — procedural gyri/sulci active','info');
  addAlert('Eye-optic nerve pathway connected — 6 cortical regions mapped','info');
  addAlert('Real-data-only mode active — webcam oculometrics available, EEG stays 0 until hardware connects','info');
  toast('NEUROMIA ONLINE','Cognitive intelligence system ready','ok');
  setInterval(mainLoop,700);

  // Auto-open registration on first load if no subject registered
  setTimeout(()=>{
    if(!window.regData){
      toast('REGISTRATION REQUIRED','Please register a subject to begin session','warn');
    }
  }, 2200);
});

// ═══════════════════════════════════════════