// REGISTRATION MODAL SYSTEM
// ═══════════════════════════════════════════
window.regData = null;
let regStep = 0;
let selectedAvatar = '🧠';
let selectedColor = '#00e5ff';
let consentState = [true, true, false, false];

// ── Open / Close ──
$('openRegBtn').addEventListener('click', () => openRegModal());
$('regCloseBtn').addEventListener('click', () => closeRegModal());
$('regOverlay').addEventListener('click', (e) => {
  if(e.target === $('regOverlay')) closeRegModal();
});
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape') {
    if($('resultOverlay').classList.contains('show')) closeResultOverlay();
    else closeRegModal();
  }
});

function openRegModal(editMode = false) {
  if(!editMode) {
    regStep = 0;
    updateRegUI();
  }
  $('regOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  // Focus first input after transition
  setTimeout(() => $('f-first') && $('f-first').focus(), 380);
}

function closeRegModal() {
  $('regOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

// ── Step navigation ──
$('regNextBtn').addEventListener('click', () => advanceStep(1));
$('regBackBtn').addEventListener('click', () => advanceStep(-1));
$('regSubmitBtn').addEventListener('click', () => submitRegistration());

function advanceStep(dir) {
  if(dir === 1 && !validateStep(regStep)) return;
  const panel = $(`regPanel${regStep}`);
  panel.classList.remove('show', 'back');
  regStep = Math.max(0, Math.min(2, regStep + dir));
  const nextPanel = $(`regPanel${regStep}`);
  nextPanel.classList.remove('back');
  if(dir === -1) nextPanel.classList.add('back');
  nextPanel.classList.add('show');
  updateRegUI();
}

function updateRegUI() {
  // Step indicators
  ['si0','si1','si2'].forEach((id, i) => {
    const el = $(id);
    el.classList.remove('active','done');
    if(i < regStep) el.classList.add('done');
    else if(i === regStep) el.classList.add('active');
  });
  // Step lines
  $('sl01').style.background = regStep > 0 ? 'rgba(0,255,136,0.3)' : 'rgba(0,229,255,0.1)';
  $('sl12').style.background = regStep > 1 ? 'rgba(0,255,136,0.3)' : 'rgba(0,229,255,0.1)';
  // Panels visibility
  ['regPanel0','regPanel1','regPanel2'].forEach((id, i) => {
    if(i !== regStep) $(id).classList.remove('show','back');
  });
  // Buttons
  $('regBackBtn').style.display = regStep > 0 ? 'inline-flex' : 'none';
  $('regNextBtn').style.display = regStep < 2 ? 'inline-flex' : 'none';
  $('regSubmitBtn').style.display = regStep === 2 ? 'inline-flex' : 'none';
  $('regStepCounter').textContent = `STEP ${regStep+1} OF 3`;
  // Live subject ID preview
  updateSidPreview();
}

// ── Live Subject ID preview ──
let sidManuallyEdited = false;
window.addEventListener('DOMContentLoaded', () => {
  const sidInput = $('f-subject-id');
  if (sidInput) {
    sidInput.addEventListener('input', () => {
      sidManuallyEdited = true;
    });
  }
});

function updateSidPreview() {
  if (sidManuallyEdited) return;
  const first = ($('f-first').value || '').trim().toUpperCase().replace(/[^A-Z]/g,'').slice(0,2);
  const last  = ($('f-last').value  || '').trim().toUpperCase().replace(/[^A-Z]/g,'').slice(0,3);
  const dob   = ($('f-dob').value   || '').replace(/-/g,'').slice(2,8);
  const sidInput = $('f-subject-id');
  if(sidInput && (!sidInput.value || sidInput.value.startsWith('NM-') || sidInput.value === 'P001' || sidInput.value === '—')) {
    if(first || last) {
      sidInput.value = `NM-${first}${last}${dob || '000000'}`;
    } else {
      sidInput.value = 'P001';
    }
  }
}
['f-first','f-last','f-dob'].forEach(id => {
  const el = $(id);
  if(el) el.addEventListener('input', updateSidPreview);
});


// ── Avatar picker ──
document.querySelectorAll('.avatar-opt').forEach(opt => {
  opt.addEventListener('click', function() {
    document.querySelectorAll('.avatar-opt').forEach(o => o.classList.remove('selected'));
    this.classList.add('selected');
    selectedAvatar = this.dataset.av;
  });
});

// ── Color picker ──
document.querySelectorAll('.color-opt').forEach(opt => {
  opt.addEventListener('click', function() {
    document.querySelectorAll('.color-opt').forEach(o => o.classList.remove('selected'));
    this.classList.add('selected');
    selectedColor = this.dataset.col;
  });
});

// ── Consent toggles ──
function toggleConsent(idx) {
  consentState[idx] = !consentState[idx];
  const tog = $(`ctg${idx}`);
  if(consentState[idx]) tog.classList.add('on');
  else tog.classList.remove('on');
}

// ── Inline real-time validation (show valid state on blur) ──
['f-first','f-last','f-email','f-dob','f-gender','f-hand','f-role','f-sig'].forEach(id => {
  const el = $(id);
  if(!el) return;
  el.addEventListener('blur', () => liveValidate(id));
  el.addEventListener('input', () => {
    if(el.classList.contains('error')) liveValidate(id);
    clearFieldError(id);
  });
});

function liveValidate(id) {
  const el = $(id);
  if(!el) return;
  const val = el.value.trim();
  let ok = false;
  if(id === 'f-email') ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
  else if(id === 'f-phone') {
    // Phone is optional — empty is fine; if provided must be 7-15 digits/spaces/+/-/()
    ok = val.length === 0 || /^[+\d][\d\s\-().]{5,14}$/.test(val);
  }
  else if(id === 'f-dob') {
    if(val) {
      const age = calcAge(val);
      ok = age >= 5 && age <= 120;
    }
  } else ok = val.length > 0;
  el.classList.toggle('valid', ok && val.length > 0);
  el.classList.toggle('error', !ok && val.length > 0);
}

function clearFieldError(id) {
  const errEl = $('e-' + id.replace('f-',''));
  if(errEl) errEl.innerHTML = '';
  $(id).classList.remove('error');
}

function showFieldError(id, msg) {
  $(id).classList.add('error');
  $(id).classList.remove('valid');
  const key = id.replace('f-','');
  const errEl = $('e-' + key);
  if(errEl) errEl.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${msg}`;
}

function calcAge(dobStr) {
  const dob = new Date(dobStr);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if(m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

// ── Step validators ──
function validateStep(step) {
  let valid = true;

  if(step === 0) {
    const first = $('f-first').value.trim();
    const last  = $('f-last').value.trim();
    const dob   = $('f-dob').value;
    const gender = $('f-gender').value;
    const email = $('f-email').value.trim();
    const sid   = ($('f-subject-id') ? $('f-subject-id').value.trim() : '');
    const sessId = ($('f-session-id') ? parseInt($('f-session-id').value) : 1);

    if(!sid) { showFieldError && showFieldError('f-subject-id','Participant ID is required'); valid=false; }
    if(isNaN(sessId) || sessId < 1) { valid=false; }

    if(!first)  { showFieldError('f-first','First name is required'); valid=false; }
    else if(first.length < 2) { showFieldError('f-first','Minimum 2 characters'); valid=false; }

    if(!last)   { showFieldError('f-last','Last name is required'); valid=false; }
    else if(last.length < 2)  { showFieldError('f-last','Minimum 2 characters'); valid=false; }

    if(!dob) { showFieldError('f-dob','Date of birth is required'); valid=false; }
    else {
      const age = calcAge(dob);
      if(age < 5)  { showFieldError('f-dob','Subject must be at least 5 years old'); valid=false; }
      if(age > 120){ showFieldError('f-dob','Please enter a valid date of birth'); valid=false; }
    }

    if(!gender) { showFieldError('f-gender','Please select a gender'); valid=false; }

    if(!email) { showFieldError('f-email','Email address is required'); valid=false; }
    else if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showFieldError('f-email','Please enter a valid email address'); valid=false;
    }
  }

  if(step === 1) {
    const hand = $('f-hand').value;
    const role = $('f-role').value;
    const sleep = parseFloat($('f-sleep') ? $('f-sleep').value : '');
    if(!hand) { showFieldError('f-hand','Please select handedness'); valid=false; }
    if(!role) { showFieldError('f-role','Please select a study role'); valid=false; }
    if(isNaN(sleep) || sleep < 0 || sleep > 24) {
      if($('f-sleep')) { $('f-sleep').classList.add('error'); }
      toast('SLEEP HOURS REQUIRED', 'Please enter valid sleep hours (0-24)', 'warn');
      valid = false;
    }
  }

  if(step === 2) {
    const sig = $('f-sig').value.trim();
    const first = $('f-first').value.trim();
    const last  = $('f-last').value.trim();
    if(!sig) { showFieldError('f-sig','Digital signature is required'); valid=false; }
    else {
      // Signature should loosely match the subject's name
      const fullName = (first + ' ' + last).toLowerCase();
      const sigLower = sig.toLowerCase();
      const firstMatch = sigLower.includes(first.toLowerCase());
      const lastMatch  = sigLower.includes(last.toLowerCase());
      if(!firstMatch && !lastMatch) {
        showFieldError('f-sig','Signature should match your registered name'); valid=false;
      }
    }
    if(!consentState[0] || !consentState[1]) {
      toast('CONSENT REQUIRED','EEG & Video consent are mandatory to proceed','crit');
      valid = false;
    }
  }

  if(!valid) {
    // Shake the modal footer
    const footer = document.querySelector('.reg-footer');
    footer.style.animation = 'none';
    footer.offsetHeight;
    footer.style.animation = 'shake 0.4s ease';
  }
  return valid;
}

// Shake keyframe injection
(function(){
  const s = document.createElement('style');
  s.textContent = `@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-6px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}}`;
  document.head.appendChild(s);
})();

// ── Submit ──
function submitRegistration() {
  if(!validateStep(2)) return;

  const first = $('f-first').value.trim();
  const last  = $('f-last').value.trim();
  const dob   = $('f-dob').value;
  const sidInput = $('f-subject-id');
  const sid = (sidInput && sidInput.value.trim())
    ? sidInput.value.trim()
    : 'NM-' + Date.now().toString(36).toUpperCase().slice(-8);
  const sessionNum = $('f-session-id') ? (parseInt($('f-session-id').value) || 1) : 1;
  const now = new Date();

  const eegMetrics = EEGSys.getMetrics();

  window.regData = {
    // Identity
    firstName:  first,
    lastName:   last,
    fullName:   first + ' ' + last,
    dob:        dob,
    age:        calcAge(dob),
    gender:     $('f-gender').value,
    email:      $('f-email').value.trim(),
    phone:      $('f-phone').value.trim() || 'N/A',
    org:        $('f-org').value.trim()   || 'N/A',
    // Profile
    handedness: $('f-hand').value,
    role:       $('f-role').value,
    conditions: ($('f-conditions').value.trim().replace(/[\r\n,]/g, ';').slice(0, 256) || 'None reported'),
    priorSessions: $('f-prior').value,
    domFreq:    $('f-freq').value,
    notes:      ($('f-notes').value.trim().replace(/[\r\n,]/g, ';').slice(0, 512) || 'None'),
    avatar:     selectedAvatar,
    color:      selectedColor,
    // Session identity — from new explicit fields
    subjectId:  sid,
    participantId: sid,
    sessionId:  sessionNum,
    sleepHours: parseFloat($('f-sleep') ? $('f-sleep').value : 0) || 0,
    caffeine:   ($('f-caffeine') ? $('f-caffeine').value : 'No'),
    glasses:    ($('f-glasses')  ? $('f-glasses').value  : 'No'),
    regTime:    `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`,
    regDate:    `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`,
    regTimeOnly: `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`,
    consentEEG:    consentState[0],
    consentVideo:  consentState[1],
    consentResearch: consentState[2],
    consentExport:   consentState[3],
    // EEG snapshot
    eegSnapshot: eegMetrics,
  };

  closeRegModal();

  // Update header button
  const btn = $('openRegBtn');
  btn.classList.add('registered');
  btn.innerHTML = `<div class="reg-dot"></div>${first.toUpperCase()} ${last.toUpperCase().slice(0,1)}.`;

  // Update session ID in neural metrics panel
  $('sessId').textContent = sid;

  addAlert(`Subject registered: ${window.regData.fullName} (${sid})`, 'ok');
  toast('SUBJECT REGISTERED', `${window.regData.fullName} enrolled successfully`, 'ok');

  // Trigger explode result after short delay
  setTimeout(() => showResultOverlay(), 600);
}

// ═══════════════════════════════════════════
// PARTICLE BURST / EXPLODE EFFECT