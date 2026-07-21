// REAL-TIME NEURAL METRICS SYSTEM
// Rule: no fake/random neural values.
// - If EEG hardware is connected, values come from ingestHardware().
// - If only webcam is active, only camera-derivable proxy metrics are shown.
// - EEG-only metrics that cannot be calculated from webcam remain 0 / NO EEG.
// ═══════════════════════════════════════════
const EEGSys=(()=>{
  let waves={delta:0,theta:0,alpha:0,beta:0,gamma:0};
  let metrics={attention:0,meditation:0,workload:0,fatigue:0,engagement:0,coherence:0};
  let dp=0;
  let hwMode=false;
  let metricSource='NO SIGNAL';
  let lastCameraMetrics={...metrics,cognitiveLoad:0,source:'NO CAMERA'};

  function clamp(v,mn=0,mx=100){return Math.max(mn,Math.min(mx,Number.isFinite(v)?v:0));}
  function numFromText(id){
    const el=$(id);
    if(!el) return 0;
    const n=parseFloat(String(el.textContent || '0').replace(/,/g,''));
    return Number.isFinite(n) ? n : 0;
  }
  function hasLiveFace(){
    try { return !!(typeof latestLM !== 'undefined' && latestLM); }
    catch(e){ return false; }
  }

  // Converts real webcam/MediaPipe oculometric values into honest cognitive proxy metrics.
  // These are NOT EEG values. They are live oculometric estimates calculated from camera landmarks.
  function updateFromCamera(){
    if(!hasLiveFace()){
      lastCameraMetrics={attention:0,meditation:0,workload:0,fatigue:0,engagement:0,coherence:0,cognitiveLoad:0,source:'NO CAMERA'};
      return lastCameraMetrics;
    }

    const attention = clamp(numFromText('mAttn'));
    const gaze      = clamp(numFromText('mGaze'));
    const perclos   = clamp(numFromText('mClose'));
    const blinkRate = clamp(numFromText('mBlink'),0,60);

    let strain=0, drift=0, fixation=0, saccade=0;
    try{
      strain   = clamp(latestOculoFeatures?.eye_strain_index || 0);
      drift    = clamp(latestOculoFeatures?.attention_drift_score || 0);
      fixation = clamp(latestOculoFeatures?.fixation_density || gaze || 0);
      saccade  = Number(latestOculoFeatures?.saccade_velocity || 0);
    }catch(e){}

    // Real webcam-derived proxies only.
    const workload = clamp((drift*0.45) + (strain*0.35) + (perclos*1.2) + (Math.abs(blinkRate-15)*0.7));
    const fatigue  = clamp((strain*0.50) + (perclos*1.7) + (Math.max(0,15-blinkRate)*1.1));
    const engagement = clamp((attention*0.50) + (fixation*0.35) + ((100-fatigue)*0.15));
    const cognitiveLoad = clamp((workload*0.45) + (fatigue*0.30) + ((100-attention)*0.25));

    // Meditation and coherence are EEG-derived in your system, so they stay zero without EEG hardware.
    lastCameraMetrics={
      attention:Math.round(attention),
      meditation:0,
      workload:Math.round(workload),
      fatigue:Math.round(fatigue),
      engagement:Math.round(engagement),
      coherence:0,
      cognitiveLoad:Number(cognitiveLoad.toFixed(1)),
      gaze:Math.round(gaze),
      perclos:Number(perclos.toFixed(1)),
      blinkRate:Number(blinkRate.toFixed(1)),
      strain:Number(strain.toFixed(1)),
      drift:Number(drift.toFixed(1)),
      saccade:Number.isFinite(saccade)?Number(saccade.toFixed(5)):0,
      source:'CAMERA OCULOMETRIC'
    };
    return lastCameraMetrics;
  }

  function update(){
    if(hwMode){
      metricSource='EEG HARDWARE';
    }else{
      const cam=updateFromCamera();
      metrics={
        attention:cam.attention,
        meditation:0,
        workload:cam.workload,
        fatigue:cam.fatigue,
        engagement:cam.engagement,
        coherence:0
      };
      waves={delta:0,theta:0,alpha:0,beta:0,gamma:0};
      metricSource=cam.source;
      if(hasLiveFace()) dp++;
    }
    renderUI();
    NeuralReportGraph.update(getMetrics());
  }

  // Feed real EEG hardware data here only.
  function ingestHardware(hwWaves,hwMetrics){
    if (hwWaves === null && hwMetrics === null) {
      hwMode = false;
      waves = {delta:0,theta:0,alpha:0,beta:0,gamma:0};
      metrics = {attention:0,meditation:0,workload:0,fatigue:0,engagement:0,coherence:0};
      metricSource = 'CAMERA OCULOMETRIC';
      renderUI();
      NeuralReportGraph.update(getMetrics());
      return;
    }
    hwMode=true;
    waves={delta:0,theta:0,alpha:0,beta:0,gamma:0,...(hwWaves||{})};
    metrics={attention:0,meditation:0,workload:0,fatigue:0,engagement:0,coherence:0,...(hwMetrics||{})};
    dp++;
    metricSource='EEG HARDWARE';
    renderUI();
    NeuralReportGraph.update(getMetrics());
    $('eegModeLbl').textContent='● HARDWARE LIVE';
    $('eegModeLbl').style.color='var(--green)';
  }

  function renderUI(){
    Object.entries(waves).forEach(([w,v])=>{
      const cap=w[0].toUpperCase()+w.slice(1);
      const e=$(`w${cap}`); if(e) e.textContent=hwMode ? Number(v||0).toFixed(1)+' μV' : '0 μV';
      const f=$(`wf${cap}`); if(f) f.style.width=hwMode ? Math.round(clamp((v/50)*100))+'%' : '0%';
    });

    const pairs=[
      ['Attn','attention','c'],['Med','meditation','g'],
      ['Work','workload','a'],['Fat','fatigue','r'],
      ['Eng','engagement',''],['Coh','coherence','c']
    ];
    pairs.forEach(([k,m])=>{
      const value=Math.round(clamp(metrics[m]));
      const bv=$(`b${k}`),bfv=$(`bf${k}`);
      if(bv) bv.textContent=value;
      if(bfv) bfv.style.width=value+'%';
    });

    let dom='NO EEG';
    if(hwMode){
      const sorted=Object.entries(waves).sort((a,b)=>(b[1]||0)-(a[1]||0));
      dom=(sorted[0] && sorted[0][1] > 0) ? sorted[0][0].toUpperCase() : 'NO EEG';
    }
    if($('domWave')) $('domWave').textContent=dom;
    if($('dpCnt')) $('dpCnt').textContent=dp;

    const load=hwMode
      ? clamp(metrics.workload*.4+metrics.fatigue*.3+(100-metrics.attention)*.3)
      : clamp(lastCameraMetrics.cognitiveLoad || 0);

    BrainViz.setLoad(load);
    $('cogVal').textContent=load.toFixed(1);
    $('cogBar').style.width=load+'%';

    let lc,ls,mc;
    if(load<=0){lc='linear-gradient(90deg,#223,#334)';ls='NO LIVE DATA';mc='c';}
    else if(load<30){lc='linear-gradient(90deg,#0044ff,#00e5ff)';ls='RELAXED';mc='c';}
    else if(load<60){lc='linear-gradient(90deg,#00e5ff,#00ff88)';ls='OPTIMAL';mc='g';}
    else if(load<80){lc='linear-gradient(90deg,#ffb300,#ff6600)';ls='ELEVATED';mc='a';}
    else{lc='linear-gradient(90deg,#ff2d55,#cc0022)';ls='OVERLOAD';mc='r';}
    $('cogBar').style.background=lc;
    $('cogState').textContent=ls;
    $('cogState').style.color=`var(--${['cyan','green','amber','red'][['c','g','a','r'].indexOf(mc)]})`;
    $('cogVal').className=`mval ${mc}`;
    const ring=$('cogRing'); if(ring) ring.style.strokeDashoffset=301-(load/100)*301;
    $('ringVal').textContent=Math.round(load)+'%';

    const sourceEl=$('neuralSource');
    if(sourceEl){
      sourceEl.textContent=hwMode ? 'EEG HARDWARE LIVE' : (hasLiveFace() ? 'REAL CAMERA OCULOMETRIC' : 'NO LIVE DATA');
      sourceEl.style.color=hwMode || hasLiveFace() ? 'var(--green)' : '#445';
    }
  }

  // No fake simulation. Buttons are retained but they no longer inject synthetic values.
  function simulate(type){
    toast('SIMULATION DISABLED','Fake neural values are disabled. Use camera or connect EEG hardware.','warn');
    addAlert('Simulation blocked — NEUROMIA is in real-data-only mode','warn');
  }

  function getMetrics(){
    return {waves:{...waves},metrics:{...metrics},camera:{...lastCameraMetrics},source:metricSource,hwMode,dp};
  }

  return{update,simulate,ingestHardware,isHWConnected:()=>hwMode,getMetrics};
})();

