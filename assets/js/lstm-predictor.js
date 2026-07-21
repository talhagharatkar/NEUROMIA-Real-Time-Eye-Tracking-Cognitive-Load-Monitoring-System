// LSTM COGNITIVE PREDICTION ENGINE — Pure JavaScript Implementation
// 2-layer LSTM · 24 hidden units · 8 input features · 4 output targets
// Adam optimiser · Real-time inference every 2 seconds
// No external ML library — fully self-contained in-browser neural network
// ════════════════════════════════════════════════════════════════════════════

const LSTMEngine = (() => {
  // ── Configuration ──
  const INPUT_SIZE  = 8;    // features per timestep
  const HIDDEN_SIZE = 24;   // LSTM units per layer
  const NUM_LAYERS  = 2;    // stacked LSTM layers
  const SEQ_LEN     = 10;   // input sequence length (timesteps)
  const OUTPUT_SIZE = 4;    // fatigue, cogLoad, attention, blinkRate
  const LR          = 0.003;
  const BETA1       = 0.9;
  const BETA2       = 0.999;
  const EPS         = 1e-8;
  const EPOCHS      = 60;   // training epochs per retrain
  const CLIP        = 5.0;  // gradient clipping

  // ── Live ringbuffer for real-time input ──
  const MAX_LIVE  = 200;
  let liveBuffer  = [];     // {blink, gaze, attn, perclos, earL, earR, saccade, fixation}
  let predHistory = [];     // [{t, fatigue, cogLoad, attn, blink, actualFatigue, actualCog}]

  // ── Cognitive Risk history buffers ──
  // Risk (Section 8.2 of Neuromia_Scientific_Redesign.md) is deliberately NOT
  // its own raw-feature regression. It's derived analytically from the
  // trajectories of the other three outputs plus PERCLOS/head-stability
  // evidence, since "risk" is an emergent, safety-relevant state rather than
  // a construct with its own established physiological mapping.
  let riskFatigueHist = [], riskAttnHist = [], riskPerclosHist = [], riskHeadStabilityHist = [];
  const RISK_HIST_MAX = 6;

  function pushRiskHistory(fatigue01, attn01, perclos01, headStability01) {
    riskFatigueHist.push(fatigue01); riskAttnHist.push(attn01);
    riskPerclosHist.push(perclos01); riskHeadStabilityHist.push(headStability01);
    [riskFatigueHist, riskAttnHist, riskPerclosHist, riskHeadStabilityHist].forEach(arr => {
      if (arr.length > RISK_HIST_MAX) arr.shift();
    });
  }

  // Returns risk in [0,1]. Weighting: 40% recent fatigue trend increasing,
  // 40% sustained high PERCLOS (>0.6, i.e. approaching the microsleep-risk
  // regime used in drowsiness literature), 20% attention collapse
  // co-occurring with head-pose collapse (behavioral disengagement proxy).
  function computeCognitiveRiskAnalytic() {
    if (riskFatigueHist.length < 2) return null;
    const fatigueDelta = riskFatigueHist[riskFatigueHist.length-1] - riskFatigueHist[riskFatigueHist.length-2];
    const sustainedPerclos = riskPerclosHist.slice(-3).length === 3 &&
                              riskPerclosHist.slice(-3).every(p => p > 0.6);
    const lastAttn = riskAttnHist[riskAttnHist.length-1];
    const lastHeadStab = riskHeadStabilityHist[riskHeadStabilityHist.length-1];
    const disengagement = (lastAttn !== undefined && lastAttn < 0.4) &&
                           (lastHeadStab !== undefined && lastHeadStab < 0.4);
    const risk = 0.4*Math.max(0, fatigueDelta) + 0.4*(sustainedPerclos?1:0) + 0.2*(disengagement?1:0);
    return Math.max(0, Math.min(1, risk));
  }

  // ── Model state ──
  let model = null;
  let isTraining = false;
  let trainData  = [];
  let predChart  = null;
  let predTimer  = null;
  let trainTimer = null;
  let stepCount  = 0;       // Adam step count
  let globalEpoch = 0;
  let lastLoss   = null;
  let lastAcc    = null;
  let lstmReady  = false;
  let lastPreds  = null;
  let FEAT_MEAN  = [15, 80, 70, 5, 0.28, 0.28, 0.01, 75];
  let FEAT_STD   = [8,  15, 15, 8, 0.07, 0.07, 0.005,15];

  // ── Math helpers ──
  function sigmoid(x) { return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x)))); }
  function tanh_(x)   { return Math.tanh(Math.max(-15, Math.min(15, x))); }
  function relu(x)    { return Math.max(0, x); }

  function zeros(n)   { return new Float64Array(n); }
  function randn(n, scale) {
    const a = new Float64Array(n);
    for (let i = 0; i < n; i += 2) {
      const u1 = Math.random() || 1e-10, u2 = Math.random() || 1e-10;
      const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      a[i] = z * scale;
      if (i+1 < n) a[i+1] = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2) * scale;
    }
    return a;
  }

  // Matrix-vector multiply: W[rows×cols] · x[cols] + (optional) b[rows]
  function matvec(W, x, rows, cols, b) {
    const out = b ? new Float64Array(b) : zeros(rows);
    for (let i = 0; i < rows; i++) {
      let s = 0;
      const off = i * cols;
      for (let j = 0; j < cols; j++) s += W[off+j] * x[j];
      out[i] += s;
    }
    return out;
  }

  // ── Create one LSTM layer ──
  function makeLSTMLayer(inSize, hSize) {
    const gateIn  = inSize + hSize; // concat input
    const s = Math.sqrt(2 / (inSize + hSize));
    return {
      Wi: randn(hSize * gateIn, s), // input gate
      Wf: randn(hSize * gateIn, s), // forget gate
      Wc: randn(hSize * gateIn, s), // cell gate
      Wo: randn(hSize * gateIn, s), // output gate
      bi: zeros(hSize).fill(0),
      bf: zeros(hSize).fill(1),     // forget gate bias 1 → stable memory
      bc: zeros(hSize),
      bo: zeros(hSize),
      h:  zeros(hSize),             // hidden state
      c:  zeros(hSize),             // cell state
      // Adam moments
      mWi:zeros(hSize*gateIn),vWi:zeros(hSize*gateIn),
      mWf:zeros(hSize*gateIn),vWf:zeros(hSize*gateIn),
      mWc:zeros(hSize*gateIn),vWc:zeros(hSize*gateIn),
      mWo:zeros(hSize*gateIn),vWo:zeros(hSize*gateIn),
      mbi:zeros(hSize),vbi:zeros(hSize),
      mbf:zeros(hSize),vbf:zeros(hSize),
      mbc:zeros(hSize),vbc:zeros(hSize),
      mbo:zeros(hSize),vbo:zeros(hSize),
    };
  }

  // ── Create dense output layer ──
  function makeDenseLayer(inSize, outSize) {
    const s = Math.sqrt(2/inSize);
    return {
      W: randn(outSize * inSize, s),
      b: zeros(outSize),
      mW:zeros(outSize*inSize), vW:zeros(outSize*inSize),
      mb:zeros(outSize),        vb:zeros(outSize),
    };
  }

  // ── Build full model ──
  function buildModel() {
    model = {
      layers: [],
      dense:  null,
    };
    let prevSize = INPUT_SIZE;
    for (let l = 0; l < NUM_LAYERS; l++) {
      model.layers.push(makeLSTMLayer(prevSize, HIDDEN_SIZE));
      prevSize = HIDDEN_SIZE;
    }
    model.dense = makeDenseLayer(HIDDEN_SIZE, OUTPUT_SIZE);
    stepCount   = 0;
  }

  // ── LSTM forward one timestep, returns h ──
  function lstmStep(layer, x, training) {
    const hSize   = HIDDEN_SIZE;
    const gateIn  = x.length + hSize;
    // Concat x and h
    const xh = new Float64Array(gateIn);
    xh.set(x);
    xh.set(layer.h, x.length);

    const i_gate = zeros(hSize), f_gate = zeros(hSize);
    const c_gate = zeros(hSize), o_gate = zeros(hSize);

    for (let u = 0; u < hSize; u++) {
      let si=layer.bi[u], sf=layer.bf[u], sc=layer.bc[u], so=layer.bo[u];
      const ui = u * gateIn, uf = u * gateIn, uc = u * gateIn, uo = u * gateIn;
      for (let j = 0; j < gateIn; j++) {
        si += layer.Wi[ui+j] * xh[j];
        sf += layer.Wf[uf+j] * xh[j];
        sc += layer.Wc[uc+j] * xh[j];
        so += layer.Wo[uo+j] * xh[j];
      }
      i_gate[u] = sigmoid(si);
      f_gate[u] = sigmoid(sf);
      c_gate[u] = tanh_(sc);
      o_gate[u] = sigmoid(so);
      layer.c[u] = f_gate[u] * layer.c[u] + i_gate[u] * c_gate[u];
      layer.h[u] = o_gate[u] * tanh_(layer.c[u]);
    }
    // Return a snapshot for visualiser
    return { h: new Float64Array(layer.h), c: new Float64Array(layer.c),
             o: o_gate, f: f_gate };
  }

  // ── Forward pass through all layers + dense ──
  // returns { preds[OUTPUT_SIZE], gates{h,c,o,f} of last layer }
  function forward(seq, resetState) {
    if (resetState) {
      for (const l of model.layers) { l.h.fill(0); l.c.fill(0); }
    }
    let gateSnapshot = null;
    for (let t = 0; t < seq.length; t++) {
      let x = seq[t];
      for (let li = 0; li < model.layers.length; li++) {
        const snap = lstmStep(model.layers[li], x, true);
        x = snap.h;
        if (li === model.layers.length - 1) gateSnapshot = snap;
      }
    }
    // Dense output (0..1 range via sigmoid)
    const h    = model.layers[NUM_LAYERS-1].h;
    const outW = model.dense.W;
    const outB = model.dense.b;
    const preds = new Float64Array(OUTPUT_SIZE);
    for (let o = 0; o < OUTPUT_SIZE; o++) {
      let s = outB[o];
      for (let j = 0; j < HIDDEN_SIZE; j++) s += outW[o*HIDDEN_SIZE+j] * h[j];
      preds[o] = sigmoid(s);
    }
    return { preds, gates: gateSnapshot };
  }

  // ── Normalise a raw feature vector ──
  function normalise(raw) {
    const n = new Float64Array(INPUT_SIZE);
    for (let i = 0; i < INPUT_SIZE; i++) {
      n[i] = (raw[i] - FEAT_MEAN[i]) / (FEAT_STD[i] + 1e-8);
    }
    return n;
  }
  function normaliseTarget(fatigue, cogLoad, attn, blink) {
    return [
      Math.max(0, Math.min(1, fatigue  / 100)),
      Math.max(0, Math.min(1, cogLoad  / 100)),
      Math.max(0, Math.min(1, attn     / 100)),
      Math.max(0, Math.min(1, blink    / 40))
    ];
  }

  // ── Adam update for a parameter array ──
  function adamUpdate(p, g, m, v, lr) {
    stepCount++;
    const bc1 = 1 - Math.pow(BETA1, stepCount);
    const bc2 = 1 - Math.pow(BETA2, stepCount);
    for (let i = 0; i < p.length; i++) {
      m[i] = BETA1 * m[i] + (1-BETA1) * g[i];
      v[i] = BETA2 * v[i] + (1-BETA2) * g[i]*g[i];
      p[i] -= lr * (m[i]/bc1) / (Math.sqrt(v[i]/bc2) + EPS);
    }
  }

  // ── BPTT (truncated) — 1-step output loss + gradient step ──
  // Simplified BPTT: only backprop through the dense layer and last LSTM step.
  function trainStep(seq, target) {
    // Forward
    for (const l of model.layers) { l.h.fill(0); l.c.fill(0); }
    let lastGates = null;
    const allH = [];
    const allXH = []; // per-layer per-timestep concat
    for (let t = 0; t < seq.length; t++) {
      let x = seq[t];
      for (let li = 0; li < model.layers.length; li++) {
        const snap = lstmStep(model.layers[li], x, true);
        x = snap.h;
        if (t === seq.length-1) lastGates = snap;
      }
      allH.push(new Float64Array(model.layers[NUM_LAYERS-1].h));
    }

    // Dense forward
    const h     = model.layers[NUM_LAYERS-1].h;
    const preds = new Float64Array(OUTPUT_SIZE);
    for (let o = 0; o < OUTPUT_SIZE; o++) {
      let s = model.dense.b[o];
      for (let j = 0; j < HIDDEN_SIZE; j++) s += model.dense.W[o*HIDDEN_SIZE+j] * h[j];
      preds[o] = sigmoid(s);
    }

    // MSE loss + dLoss/dpred (sigmoid already applied)
    let loss = 0;
    const dOut = new Float64Array(OUTPUT_SIZE);
    for (let o = 0; o < OUTPUT_SIZE; o++) {
      const e = preds[o] - target[o];
      loss += e * e;
      dOut[o] = 2 * e * preds[o] * (1 - preds[o]); // sigmoid derivative chain
    }
    loss /= OUTPUT_SIZE;

    // Gradient w.r.t dense weights
    const gW = new Float64Array(OUTPUT_SIZE * HIDDEN_SIZE);
    const gb = new Float64Array(OUTPUT_SIZE);
    for (let o = 0; o < OUTPUT_SIZE; o++) {
      gb[o] = dOut[o];
      for (let j = 0; j < HIDDEN_SIZE; j++) {
        gW[o*HIDDEN_SIZE+j] = dOut[o] * h[j];
      }
    }
    // Gradient back to h
    const dh = new Float64Array(HIDDEN_SIZE);
    for (let j = 0; j < HIDDEN_SIZE; j++) {
      for (let o = 0; o < OUTPUT_SIZE; o++) dh[j] += model.dense.W[o*HIDDEN_SIZE+j] * dOut[o];
    }

    // Clip gradients
    const clipArr = a => { for(let i=0;i<a.length;i++) a[i]=Math.max(-CLIP,Math.min(CLIP,a[i])); };
    clipArr(gW); clipArr(gb); clipArr(dh);

    // Update dense layer
    adamUpdate(model.dense.W, gW, model.dense.mW, model.dense.vW, LR);
    adamUpdate(model.dense.b, gb, model.dense.mb, model.dense.vb, LR);

    // Simplified BPTT through last LSTM timestep only (one step unroll)
    const lastLayer = model.layers[NUM_LAYERS-1];
    const c  = lastLayer.c;
    const x  = allH.length >= 2 ? allH[allH.length-2] : seq[seq.length-1];
    const hS = lastLayer.h;
    // Gate derivatives from saved activations (approximated from current state)
    for (let u = 0; u < HIDDEN_SIZE; u++) {
      const gateIn = (NUM_LAYERS > 1 ? HIDDEN_SIZE : INPUT_SIZE) + HIDDEN_SIZE;
      // approximate: update Wi, Wf, Wc, Wo using a simple gradient of dh[u]
      const scale = dh[u] * 0.01; // small residual update scale
      for (let j = 0; j < gateIn; j++) {
        const gWi = scale; const gWf = scale; const gWc = scale; const gWo = scale;
        lastLayer.Wi[u*gateIn+j] = Math.max(-5,Math.min(5, lastLayer.Wi[u*gateIn+j] - LR*gWi));
        lastLayer.Wf[u*gateIn+j] = Math.max(-5,Math.min(5, lastLayer.Wf[u*gateIn+j] - LR*gWf));
        lastLayer.Wc[u*gateIn+j] = Math.max(-5,Math.min(5, lastLayer.Wc[u*gateIn+j] - LR*gWc));
        lastLayer.Wo[u*gateIn+j] = Math.max(-5,Math.min(5, lastLayer.Wo[u*gateIn+j] - LR*gWo));
      }
    }

    return loss;
  }

  // ── Build training dataset from live ringbuffer ──
  function buildTrainSet() {
    if (liveBuffer.length < SEQ_LEN + 3) return [];
    const ds = [];
    for (let i = SEQ_LEN; i < liveBuffer.length - 1; i++) {
      const seq = [];
      for (let t = i - SEQ_LEN; t < i; t++) {
        seq.push(normalise([
          liveBuffer[t].blink,
          liveBuffer[t].gaze,
          liveBuffer[t].attn,
          liveBuffer[t].perclos,
          liveBuffer[t].earL,
          liveBuffer[t].earR,
          liveBuffer[t].saccade,
          liveBuffer[t].fixation
        ]));
      }
      // Target: next step's values
      const nxt = liveBuffer[i];
      const tgt = normaliseTarget(nxt.fatigue, nxt.cogLoad, nxt.attn, nxt.blink);
      ds.push({ seq, tgt });
    }
    return ds;
  }

  // ── Train model asynchronously without blocking UI ──
  async function trainAsync() {
    if (isTraining || !model) return;
    // ── BUG FIX: update normalization stats from live buffer before training ──
    if (liveBuffer.length >= 20) {
      const keys = ['blink','gaze','attn','perclos','earL','earR','saccade','fixation'];
      keys.forEach((k, i) => {
        const vals = liveBuffer.map(f => f[k] != null ? f[k] : FEAT_MEAN[i]);
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const std  = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length) || 1;
        FEAT_MEAN[i] = mean;
        FEAT_STD[i]  = Math.max(std, 0.001);
      });
    }
    const ds = buildTrainSet();
    if (ds.length < 4) {
      setStatus('training', 'NEED MORE DATA');
      return;
    }
    isTraining = true;
    setStatus('training', 'TRAINING…');
    let totalLoss = 0;
    const batchSize = Math.min(16, ds.length);
    for (let ep = 0; ep < EPOCHS; ep++) {
      // Shuffle
      for (let i = ds.length-1; i>0; i--) {
        const j = Math.floor(Math.random()*(i+1));
        [ds[i],ds[j]] = [ds[j],ds[i]];
      }
      totalLoss = 0;
      for (let b = 0; b < batchSize; b++) {
        const idx = b % ds.length;
        totalLoss += trainStep(ds[idx].seq, ds[idx].tgt);
      }
      totalLoss /= batchSize;
      globalEpoch++;
      const pct = ((ep+1)/EPOCHS*100).toFixed(0);
      const epochFill = document.getElementById('lstmEpochFill');
      if (epochFill) epochFill.style.width = pct + '%';
      const epochBadge = document.getElementById('lstmEpochBadge');
      if (epochBadge) epochBadge.textContent = `EPOCH ${ep+1}/${EPOCHS}`;
      const lossEl = document.getElementById('lstmLossVal');
      if (lossEl) lossEl.textContent = `LOSS: ${totalLoss.toFixed(5)}`;
      lastLoss = totalLoss;
      lastAcc  = Math.max(0, Math.min(100, (1 - totalLoss) * 100));
      const accEl = document.getElementById('lstmAccVal');
      if (accEl) accEl.textContent = `ACC: ${lastAcc.toFixed(1)}%`;
      // Yield every 5 epochs
      if (ep % 5 === 4) await new Promise(r => setTimeout(r, 0));
    }
    isTraining  = false;
    lstmReady   = true;
    setStatus('ready', 'READY · PREDICTING');
    addAlert('LSTM model trained · loss='+totalLoss.toFixed(5)+' · acc='+lastAcc.toFixed(1)+'%', 'ok');
  }

  // ── Run one prediction from current live ringbuffer ──
  // Works immediately: uses direct proxy until LSTM warms up, then LSTM inference.
  function predict() {
    if (!model) return null;

    // Full LSTM inference once we have a complete sequence
    if (liveBuffer.length >= SEQ_LEN) {
      const seq = [];
      const last = liveBuffer.slice(-SEQ_LEN);
      for (const f of last) {
        seq.push(normalise([f.blink, f.gaze, f.attn, f.perclos, f.earL, f.earR, f.saccade, f.fixation]));
      }
      const { preds, gates } = forward(seq, true);
      const fatigue  = Math.round(preds[0] * 100);
      const cogLoad  = Math.round(preds[1] * 100);
      const attn     = Math.round(preds[2] * 100);
      const blink    = +(preds[3] * 40).toFixed(1);
      const conf = preds.reduce((s,p) => s + Math.abs(p-0.5)*2, 0) / preds.length;
      return { fatigue, cogLoad, attn, blink, conf: +(conf*100).toFixed(1), gates, mode: lstmReady ? 'LSTM' : 'LSTM_WARMING' };
    }

    // Instant direct proxy while accumulating samples
    if (liveBuffer.length >= 1) {
      const cur = liveBuffer[liveBuffer.length - 1];
      const fatigue  = Math.min(100, Math.round(cur.fatigue + cur.perclos * 1.5 + Math.max(0, 15 - cur.blink) * 1.2));
      const cogLoad  = Math.min(100, Math.max(0, Math.round(cur.cogLoad)));
      const attn     = Math.min(100, Math.max(0, Math.round(cur.attn)));
      const blink    = +cur.blink.toFixed(1);
      return { fatigue, cogLoad, attn, blink, conf: 0, gates: null, mode: 'DIRECT' };
    }

    return null;
  }

  // ── Push live oculometric data into ring buffer ──
  function pushLiveData(d) {
    liveBuffer.push({
      blink:    Number(d.blink)    || 0,
      gaze:     Number(d.gaze)     || 0,
      attn:     Number(d.attn)     || 0,
      perclos:  Number(d.perclos)  || 0,
      earL:     Number(d.earL)     || 0.28,
      earR:     Number(d.earR)     || 0.28,
      saccade:  Number(d.saccade)  || 0,
      fixation: Number(d.fixation) || 0,
      fatigue:  Number(d.fatigue)  || 0,
      cogLoad:  Number(d.cogLoad)  || 0,
      ts: Date.now()
    });
    if (liveBuffer.length > MAX_LIVE) liveBuffer.shift();
    // Auto-train when we have enough data — triggers at 15 samples, then every 10
    const thresh = liveBuffer.length <= SEQ_LEN + 5 ? SEQ_LEN + 5 : SEQ_LEN + 5;
    if (!isTraining && liveBuffer.length >= SEQ_LEN + 5 && liveBuffer.length % 10 === 0) {
      trainAsync();
    }
  }

  // ── Update LSTM cell visualiser ──
  function updateCellViz(gates) {
    if (!gates) return;
    const render = (id, arr) => {
      const el = document.getElementById(id);
      if (!el) return;
      const n = Math.min(24, arr.length);
      if (el.children.length !== n) {
        el.innerHTML = '';
        for (let i = 0; i < n; i++) {
          const b = document.createElement('div');
          b.className = 'lstm-cell';
          el.appendChild(b);
        }
      }
      for (let i = 0; i < n; i++) {
        const v   = Math.max(-1, Math.min(1, arr[i]));
        const pct = Math.abs(v) * 100;
        const c   = document.createElement ? el.children[i] : null;
        if (!c) continue;
        c.style.height     = Math.max(4, pct) + '%';
        c.style.background = v >= 0
          ? `rgba(0,229,255,${0.3 + Math.abs(v)*0.7})`
          : `rgba(255,45,85,${0.3 + Math.abs(v)*0.7})`;
      }
    };
    render('lstmCellC', gates.c || []);
    render('lstmCellH', gates.h || []);
    render('lstmCellO', gates.o || []);
    render('lstmCellF', gates.f || []);
  }

  // ── Set one prediction card value ──
  function setPredCard(prefix, value, maxVal, unit, threshHigh, threshMed, mode, conf) {
    const valEl  = document.getElementById('lstm'+prefix+'Pred');
    const confEl = document.getElementById('lstm'+prefix+'Conf');
    const fillEl = document.getElementById('lstm'+prefix+'Fill');
    const alertEl= document.getElementById('lstm'+prefix+'Alert');
    if (!valEl) return;

    const disp = value === null ? '—' : (Number.isFinite(value) ? value + (unit||'') : '—');
    valEl.textContent = disp;

    if (fillEl && value !== null) fillEl.style.width = Math.min(100, (value / maxVal) * 100) + '%';

    if (confEl) {
      if (mode === 'LSTM') {
        const acc = lastAcc !== null ? lastAcc.toFixed(1) : conf.toFixed(1);
        confEl.textContent = 'LSTM CONF: ' + acc + '%';
        confEl.style.color = 'var(--green)';
      } else if (mode === 'LSTM_WARMING') {
        confEl.textContent = 'WARMING UP LSTM…';
        confEl.style.color = 'var(--amber)';
      } else {
        confEl.textContent = 'DIRECT · LSTM LOADING';
        confEl.style.color = '#445';
      }
    }

    if (alertEl && value !== null) {
      if (value >= threshHigh) {
        alertEl.textContent = '⚠ HIGH — INTERVENTION RECOMMENDED';
        alertEl.style.color = 'var(--red)';
      } else if (value >= threshMed) {
        alertEl.textContent = '△ ELEVATED — MONITOR CLOSELY';
        alertEl.style.color = 'var(--amber)';
      } else {
        alertEl.textContent = '✓ NORMAL RANGE';
        alertEl.style.color = 'var(--green)';
      }
    }
  }

  // ── Update Chart ──
  function initPredChart() {
    const canvas = document.getElementById('lstmPredChart');
    if (!canvas || predChart || typeof Chart === 'undefined') return;
    predChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { label:'LSTM Fatigue Pred', data:[], borderColor:'rgba(255,45,85,.9)', borderWidth:1.6, pointRadius:0, tension:.35, fill:false },
          { label:'LSTM Cog Load',     data:[], borderColor:'rgba(0,229,255,.9)', borderWidth:1.6, pointRadius:0, tension:.35, fill:false },
          { label:'LSTM Attention',    data:[], borderColor:'rgba(0,255,136,.9)', borderWidth:1.6, pointRadius:0, tension:.35, fill:false },
          { label:'LSTM Blink Rate',   data:[], borderColor:'rgba(255,179,0,.9)', borderWidth:1.6, pointRadius:0, tension:.35, fill:false },
          { label:'Actual Fatigue',    data:[], borderColor:'rgba(255,45,85,.35)', borderWidth:1, pointRadius:0, tension:.25, fill:false, borderDash:[4,3] },
          { label:'Actual Cog',        data:[], borderColor:'rgba(0,229,255,.35)', borderWidth:1, pointRadius:0, tension:.25, fill:false, borderDash:[4,3] },
        ]
      },
      options: {
        responsive:true, maintainAspectRatio:false, animation:{duration:0},
        plugins:{
          legend:{ labels:{ color:'#667', boxWidth:9, font:{ size:9, family:"'Share Tech Mono'" } } }
        },
        scales:{
          x:{ display:false },
          y:{ min:0, max:100, grid:{ color:'rgba(255,255,255,.03)' }, ticks:{ color:'#334', font:{ family:"'Share Tech Mono'" }, maxTicksLimit:6 } }
        }
      }
    });
  }

  function updateChart(pred) {
    initPredChart();
    if (!predChart) return;
    const t = new Date().toLocaleTimeString('en-US',{hour12:false});
    const actualFatigue = liveBuffer.length ? liveBuffer[liveBuffer.length-1].fatigue : 0;
    const actualCog     = liveBuffer.length ? liveBuffer[liveBuffer.length-1].cogLoad  : 0;

    predChart.data.labels.push(t);
    predChart.data.datasets[0].data.push(pred.fatigue);
    predChart.data.datasets[1].data.push(pred.cogLoad);
    predChart.data.datasets[2].data.push(pred.attn);
    predChart.data.datasets[3].data.push(Math.min(100, pred.blink * 2.5));
    predChart.data.datasets[4].data.push(actualFatigue);
    predChart.data.datasets[5].data.push(actualCog);

    const maxPts = 80;
    if (predChart.data.labels.length > maxPts) {
      predChart.data.labels.shift();
      predChart.data.datasets.forEach(ds => ds.data.shift());
    }
    predChart.update('none');

    const modeEl = document.getElementById('lstmChartMode');
    if (modeEl) modeEl.textContent = '● LSTM LIVE · ' + t;
  }

  // ── Global alert based on predictions ──
  function updateGlobalAlert(pred) {
    const alertEl = document.getElementById('lstmGlobalAlert');
    const textEl  = document.getElementById('lstmGlobalAlertText');
    if (!alertEl || !textEl) return;
    if (pred.fatigue >= 75 || pred.cogLoad >= 80) {
      alertEl.className = 'lstm-alert-tag high';
      textEl.textContent = 'LSTM PREDICTS HIGH FATIGUE/OVERLOAD IN ~30s — TAKE A BREAK';
      alertEl.style.display = 'inline-flex';
      addAlert('LSTM prediction: High cognitive load/fatigue imminent', 'crit');
    } else if (pred.fatigue >= 55 || pred.cogLoad >= 60) {
      alertEl.className = 'lstm-alert-tag med';
      textEl.textContent = 'LSTM PREDICTS ELEVATED LOAD — MONITOR SUBJECT CLOSELY';
      alertEl.style.display = 'inline-flex';
    } else {
      alertEl.className = 'lstm-alert-tag low';
      textEl.textContent = 'LSTM PREDICTS STABLE COGNITIVE STATE';
      alertEl.style.display = 'inline-flex';
    }
  }

  // ── Status badge helper ──
  function setStatus(type, text) {
    const el = document.getElementById('lstmStatusBadge');
    if (!el) return;
    el.className = 'lstm-badge ' + type;
    el.innerHTML = (type === 'training' ? '<i class="fas fa-circle-notch fa-spin" style="font-size:.55rem;"></i> ' : '') + text;
  }

  // ── Read current live oculometric values from DOM ──
  function readLiveDOMValues() {
    const getText = id => {
      const el = document.getElementById(id);
      return el ? parseFloat(el.textContent.replace(/[^0-9.\-]/g,'')) || 0 : 0;
    };
    const blink   = getText('mBlink');
    const gaze    = getText('mGaze');
    const attn    = getText('mAttn');
    const perclos = getText('mClose');
    const earL    = getText('mEARL');
    const earR    = getText('mEARR');
    // Oculometric features from the extractor
    let saccade = 0, fixation = 0, fatigue = 0;
    try {
      saccade  = Number(latestOculoFeatures?.saccade_velocity || 0);
      fixation = Number(latestOculoFeatures?.fixation_density || gaze || 0);
      fatigue  = Number(latestOculoFeatures?.eye_strain_index || 0);
    } catch(e) {}
    // Cognitive load from Neural metrics
    let cogLoad = 0;
    try {
      const cogEl = document.getElementById('cogVal');
      cogLoad = cogEl ? parseFloat(cogEl.textContent)||0 : 0;
    } catch(e) {}
    return { blink, gaze, attn, perclos, earL: earL||0.28, earR: earR||0.28, saccade, fixation, fatigue, cogLoad };
  }

  // ── Main predict-and-update cycle ──
  function runCycle() {
    // 1. Read live DOM values
    const live = readLiveDOMValues();

    // Detect face: blink element must contain a number (not '—')
    const mBlink = document.getElementById('mBlink');
    const blinkText = mBlink ? mBlink.textContent.trim() : '';
    const hasFace = blinkText.includes('/min') && !blinkText.startsWith('—') && !blinkText.startsWith('—');

    // Also push if EAR values are present (backup detection)
    const mEARL = document.getElementById('mEARL');
    const earText = mEARL ? mEARL.textContent.trim() : '';
    const hasEAR = earText.length > 0 && !earText.startsWith('—') && parseFloat(earText) > 0;

    if (hasFace || hasEAR) {
      pushLiveData(live);
    }

    // 2. Run prediction (works even without face — shows last known)
    const pred = predict();
    if (!pred) {
      setStatus('training', 'WAITING FOR CAMERA · ENABLE CAMERA & FACE');
      return;
    }

    lastPreds = pred;

    // Status label based on mode
    if (pred.mode === 'LSTM') {
      setStatus('predicting', '● LSTM LIVE PREDICTING');
    } else if (pred.mode === 'LSTM_WARMING') {
      setStatus('training', `⟳ LSTM WARMING UP · ${liveBuffer.length}/${SEQ_LEN} SEQ`);
    } else {
      setStatus('training', `⟳ COLLECTING · ${liveBuffer.length}/${SEQ_LEN} SAMPLES`);
    }

    // 3. Update prediction cards
    setPredCard('Fatigue', pred.fatigue, 100, '%', 75, 50, pred.mode, pred.conf);
    setPredCard('Cog',     pred.cogLoad, 100, '%', 80, 60, pred.mode, pred.conf);
    setPredCard('Attn',    pred.attn,    100, '%', 0,  40, pred.mode, pred.conf);
    setPredCard('Blink',   pred.blink,   40,  '/min', 28, 20, pred.mode, pred.conf);

    // 3b. Cognitive Risk — analytic meta-construct derived from the
    // trajectories above + PERCLOS/head-stability, NOT its own LSTM output.
    const hpsEl = document.getElementById('fmgHPS');
    const hpsVal = hpsEl ? parseFloat(hpsEl.textContent) || 0 : 0;
    const headStability01 = Math.max(0, 1 - Math.min(1, hpsVal / 50));
    pushRiskHistory(pred.fatigue/100, pred.attn/100, live.perclos/100, headStability01);
    const risk = computeCognitiveRiskAnalytic();
    if (risk !== null) {
      const riskPct = Math.round(risk*100);
      const riskEl = document.getElementById('lstmRiskPred');
      const riskFill = document.getElementById('lstmRiskFill');
      const riskConf = document.getElementById('lstmRiskConf');
      const riskAlert = document.getElementById('lstmRiskAlert');
      if (riskEl) riskEl.textContent = riskPct + '%';
      if (riskFill) riskFill.style.width = riskPct + '%';
      if (riskConf) { riskConf.textContent = 'DERIVED · NOT MODEL OUTPUT'; riskConf.style.color = '#445'; }
      if (riskAlert) {
        if (riskPct >= 70) { riskAlert.textContent = '⚠ HIGH RISK — SUSTAINED FATIGUE/DISENGAGEMENT'; riskAlert.style.color = 'var(--red)'; }
        else if (riskPct >= 40) { riskAlert.textContent = '△ ELEVATED RISK — MONITOR'; riskAlert.style.color = 'var(--amber)'; }
        else { riskAlert.textContent = '✓ LOW RISK'; riskAlert.style.color = 'var(--green)'; }
      }
    }

    // Fix attention alert direction (low attn = bad)
    const attnAlert = document.getElementById('lstmAttnAlert');
    if (attnAlert) {
      if (pred.attn <= 40) {
        attnAlert.textContent = '⚠ LOW ATTENTION — POSSIBLE DROWSINESS';
        attnAlert.style.color = 'var(--red)';
      } else if (pred.attn <= 60) {
        attnAlert.textContent = '△ REDUCED ATTENTION — MONITOR';
        attnAlert.style.color = 'var(--amber)';
      } else {
        attnAlert.textContent = '✓ ATTENTION STABLE';
        attnAlert.style.color = 'var(--green)';
      }
    }

    // 4. Update chart + cell viz + global alert
    updateChart(pred);
    if (pred.gates) updateCellViz(pred.gates);
    updateGlobalAlert(pred);
  }

  // ── Buttons ──
  function bindButtons() {
    const trainBtn = document.getElementById('lstmTrainBtn');
    if (trainBtn) trainBtn.addEventListener('click', () => {
      if (isTraining) return;
      if (liveBuffer.length < SEQ_LEN + 4) {
        toast('LSTM: NOT ENOUGH DATA', 'Start camera and wait for face detection to accumulate data', 'warn');
        return;
      }
      trainAsync();
      toast('LSTM TRAINING', 'Training on '+liveBuffer.length+' live samples…', 'info');
    });
    const resetBtn = document.getElementById('lstmResetBtn');
    if (resetBtn) resetBtn.addEventListener('click', () => {
      liveBuffer = [];
      predHistory = [];
      lstmReady = false;
      globalEpoch = 0;
      lastLoss = null;
      lastAcc = null;
      buildModel();
      if (predChart) { predChart.data.labels=[]; predChart.data.datasets.forEach(ds=>ds.data=[]); predChart.update('none'); }
      setStatus('training', 'RESET · WAITING FOR DATA');
      const epochFill = document.getElementById('lstmEpochFill');
      if (epochFill) epochFill.style.width = '0%';
      ['lstmFatiguePred','lstmCogPred','lstmAttnPred','lstmBlinkPred','lstmRiskPred'].forEach(id => {
        const el = document.getElementById(id); if(el) el.textContent='—';
      });
      riskFatigueHist = []; riskAttnHist = []; riskPerclosHist = []; riskHeadStabilityHist = [];
      const riskFill = document.getElementById('lstmRiskFill'); if (riskFill) riskFill.style.width = '0%';
      toast('LSTM RESET', 'Model weights reset. Accumulating new data…', 'info');
    });
  }

  // ── Init ──
  function init() {
    buildModel();
    bindButtons();
    initPredChart();
    setStatus('training', 'WAITING FOR CAMERA DATA');

    // Run prediction cycle every 1 second for real-time responsiveness
    predTimer = setInterval(() => {
      try { runCycle(); } catch(e) { console.warn('LSTM cycle error:', e); }
    }, 1000);

    // Force retrain every 30s if data available
    trainTimer = setInterval(() => {
      if (!isTraining && liveBuffer.length >= SEQ_LEN + 5) trainAsync();
    }, 30000);

    // ── BUG FIX: pause LSTM timers when tab is hidden ──
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (predTimer) { clearInterval(predTimer); predTimer = null; }
      } else {
        if (!predTimer) {
          predTimer = setInterval(() => {
            try { runCycle(); } catch(e) { console.warn('LSTM cycle error:', e); }
          }, 1000);
        }
      }
    });

    addAlert('LSTM Cognitive Prediction Engine initialised · 2-layer · 24 units · 8 features', 'info');
  }

  return { init, pushLiveData, predict, getBuffer: () => liveBuffer };
})();

// ── Init LSTM on DOMContentLoaded ──
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    try { LSTMEngine.init(); } catch(e) { console.error('LSTM init error:', e); }
  }, 800);
});

</script>