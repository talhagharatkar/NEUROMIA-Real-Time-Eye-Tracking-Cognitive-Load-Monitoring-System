import re
import sys

def enhance_file():
    with open('nop.html', 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()

    # 1. Update Regions
    new_regions = """
  function buildRegions(){
    const regions=[
      {name:'PREFRONTAL', id:'Prefrontal Cortex', pos:[0.0,0.6,1.2], scale:[0.5,0.4,0.4]},
      {name:'FRONTAL', id:'Frontal Lobe', pos:[0.0,0.9,0.8], scale:[0.6,0.5,0.6]},
      {name:'PARIETAL', id:'Parietal Lobe', pos:[0.0,1.0,-0.2], scale:[0.6,0.5,0.6]},
      {name:'TEMPORAL', id:'Temporal Lobe', pos:[0.8,0.0,0.2], scale:[0.3,0.4,0.6]},
      {name:'OCCIPITAL', id:'Occipital Lobe', pos:[0.0,0.1,-1.2], scale:[0.5,0.4,0.3]},
      {name:'VISUAL', id:'Visual Cortex', pos:[0.0,-0.1,-1.3], scale:[0.3,0.2,0.2]},
      {name:'THALAMUS', id:'Thalamus', pos:[0.0,-0.1,0.1], scale:[0.2,0.2,0.2]},
      {name:'HIPPOCAMPUS', id:'Hippocampus', pos:[0.4,-0.4,0.1], scale:[0.1,0.1,0.3]},
      {name:'AMYGDALA', id:'Amygdala', pos:[0.4,-0.5,0.4], scale:[0.1,0.1,0.1]},
      {name:'CEREBELLUM', id:'Cerebellum', pos:[0.0,-0.8,-1.0], scale:[0.4,0.3,0.3]},
      {name:'BRAINSTEM', id:'Brainstem', pos:[0.0,-1.2,-0.2], scale:[0.2,0.4,0.2]},
    ];
    const meshes=[];
    regions.forEach(r=>{
      const g=new THREE.SphereGeometry(1,32,32);
      const m=new THREE.MeshStandardMaterial({
        color: 0xE8B4A8,
        emissive: 0xE8B4A8,
        emissiveIntensity: 0.1,
        transparent: true,
        opacity: 0.15,
        depthWrite: false
      });
      const mesh=new THREE.Mesh(g,m); 
      mesh.position.set(...r.pos); 
      mesh.scale.set(...r.scale);
      mesh.userData.region=r;
      mesh.userData.baseColor = new THREE.Color(0xE8B4A8);
      mesh.userData.targetColor = new THREE.Color(0xE8B4A8);
      meshes.push({mesh, r, dot:mesh, halo:mesh}); // Mock dot/halo for compatibility
    });
    return meshes;
  }
"""

    content = re.sub(
        r'function buildRegions\(\)\{.*?(?=function buildFibers)', 
        new_regions, 
        content, 
        flags=re.DOTALL
    )

    # 2. Update Nerve to use InstancedMesh
    new_nerve = """
  function buildNerve(fromV,toV,color,numSignals){
    const mid=new THREE.Vector3(
      (fromV.x+toV.x)/2,
      (fromV.y+toV.y)/2-0.20,
      (fromV.z+toV.z)/2-0.28
    );
    const curve=new THREE.CatmullRomCurve3([fromV,mid,toV]);
    const tg=new THREE.TubeGeometry(curve,32,0.024,8,false);
    const tm=new THREE.MeshPhongMaterial({
      color,emissive:color,emissiveIntensity:0.55,transparent:true,opacity:0.65
    });
    const mesh = new THREE.Mesh(tg,tm);

    const ns = 1000;
    const sg = new THREE.SphereGeometry(0.015, 4, 4);
    const smat = new THREE.MeshBasicMaterial({color: 0x00E5FF, transparent:true, opacity:0.6});
    const instancedMesh = new THREE.InstancedMesh(sg, smat, ns);
    instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    
    const particles = [];
    for(let i=0; i<ns; i++){
      particles.push({
        t: Math.random(),
        speed: 0.001 + Math.random()*0.003
      });
    }

    return {mesh, instancedMesh, curve, particles, mat:tm, signals:[]};
  }
"""

    content = re.sub(
        r'function buildNerve\(.*?(?=function buildStarfield)', 
        new_nerve, 
        content, 
        flags=re.DOTALL
    )

    # 3. Add to scene logic
    scene_add_logic = """
    scene.add(nerveL.mesh); scene.add(nerveR.mesh);
    scene.add(nerveL.instancedMesh); scene.add(nerveR.instancedMesh);
"""
    content = re.sub(
        r'scene\.add\(nerveL\.mesh\); scene\.add\(nerveR\.mesh\);\s*nerveL\.signals\.forEach\(s=>scene\.add\(s\.mesh\)\);\s*nerveR\.signals\.forEach\(s=>scene\.add\(s\.mesh\)\);',
        scene_add_logic,
        content
    )
    
    scene_add_logic_motor = """
    scene.add(nerveMotorL.mesh);
    scene.add(nerveMotorL.instancedMesh);
"""
    content = re.sub(
        r'scene\.add\(nerveMotorL\.mesh\);\s*nerveMotorL\.signals\.forEach\(s=>scene\.add\(s\.mesh\)\);',
        scene_add_logic_motor,
        content
    )

    # 4. Animation logic for instanced mesh and regions
    anim_logic = """
    // ── REGION ACTIVATION ──
    if (brainGroup.userData.regions) {
      brainGroup.userData.regions.forEach(({mesh, r}) => {
         mesh.material.color.lerp(mesh.userData.targetColor, 0.05);
         mesh.material.emissive.lerp(mesh.userData.targetColor, 0.05);
      });
    }

    // ── OPTIC NERVE PARTICLES ──
    const updateInstancedMesh = (nerve) => {
      if (!nerve || !nerve.instancedMesh) return;
      const dummy = new THREE.Object3D();
      nerve.particles.forEach((p, i) => {
        p.t += p.speed;
        if(p.t > 1) p.t = 0;
        const pos = nerve.curve.getPoint(p.t);
        dummy.position.copy(pos);
        dummy.updateMatrix();
        nerve.instancedMesh.setMatrixAt(i, dummy.matrix);
      });
      nerve.instancedMesh.instanceMatrix.needsUpdate = true;
    };
    [nerveL, nerveR, nerveMotorL].forEach(updateInstancedMesh);

    // ── OLD OPTIC NERVE SIGNALS (eye \u2192 visual cortex) ──
"""

    content = re.sub(
        r'// ── OPTIC NERVE SIGNALS \(eye → visual cortex\) ──',
        anim_logic,
        content
    )

    # 5. UI Overlay CSS
    ui_css = """
/* FUTURISTIC UI OVERLAY */
.futuristic-overlay {
  position: absolute; top: 120px; right: 30px;
  width: 320px; background: rgba(8,8,28,0.85);
  border: 1px solid rgba(0,229,255,0.4); border-radius: 12px;
  padding: 20px; color: #fff; font-family: 'Share Tech Mono', monospace;
  box-shadow: 0 0 20px rgba(0,229,255,0.2);
  backdrop-filter: blur(10px); z-index: 1000;
  display: flex; flex-direction: column; gap: 10px;
  pointer-events: none;
}
.futuristic-overlay h2 {
  font-family: 'Orbitron', monospace; color: #00E5FF;
  font-size: 1.2rem; margin-bottom: 10px; text-transform: uppercase;
  border-bottom: 1px solid rgba(0,229,255,0.2); padding-bottom: 5px;
}
.ui-row { display: flex; justify-content: space-between; font-size: 0.9rem; }
.ui-val { color: #00ff88; font-weight: bold; }
.ui-val.red { color: #ff2d55; }
.loading-overlay {
  position: absolute; bottom: 30px; left: 50%; transform: translateX(-50%);
  background: rgba(0,0,0,0.8); border: 1px solid #ff2d55;
  padding: 15px 30px; border-radius: 8px; font-family: 'Orbitron', monospace;
  color: #fff; text-align: center; display: none; z-index: 1000;
}
.loading-overlay h3 { color: #ff2d55; font-size: 1.5rem; margin-bottom: 5px; }
.loading-bar { width: 200px; height: 10px; background: #333; margin: 0 auto; border-radius: 5px; overflow: hidden; }
.loading-fill { width: 0%; height: 100%; background: #ff2d55; transition: width 0.3s; }
"""
    content = content.replace('/* ── BUTTONS ── */', ui_css + '\n/* ── BUTTONS ── */')

    # 6. UI Overlay HTML
    ui_html = """
  <!-- FUTURISTIC UI OVERLAY -->
  <div class="futuristic-overlay" id="f_overlay">
    <h2>NEUROMIA SYSTEM READY</h2>
    <div class="ui-row"><span>Cognitive Load</span> <span class="ui-val" id="f_cog">24%</span></div>
    <div class="ui-row"><span>Attention</span> <span class="ui-val" id="f_att">89%</span></div>
    <div class="ui-row"><span>Eye Activity</span> <span class="ui-val" id="f_eye">Normal</span></div>
    <div class="ui-row"><span>Blink Rate</span> <span class="ui-val" id="f_blk">12/min</span></div>
    <div class="ui-row"><span>Neural Throughput</span> <span class="ui-val">1000 pkt/s</span></div>
    <div class="ui-row"><span>LSTM Status</span> <span class="ui-val">Predicting</span></div>
  </div>

  <div class="loading-overlay" id="load_overlay">
    <div>CURRENT REGION:</div>
    <h3 id="load_region">PREFRONTAL CORTEX</h3>
    <div class="loading-bar"><div class="loading-fill" id="load_fill"></div></div>
  </div>
"""
    content = content.replace('<div class="main-grid">', ui_html + '\n<div class="main-grid">')

    # 7. Add keyboard controls
    keys_logic = """
  // KEYBOARD CONTROLS
  let autoRotate = false;
  let nervesVisible = true;
  window.addEventListener('keydown', (e) => {
    if(e.code === 'Space') {
      autoRotate = !autoRotate;
      controls.autoRotate = autoRotate;
    }
    if(e.code === 'KeyR') {
      controls.reset();
    }
    if(e.code === 'KeyH') {
      nervesVisible = !nervesVisible;
      if(nerveL) { nerveL.mesh.visible = nervesVisible; nerveL.instancedMesh.visible = nervesVisible; }
      if(nerveR) { nerveR.mesh.visible = nervesVisible; nerveR.instancedMesh.visible = nervesVisible; }
      if(nerveMotorL) { nerveMotorL.mesh.visible = nervesVisible; nerveMotorL.instancedMesh.visible = nervesVisible; }
    }
    if(e.code === 'KeyL') {
      runLoadingDemo();
    }
    if(e.code === 'KeyE') {
      // Eye activity demo
      document.getElementById('f_eye').textContent = 'HIGH';
      document.getElementById('f_eye').className = 'ui-val red';
      setTimeout(()=> {
        document.getElementById('f_eye').textContent = 'Normal';
        document.getElementById('f_eye').className = 'ui-val';
      }, 3000);
    }
  });

  function runLoadingDemo() {
    const overlay = document.getElementById('load_overlay');
    const rName = document.getElementById('load_region');
    const fill = document.getElementById('load_fill');
    overlay.style.display = 'block';
    
    const seq = ['PREFRONTAL', 'THALAMUS', 'VISUAL', 'OCCIPITAL'];
    let step = 0;
    
    const interval = setInterval(() => {
      if(step >= seq.length) {
        clearInterval(interval);
        overlay.style.display = 'none';
        return;
      }
      rName.textContent = seq[step] + " CORTEX";
      fill.style.width = ((step+1)/seq.length * 100) + '%';
      
      // Highlight region
      if(brainGroup.userData.regions) {
        brainGroup.userData.regions.forEach(r => {
           if(r.r.name === seq[step]) {
             r.mesh.userData.targetColor.setHex(0xFF2D55); // Red
             setTimeout(()=> r.mesh.userData.targetColor.setHex(0xE8B4A8), 1000); // Back to coral
           }
        });
      }
      
      step++;
    }, 500);
  }

  // STARTUP ANIMATION
  const startup = () => {
    const f_overlay = document.getElementById('f_overlay');
    f_overlay.style.opacity = '0';
    brainGroup.traverse(c => { if(c.material) c.material.opacity = 0; });
    if(leftEye) leftEye.visible = false;
    if(rightEye) rightEye.visible = false;
    
    setTimeout(() => {
      // Fade in brain
      let op = 0;
      const fIn = setInterval(() => {
        op += 0.05;
        brainGroup.traverse(c => { 
           if(c.material && c.userData.region===undefined) c.material.opacity = op; 
        });
        if(op >= 1) clearInterval(fIn);
      }, 50);
    }, 500);

    setTimeout(() => {
       if(leftEye) leftEye.visible = true;
       if(rightEye) rightEye.visible = true;
       // double blink
       blink = 0.1; setTimeout(()=>blink=1, 100);
       setTimeout(()=>{ blink = 0.1; setTimeout(()=>blink=1, 100); }, 300);
    }, 2000);

    setTimeout(() => {
       f_overlay.style.transition = 'opacity 1s';
       f_overlay.style.opacity = '1';
    }, 3500);
  };
  // Wait a moment for scene to build then run startup
  setTimeout(startup, 500);

"""

    content = content.replace('// ── INITIAL RENDER ──', keys_logic + '\n// ── INITIAL RENDER ──')

    # Write back
    with open('nop.html', 'w', encoding='utf-8') as f:
        f.write(content)

if __name__ == '__main__':
    enhance_file()