// ═══════════════════════════════════════════
// LIVE NEURAL REPORT GRAPH
// Shows real camera-derived proxy metrics or zeros only. No fake values.
// ═══════════════════════════════════════════
const NeuralReportGraph=(()=>{
  let chart=null;
  const labels=['Attention','Workload','Fatigue','Engagement','Meditation','Coherence','Cog Load'];
  function ensureCanvas(){
    if($('neuralReportChart')) return $('neuralReportChart');
    const rightPanel=[...document.querySelectorAll('.panel')].find(p=>p.textContent.includes('NEURAL METRICS'));
    if(!rightPanel) return null;
    const box=document.createElement('div');
    box.id='neuralReportBox';
    box.style.cssText='margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.05);';
    box.innerHTML=`
      <div class="ptitle" style="font-size:.62rem;margin-bottom:9px;"><i class="fas fa-chart-area"></i> REAL-TIME REPORT
        <span id="neuralSource" style="margin-left:auto;font-size:.55rem;color:#445;font-family:'Share Tech Mono',monospace;letter-spacing:1px;">NO LIVE DATA</span>
      </div>
      <div style="height:150px;background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.05);border-radius:8px;padding:8px;">
        <canvas id="neuralReportChart"></canvas>
      </div>
      <div style="font-family:'Share Tech Mono',monospace;font-size:.56rem;color:#445;margin-top:6px;line-height:1.45;">
        NOTE: Attention/workload/fatigue/engagement are real webcam-oculometric proxies. Meditation, coherence and EEG wave bands stay 0 until real EEG hardware is connected.
      </div>`;
    rightPanel.appendChild(box);
    return $('neuralReportChart');
  }
  function init(){
    const canvas=ensureCanvas();
    if(!canvas || chart) return;
    chart=new Chart(canvas,{type:'line',data:{labels:[],datasets:labels.map(name=>({label:name,data:[],borderWidth:1.3,pointRadius:0,tension:.35,fill:false}))},options:{responsive:true,maintainAspectRatio:false,animation:{duration:0},plugins:{legend:{display:true,labels:{color:'#667',boxWidth:8,font:{size:9,family:"'Share Tech Mono'"}}}},scales:{x:{display:false},y:{min:0,max:100,grid:{color:'rgba(255,255,255,.035)'},ticks:{color:'#334',font:{family:"'Share Tech Mono'"}}}}}});
  }
  function update(m){
    init();
    if(!chart || !m) return;
    const vals=[
      m.metrics.attention||0,
      m.metrics.workload||0,
      m.metrics.fatigue||0,
      m.metrics.engagement||0,
      m.metrics.meditation||0,
      m.metrics.coherence||0,
      m.hwMode ? clamp((m.metrics.workload||0)*.4+(m.metrics.fatigue||0)*.3+(100-(m.metrics.attention||0))*.3,0,100) : (m.camera.cognitiveLoad||0)
    ].map(v=>Number.isFinite(v)?Number(v):0);
    const lab=new Date().toLocaleTimeString('en-US',{hour12:false});
    chart.data.labels.push(lab);
    if(chart.data.labels.length>60) chart.data.labels.shift();
    chart.data.datasets.forEach((ds,i)=>{ ds.data.push(vals[i]); if(ds.data.length>60) ds.data.shift(); });
    chart.update('none');
  }
  return{init,update};
})();

