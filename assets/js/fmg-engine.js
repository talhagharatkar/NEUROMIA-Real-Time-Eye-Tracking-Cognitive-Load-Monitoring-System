// FMG ENGINE — Facial Muscle Group Real-Time Analysis
// 10 indices from MediaPipe 468-pt landmarks | 8 emotion states | zero fake data
// ════════════════════════════════════════════════════════════════════════════
const FMGEngine = (() => {
  // Landmark indices
  const BROW_L     = [70,63,105,66,107];
  const BROW_R     = [300,293,334,296,336];
  const BROW_INN_L = 55, BROW_INN_R = 285;
  const EYE_L_PTS  = [159,145,33,133,153,144];
  const EYE_R_PTS  = [386,374,263,362,380,373];
  const MOUTH_L=61, MOUTH_R=291, LIP_UP=13, LIP_DN=14;
  const FACE_L=234, FACE_R=454;
  const JAW_L=172,  JAW_R=397;
  const CHEEK_L=123, CHEEK_R=352;
  const NOSE_L=131,  NOSE_R=358;
  const NOSE_TIP=4, CHIN=152, FOREHEAD=10;

  let bl=null, blBuf=[], calibrated=false;
  // 45s @ ~30fps — matches the personal-baseline duration used for the EAR
  // adaptive threshold (see Neuromia_Scientific_Redesign.md Section 3).
  // Was 60 frames (~2s), far too short for a stable facial-muscle baseline.
  const BL_FRAMES=1350;
  let mefBuf=[], mefCount=0, mefMinStart=Date.now(), lastMEF=0;
  let latest={};

  const f=(lm,i,W,H)=>{const p=lm[i];return p?{x:p.x*W,y:p.y*H}:{x:0,y:0};};
  const d=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const avg=(lm,arr,W,H)=>{const pts=arr.map(i=>f(lm,i,W,H));return{x:pts.reduce((s,p)=>s+p.x,0)/pts.length,y:pts.reduce((s,p)=>s+p.y,0)/pts.length};};
  const c01=v=>Math.max(0,Math.min(1,isFinite(v)?v:0));
  const setEl=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  const setW=(id,pct)=>{const e=document.getElementById(id);if(e)e.style.width=Math.round(Math.min(100,Math.max(0,pct*100)))+'%';};
  const setC=(id,col)=>{const e=document.getElementById(id);if(e)e.style.color=col;};

  function extractRaw(lm,W,H){
    const fL=f(lm,FACE_L,W,H),fR=f(lm,FACE_R,W,H);
    const fW=Math.max(d(fL,fR),1);
    const bLC=avg(lm,BROW_L,W,H),bRC=avg(lm,BROW_R,W,H);
    const eLC=avg(lm,EYE_L_PTS,W,H),eRC=avg(lm,EYE_R_PTS,W,H);
    const browEyeDist=(Math.abs(bLC.y-eLC.y)+Math.abs(bRC.y-eRC.y))/2/fW;
    const iBL=f(lm,BROW_INN_L,W,H),iBR=f(lm,BROW_INN_R,W,H);
    const innerBrowDist=d(iBL,iBR)/fW;
    const jL=f(lm,JAW_L,W,H),jR=f(lm,JAW_R,W,H);
    const cL=f(lm,CHEEK_L,W,H),cR=f(lm,CHEEK_R,W,H);
    const jawW=d(jL,jR)/fW, cheekW=d(cL,cR)/fW;
    const mL=f(lm,MOUTH_L,W,H),mR=f(lm,MOUTH_R,W,H);
    const lU=f(lm,LIP_UP,W,H),lD=f(lm,LIP_DN,W,H);
    const mouthSpread=d(mL,mR)/fW;
    const lipH=d(lU,lD)/fW, lipW=d(mL,mR)/fW;
    const nL=f(lm,NOSE_L,W,H),nR=f(lm,NOSE_R,W,H);
    const noseDist=d(nL,nR)/fW;
    const nT=f(lm,NOSE_TIP,W,H),ch=f(lm,CHIN,W,H),fo=f(lm,FOREHEAD,W,H);
    const fCX=(fL.x+fR.x)/2, fCY=(fo.y+ch.y)/2;
    const fH=Math.max(Math.abs(ch.y-fo.y),1);
    const yaw=(nT.x-fCX)/fW, pitch=(nT.y-fCY)/fH;
    const roll=Math.atan2(eRC.y-eLC.y,eRC.x-eLC.x);
    return{browEyeDist,innerBrowDist,jawW,cheekW,mouthSpread,lipH,lipW,noseDist,yaw,pitch,roll};
  }

  function buildBaseline(raw){
    blBuf.push({...raw});
    if(blBuf.length<BL_FRAMES)return;
    const av=k=>blBuf.reduce((s,b)=>s+b[k],0)/blBuf.length;
    const sd=(k,mean)=>{
      const variance=blBuf.reduce((s,b)=>s+(b[k]-mean)*(b[k]-mean),0)/Math.max(1,blBuf.length-1);
      return Math.sqrt(variance)||1e-6; // floor avoids div-by-zero on a perfectly static signal
    };
    const keys=['browEyeDist','innerBrowDist','jawW','cheekW','mouthSpread','lipH','lipW','noseDist'];
    const mean={}, std={};
    keys.forEach(k=>{ mean[k]=av(k); std[k]=sd(k,mean[k]); });
    bl={...mean, std};
    calibrated=true; blBuf=[];
    const badge=document.getElementById('fmgBaselineBadge');
    if(badge){badge.className='fmg-baseline-badge ready';badge.innerHTML='<i class="fas fa-check" style="font-size:.5rem;"></i> BASELINE CALIBRATED';}
    if(typeof addAlert==='function') addAlert('FMG Baseline calibrated — facial muscle monitoring ACTIVE (10 indices)','ok');
  }

  // Every AU-proxy activation below uses ONE consistent, documented rule
  // instead of a different hand-picked multiplier per signal:
  //   z = (raw - personalMean) / personalStd
  //   activation = clamp( (|z| - NOISE_FLOOR_Z) / (SATURATION_Z - NOISE_FLOOR_Z), 0, 1 )
  // NOISE_FLOOR_Z = 1.0 SD: deviations this small are treated as measurement
  // jitter, not a real facial action — this is the same adaptive-threshold
  // logic used for the EAR blink threshold elsewhere in this file, applied
  // consistently here instead of ad hoc constants.
  // SATURATION_Z = 4.0 SD: a deviation this large from a person's own resting
  // baseline is treated as a fully-expressed action. Both are calibration
  // parameters that should be validated against labeled expression data
  // (Section 11 of Neuromia_Scientific_Redesign.md) before being trusted as
  // measurement rather than a reasonable, symmetric starting heuristic.
  const NOISE_FLOOR_Z = 1.0;
  const SATURATION_Z  = 4.0;
  function zActivation(z) {
    const az = Math.abs(z);
    return c01((az - NOISE_FLOOR_Z) / (SATURATION_Z - NOISE_FLOOR_Z));
  }

  function computeIndices(raw){
    if(!bl)return null;
    const safe=b=>Math.max(b,1e-5);
    const z=(k)=>{
      if (window.ScientificCalibrator && window.ScientificCalibrator.calibrated) {
        return window.ScientificCalibrator.normalize(k, raw[k], 'robust');
      }
      return (raw[k]-bl[k])/safe(bl.std[k]);
    };

    // 1. FAI — Frontalis eyebrow raise. Signed: positive = brow raised
    // above personal baseline. NOTE: no offset — a neutral face (z≈0)
    // now correctly reads ~0, not a fabricated 35% floor.
    const zBrowEye = z('browEyeDist');
    const FAI = (raw.browEyeDist-bl.browEyeDist)/safe(bl.browEyeDist); // signed ratio, kept for display
    const fai_pct = zBrowEye > 0 ? zActivation(zBrowEye) : 0; // only a RAISE counts as frontalis activity

    // 2. CBI — Corrugator brow furrow (inner brow squeeze — distance shrinks)
    const zInnerBrow = z('innerBrowDist');
    const CBI_raw = raw.innerBrowDist/safe(bl.innerBrowDist);
    const CBI_furrow = zInnerBrow < 0 ? zActivation(zInnerBrow) : 0; // only a DECREASE is furrowing

    // 3. JCI — Masseter jaw clench (jaw narrows vs baseline)
    const zJaw = z('jawW');
    const JCI_raw = raw.jawW/safe(bl.jawW);
    const JCI_clench = zJaw < 0 ? zActivation(zJaw) : 0;

    // 4. SmileIndex — Zygomaticus mouth corner spread (widens on a smile)
    const zMouthSpread = z('mouthSpread');
    const SmileIndex = raw.mouthSpread/safe(bl.mouthSpread);
    const smile_score = zMouthSpread > 0 ? zActivation(zMouthSpread) : 0;

    // 5. LPI — Orbicularis Oris lip pucker (lip width narrows relative to height)
    const LPI_raw = raw.lipW/safe(raw.lipH);
    const LPI_bl  = bl.lipW/safe(bl.lipH);
    const LPI = LPI_raw/safe(LPI_bl);
    // No personal SD exists for this derived ratio (it's a ratio-of-ratios,
    // not one of the 8 raw baseline signals), so it's gated against the lip
    // width z-score directly instead of inventing a new derived-SD estimate.
    const pucker_score = (LPI < 1 && zMouthSpread < 0) ? zActivation(z('lipW')) : 0;

    // 6. MAR — Mouth Opening Ratio (absolute geometric ratio, kept for display)
    const MAR = raw.lipH/safe(raw.lipW);
    // Mouth-open ACTIVATION is baseline-relative like the other signals
    // (mouth opening height increasing from personal resting state), so it
    // uses the same z-score gate instead of an arbitrary absolute *5 scale.
    const zLipH = z('lipH');
    const mouth_open_score = zLipH > 0 ? zActivation(zLipH) : 0;

    // 7. CCI — Buccinator cheek compress
    const zCheek = z('cheekW');
    const CCI_raw = raw.cheekW/safe(bl.cheekW);
    const cheek_compress = zCheek < 0 ? zActivation(zCheek) : 0;

    // 8. NWI — Levator Labii nose wrinkle
    const zNose = z('noseDist');
    const NWI_raw = raw.noseDist/safe(bl.noseDist);
    const nose_wrinkle = zNose < 0 ? zActivation(zNose) : 0;

    // 9. HPS — absolute head-pose deviation from forward-facing (0,0,0), in
    // an approximate degrees-like display unit. This is NOT baseline-relative
    // (a person's baseline pose IS roughly forward-facing already) and is
    // used for data-validity/attention checks, not as an emotion AU proxy.
    const HPS=Math.sqrt(raw.yaw**2+raw.pitch**2+raw.roll**2)*28;

    return{FAI,fai_pct,CBI_raw,CBI_furrow,JCI_raw,JCI_clench,
           SmileIndex,smile_score,LPI,pucker_score,MAR,
           CCI_raw,cheek_compress,NWI_raw,nose_wrinkle,HPS,
           _z:{browEye:zBrowEye,innerBrow:zInnerBrow,jaw:zJaw,mouthSpread:zMouthSpread,cheek:zCheek,nose:zNose}};
  }

  function detectMEF(fai,cbi,smile){
    const now=Date.now();
    mefBuf.push({t:now,fai,cbi,smile});
    mefBuf=mefBuf.filter(h=>now-h.t<3000);
    // Spike detection: mid value deviates >0.06 from surrounding average
    if(mefBuf.length>=7){
      const n=mefBuf.length-1;
      for(const key of['fai','cbi','smile']){
        const mid=mefBuf[n-3][key];
        const surr=((mefBuf[n-6]||mefBuf[0])[key]+(mefBuf[n-5]||mefBuf[0])[key]+(mefBuf[n-2][key])+mefBuf[n-1][key])/4;
        if(Math.abs(mid-surr)>0.055){mefCount++;break;}
      }
    }
    const elapsed=(now-mefMinStart)/60000;
    if(now-mefMinStart>60000){lastMEF=mefCount;mefCount=0;mefMinStart=now;}
    return elapsed>0?mefCount/Math.max(elapsed,0.017):lastMEF;
  }

  function inferEmotions(idx,MEF){
    const fa=c01(idx.fai_pct);
    const fu=c01(idx.CBI_furrow*1.6);
    const cl=c01(idx.JCI_clench*1.2);
    const sm=c01(idx.smile_score*2.5);
    const pk=c01(idx.pucker_score*2.5);
    const ma=c01(idx.MAR*5);
    const hw=c01(idx.HPS/35);
    const mf=c01(MEF/7);
    return{
      Joy:         c01(sm*0.60+(1-fu)*0.20+(1-cl)*0.10+(1-ma)*0.10),
      Neutral:     c01((1-sm)*0.30+(1-fu)*0.25+(1-fa)*0.25+(1-ma)*0.20),
      Stress:      c01(fu*0.30+cl*0.30+mf*0.20+hw*0.20),
      Frustration: c01(fu*0.45+(1-sm)*0.30+cl*0.25),
      Confusion:   c01(pk*0.40+fu*0.25+fa*0.20+hw*0.15),
      Fatigue:     c01(ma*0.45+(1-sm)*0.20+hw*0.15+cl*0.10+(1-fa)*0.10),
      Anxiety:     c01(cl*0.35+fa*0.25+fu*0.25+mf*0.15),
      Surprise:    c01(fa*0.50+ma*0.25+(1-fu)*0.15+(1-cl)*0.10)
    };
  }

  function updateUI(idx,emo,MEF){
    if(!idx)return;
    // FAI
    const faiPct=Math.round(idx.fai_pct*100);
    setEl('fmgFAI',(idx.FAI>=0?'+':'')+idx.FAI.toFixed(3));
    setEl('fmgFAILabel','RAISE: '+faiPct+'%'+(faiPct>65?' ⚡':faiPct>40?' △':''));
    setW('fmgFAIFill',idx.fai_pct);
    setC('fmgFAI',faiPct>65?'var(--amber)':faiPct>40?'var(--cyan)':'var(--green)');
    document.getElementById('fmgFAIFill')&&(document.getElementById('fmgFAIFill').style.background=faiPct>65?'var(--amber)':'var(--cyan)');

    // CBI
    const fuPct=Math.round(idx.CBI_furrow*100);
    setEl('fmgCBI',idx.CBI_raw.toFixed(3));
    setEl('fmgCBILabel','FURROW: '+fuPct+'%'+(fuPct>40?' ⚠':fuPct>20?' △':''));
    setW('fmgCBIFill',idx.CBI_furrow);
    setC('fmgCBI',fuPct>40?'var(--red)':fuPct>20?'var(--amber)':'var(--green)');

    // JCI
    const jcPct=Math.round(idx.JCI_clench*100);
    setEl('fmgJCI',idx.JCI_raw.toFixed(3));
    setEl('fmgJCILabel','CLENCH: '+jcPct+'%'+(jcPct>30?' ⚠':jcPct>12?' △':''));
    setW('fmgJCIFill',idx.JCI_clench);
    setC('fmgJCI',jcPct>30?'var(--red)':jcPct>12?'var(--amber)':'var(--green)');

    // SmileIndex
    const smPct=Math.round(idx.smile_score*100);
    setEl('fmgSmile',idx.SmileIndex.toFixed(3));
    setEl('fmgSmileLabel','ACTIVE: '+smPct+'%'+(smPct>25?' 😊':''));
    setW('fmgSmileFill',idx.smile_score*2);
    setC('fmgSmile',smPct>25?'var(--green)':smPct>8?'var(--cyan)':'#556');

    // LPI
    const pkPct=Math.round(idx.pucker_score*100);
    setEl('fmgLPI',idx.LPI.toFixed(3));
    setEl('fmgLPILabel','PUCKER: '+pkPct+'%'+(pkPct>30?' 🤔':''));
    setW('fmgLPIFill',idx.pucker_score*2);
    setC('fmgLPI',pkPct>30?'var(--amber)':'var(--cyan)');

    // MAR
    const marLevel=idx.MAR>0.35?'HIGH 😮':idx.MAR>0.20?'MED':'LOW';
    setEl('fmgMAR',idx.MAR.toFixed(3));
    setEl('fmgMARLabel','OPENING: '+marLevel);
    setW('fmgMARFill',Math.min(1,idx.MAR*4));
    setC('fmgMAR',idx.MAR>0.35?'var(--red)':idx.MAR>0.20?'var(--amber)':'var(--cyan)');

    // CCI
    const ccPct=Math.round(idx.cheek_compress*100);
    setEl('fmgCCI',idx.CCI_raw.toFixed(3));
    setW('fmgCCIFill',idx.cheek_compress*3);
    setC('fmgCCI',ccPct>30?'var(--amber)':'var(--cyan)');

    // NWI
    const nwPct=Math.round(idx.nose_wrinkle*100);
    setEl('fmgNWI',idx.NWI_raw.toFixed(3));
    setW('fmgNWIFill',idx.nose_wrinkle*3);
    setC('fmgNWI',nwPct>25?'var(--magenta)':'var(--cyan)');

    // HPS
    const hpsOk=idx.HPS<15;
    setEl('fmgHPS',idx.HPS.toFixed(1));
    setW('fmgHPSFill',Math.min(1,idx.HPS/50));
    setC('fmgHPS',idx.HPS>30?'var(--red)':idx.HPS>15?'var(--amber)':'var(--green)');
    document.getElementById('fmgHPSFill')&&(document.getElementById('fmgHPSFill').style.background=idx.HPS>30?'var(--red)':idx.HPS>15?'var(--amber)':'var(--green)');

    // MEF
    setEl('fmgMEF',MEF.toFixed(1)+'/min');
    setW('fmgMEFFill',Math.min(1,MEF/10));
    setC('fmgMEF',MEF>6?'var(--red)':MEF>3?'var(--amber)':'var(--green)');

    // ── Emotions ──
    const EMO_CFG={
      Joy:        {id:'emoJoy',        col:'var(--green)'},
      Neutral:    {id:'emoNeutral',    col:'var(--cyan)'},
      Stress:     {id:'emoStress',     col:'var(--red)'},
      Frustration:{id:'emoFrustration',col:'#ff6600'},
      Confusion:  {id:'emoConfusion',  col:'var(--amber)'},
      Fatigue:    {id:'emoFatigue',    col:'var(--magenta)'},
      Anxiety:    {id:'emoAnxiety',    col:'#aa44ff'},
      Surprise:   {id:'emoSurprise',  col:'var(--cyan)'}
    };
    const EMO_ICON={Joy:'😊',Neutral:'😐',Stress:'😰',Frustration:'😤',
                    Confusion:'😕',Fatigue:'😴',Anxiety:'😟',Surprise:'😲'};
    const EMO_COL={Joy:'var(--green)',Neutral:'var(--cyan)',Stress:'var(--red)',
                   Frustration:'#ff6600',Confusion:'var(--amber)',
                   Fatigue:'var(--magenta)',Anxiety:'#aa44ff',Surprise:'var(--cyan)'};

    let domEmo='Neutral', domProb=0;
    Object.entries(emo).forEach(([name,prob])=>{
      const cfg=EMO_CFG[name]; if(!cfg)return;
      const pct=Math.round(prob*100);
      setEl(cfg.id+'Val', pct+'%');
      setC(cfg.id+'Val', cfg.col);
      setW(cfg.id+'Fill', prob);
      const fill=document.getElementById(cfg.id+'Fill');
      if(fill) fill.style.background=cfg.col;
      if(prob>domProb){domProb=prob;domEmo=name;}
    });

    // Dominant display
    setEl('domEmoIcon', EMO_ICON[domEmo]||'😐');
    setEl('domEmoName', domEmo.toUpperCase());
    setEl('domEmoConf', Math.round(domProb*100)+'%');
    setC('domEmoName', EMO_COL[domEmo]||'var(--cyan)');
    setC('domEmoConf', EMO_COL[domEmo]||'var(--cyan)');

    // Fire alert for critical states
    if(domEmo==='Fatigue'&&domProb>0.6){
      if(typeof addAlert==='function'&&(Date.now()-(_lastFatigueAlert||0))>15000){
        addAlert('FMG FATIGUE DETECTED — MAR high, possible yawning or drowsiness','crit');
        _lastFatigueAlert=Date.now();
      }
    }
    if(domEmo==='Stress'&&domProb>0.65){
      if(typeof addAlert==='function'&&(Date.now()-(_lastStressAlert||0))>20000){
        addAlert('FMG STRESS DETECTED — Brow furrow + jaw clench pattern elevated','warn');
        _lastStressAlert=Date.now();
      }
    }
  }
  let _lastFatigueAlert=0, _lastStressAlert=0;

  // ── Main entry — called every camera frame by onResults ──
  function process(lm, W, H){
    try{
      const raw=extractRaw(lm,W,H);

      // Feed Scientific Baseline Calibrator (60 seconds)
      if (window.ScientificCalibrator && !window.ScientificCalibrator.calibrated) {
        window.ScientificCalibrator.addSample(raw);
      }

      if(!calibrated){ buildBaseline(raw); return; }
      const idx=computeIndices(raw);
      if(!idx)return;
      const MEF=detectMEF(idx.fai_pct, idx.CBI_furrow, idx.smile_score);
      const emo=inferEmotions(idx, MEF);
      latest={...idx, MEF, emotions:emo};
      updateUI(idx, emo, MEF);
    }catch(e){ console.warn('FMGEngine frame error:',e); }
  }

  // Reset UI when no face detected
  function resetUI(){
    ['fmgFAI','fmgCBI','fmgJCI','fmgSmile','fmgLPI','fmgMAR','fmgCCI','fmgNWI','fmgHPS','fmgMEF'].forEach(id=>setEl(id,'—'));
    ['fmgFAIFill','fmgCBIFill','fmgJCIFill','fmgSmileFill','fmgLPIFill','fmgMARFill','fmgCCIFill','fmgNWIFill','fmgHPSFill','fmgMEFFill'].forEach(id=>setW(id,0));
    ['emoJoyVal','emoNeutralVal','emoStressVal','emoFrustrationVal','emoConfusionVal','emoFatigueVal','emoAnxietyVal','emoSurpriseVal'].forEach(id=>setEl(id,'—'));
    ['emoJoyFill','emoNeutralFill','emoStressFill','emoFrustrationFill','emoConfusionFill','emoFatigueFill','emoAnxietyFill','emoSurpriseFill'].forEach(id=>setW(id,0));
    setEl('domEmoIcon','😐'); setEl('domEmoName','NO FACE'); setEl('domEmoConf','—');
  }

  function getLatest(){ return{...latest}; }
  function isReady(){ return calibrated; }

  return{process, resetUI, getLatest, isReady};
})();

// ════════════════════════════════════════════════════════════════════════════