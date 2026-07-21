import re

def patch_keyboard_and_ui():
    with open('nop.html', 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()

    # 1. Add IDs to Neural Throughput and LSTM Status in HTML
    old_html = """    <div class="ui-row"><span>Neural Throughput</span> <span class="ui-val">1000 pkt/s</span></div>
    <div class="ui-row"><span>LSTM Status</span> <span class="ui-val">Predicting</span></div>"""
    
    new_html = """    <div class="ui-row"><span>Neural Throughput</span> <span class="ui-val" id="f_tp">0 pkts</span></div>
    <div class="ui-row"><span>LSTM Status</span> <span class="ui-val" id="f_lstm">OFFLINE</span></div>"""
    
    content = content.replace(old_html, new_html)

    # 2. Inject keyboard controls, runLoadingDemo, runEyeActivityDemo before the return of BrainViz
    injection_target = "return{init,setLoad,toggleRotate,resetView,spawnEffect,flashBrain};"
    
    keyboard_logic = """  // KEYBOARD CONTROLS & DEMO OVERLAY TRIGGER
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      toggleRotate();
    }
    if (e.code === 'KeyR') {
      resetView();
    }
    if (e.code === 'KeyH') {
      nervesVisible = !nervesVisible;
      if(nerveL) { nerveL.mesh.visible = nervesVisible; nerveL.instancedMesh.visible = nervesVisible; }
      if(nerveR) { nerveR.mesh.visible = nervesVisible; nerveR.instancedMesh.visible = nervesVisible; }
      if(nerveMotorL) { nerveMotorL.mesh.visible = nervesVisible; nerveMotorL.instancedMesh.visible = nervesVisible; }
    }
    if (e.code === 'KeyL') {
      runLoadingDemo();
    }
    if (e.code === 'KeyE') {
      runEyeActivityDemo();
    }
  });

  function runEyeActivityDemo() {
    const overlay = document.getElementById('f_eye');
    if (overlay) {
      overlay.textContent = 'HIGH (ACTIVE)';
      overlay.style.color = '#ff2d55';
    }
    if (brainGroup.userData.regions) {
      brainGroup.userData.regions.forEach(({mesh, r}) => {
        if (r.name === 'VISUAL' || r.name === 'OCCIPITAL') {
          mesh.userData.demoActive = true;
          setTimeout(() => { mesh.userData.demoActive = false; }, 3000);
        }
      });
    }
    setTimeout(() => {
      if (overlay) {
        overlay.textContent = 'Normal';
        overlay.style.color = '#00ff88';
      }
    }, 3000);
  }

  function runLoadingDemo() {
    const overlay = document.getElementById('load_overlay');
    const rName = document.getElementById('load_region');
    const fill = document.getElementById('load_fill');
    if (overlay) overlay.style.display = 'block';
    
    const seq = ['PREFRONTAL', 'THALAMUS', 'VISUAL', 'OCCIPITAL'];
    let step = 0;
    
    const interval = setInterval(() => {
      if (step >= seq.length) {
        clearInterval(interval);
        if (overlay) overlay.style.display = 'none';
        return;
      }
      if (rName) rName.textContent = seq[step] + " LOBE/CORTEX";
      if (fill) fill.style.width = ((step+1)/seq.length * 100) + '%';
      
      // Highlight region
      if (brainGroup.userData.regions) {
        brainGroup.userData.regions.forEach(({mesh, r}) => {
           if (r.name === seq[step]) {
             mesh.userData.demoActive = true;
             setTimeout(() => { mesh.userData.demoActive = false; }, 1000);
           }
        });
      }
      step++;
    }, 600);
  }

  """
  
    content = content.replace(injection_target, f"{keyboard_logic}\n  {injection_target}")

    # 3. Update the sync logic inside animate() loop to support the new IDs
    old_sync_code = """      const f_eye = document.getElementById('f_eye');
      const mGaze = document.getElementById('mGaze');
      if (f_eye && mGaze) f_eye.textContent = mGaze.textContent;"""

    new_sync_code = """      const f_eye = document.getElementById('f_eye');
      const mGaze = document.getElementById('mGaze');
      if (f_eye && mGaze) f_eye.textContent = mGaze.textContent;

      const f_tp = document.getElementById('f_tp');
      const dpCnt = document.getElementById('dpCnt');
      if (f_tp && dpCnt) {
        f_tp.textContent = dpCnt.textContent + ' pkts';
      }
      const f_lstm = document.getElementById('f_lstm');
      const lstmStatusBadge = document.getElementById('lstmStatusBadge');
      if (f_lstm && lstmStatusBadge) {
        f_lstm.textContent = lstmStatusBadge.textContent.replace('● ', '').replace('⟳ ', '');
      }"""

    content = content.replace(old_sync_code, new_sync_code)

    with open('nop.html', 'w', encoding='utf-8') as f:
        f.write(content)

if __name__ == '__main__':
    patch_keyboard_and_ui()