// ═══════════════════════════════════════════
// EEG CHART
// ═══════════════════════════════════════════
const EEGChart=(()=>{
  let chart,data=[];
  const MAX=120;
  function init(){
    const ctx=$('eegChart');if(!ctx)return;
    for(let i=0;i<MAX;i++) data.push(0);
    chart=new Chart(ctx,{
      type:'line',
      data:{labels:Array(MAX).fill(''),datasets:[{
        data:[...data],borderColor:'#00e5ff',borderWidth:1.4,pointRadius:0,
        fill:true,backgroundColor:'rgba(0,229,255,0.05)',tension:0.45
      }]},
      options:{responsive:true,maintainAspectRatio:false,animation:{duration:0},
        plugins:{legend:{display:false}},
        scales:{x:{display:false},y:{display:true,min:-80,max:80,
          grid:{color:'rgba(255,255,255,0.035)'},
          ticks:{color:'#334',font:{family:"'Share Tech Mono'"},maxTicksLimit:5}}}}
    });
  }
  function update(w){
    if(!chart)return;
    const t=Date.now()*.001;
    // If hardware not connected (hwMode=false), show flat baseline with no signal
    const isHWConnected = EEGSys.isHWConnected && EEGSys.isHWConnected();
    let v = 0;
    if(isHWConnected){
      v=Math.sin(t*2.6)*w.beta*.75+Math.sin(t*1.1)*w.alpha*.5
        +Math.sin(t*.6)*w.theta*.38+Math.sin(t*8.2)*w.gamma*.22;
    }
    data.push(Math.max(-72,Math.min(72,v)));
    if(data.length>MAX) data.shift();
    chart.data.datasets[0].data=[...data];
    chart.update('none');
  }
  return{init,update};
})();

// ════════════════════════════════════════════════════════════════