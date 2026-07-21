import re

def fix_brain_html():
    with open('nop.html', 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()

    # 1. Import OrbitControls in <head> right after three.js
    three_script = '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>'
    orbit_script = '<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>'
    content = content.replace(three_script, f'{three_script}\n{orbit_script}')

    # 2. Add controls, nervesVisible global variables
    var_line = 'let autoRotate=true,cogLoad=0,mouseDown=false,lastMX=0,lastMY=0;'
    new_vars = 'let autoRotate=true,cogLoad=0,mouseDown=false,lastMX=0,lastMY=0,controls,nervesVisible=true;'
    content = content.replace(var_line, new_vars)

    # 3. Replace mouse listeners in init() with OrbitControls
    mouse_listeners_pattern = r'// Mouse/touch drag.*?window\.addEventListener\(\'resize\',onResize\);'
    orbit_init = """// OrbitControls for Drag/Rotate/Zoom/Pan
    controls = new THREE.OrbitControls(cam, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 4;
    controls.maxDistance = 18;
    controls.target.set(0, 0, 0);

    window.addEventListener('resize',onResize);"""
    
    content = re.sub(mouse_listeners_pattern, orbit_init, content, flags=re.DOTALL)

    # 4. Replace manual auto-rotation in animate() with controls.update()
    manual_rotate = 'if(autoRotate&&brainGroup) brainGroup.rotation.y+=0.0030;'
    controls_update = """if (controls) {
      controls.autoRotate = autoRotate;
      controls.update();
    }"""
    content = content.replace(manual_rotate, controls_update)

    # 5. Fix TypeError in nerve opacity update loop
    old_nerve_glow = 'nerve.mat.opacity=0.40+Math.sin(t*3.8+nerve.signals[0].t*4)*0.22+(cogLoad/100)*0.18;'
    new_nerve_glow = 'nerve.mat.opacity=0.40+Math.sin(t*3.8)*0.22+(cogLoad/100)*0.18;'
    content = content.replace(old_nerve_glow, new_nerve_glow)

    # 6. Update region coloring lerping and map it to real metrics in animate()
    region_lerp_old = """    if (brainGroup.userData.regions) {
      brainGroup.userData.regions.forEach(({mesh, r}) => {
         mesh.material.color.lerp(mesh.userData.targetColor, 0.05);
         mesh.material.emissive.lerp(mesh.userData.targetColor, 0.05);
      });
    }"""

    region_lerp_new = """    if (brainGroup.userData.regions) {
      // Sync Futuristic UI Overlay with real-time variables in animate loop
      const f_cog = document.getElementById('f_cog');
      if (f_cog) f_cog.textContent = Math.round(cogLoad) + '%';
      const f_att = document.getElementById('f_att');
      const mAttn = document.getElementById('mAttn');
      if (f_att && mAttn) f_att.textContent = mAttn.textContent;
      const f_blk = document.getElementById('f_blk');
      const mBlink = document.getElementById('mBlink');
      if (f_blk && mBlink) f_blk.textContent = mBlink.textContent;
      const f_eye = document.getElementById('f_eye');
      const mGaze = document.getElementById('mGaze');
      if (f_eye && mGaze) f_eye.textContent = mGaze.textContent;

      brainGroup.userData.regions.forEach(({mesh, r}) => {
         let targetHex = 0xE8B4A8; // Default idle Coral
         
         const attnVal = parseFloat(mAttn ? mAttn.textContent : '0') || 0;
         const gazeVal = parseFloat(mGaze ? mGaze.textContent : '0') || 0;
         const blinkVal = parseFloat(mBlink ? mBlink.textContent : '0') || 0;
         
         let loadLevel = 'low';
         if (cogLoad > 75) loadLevel = 'high';
         else if (cogLoad > 40) loadLevel = 'med';
         
         let loadColor = 0xE8B4A8;
         if (loadLevel === 'high') loadColor = 0xFF2D55; // Strong red glow
         else if (loadLevel === 'med') loadColor = 0xFF9900; // Orange
         else loadColor = 0xFF66AA; // Pink
         
         if (r.name === 'PREFRONTAL' || r.name === 'THALAMUS') {
           if (attnVal > 70) targetHex = loadColor;
         } else if (r.name === 'VISUAL' || r.name === 'OCCIPITAL') {
           if (gazeVal > 60 || attnVal > 50) targetHex = loadColor;
         } else if (r.name === 'BRAINSTEM') {
           if (blinkVal < 10) targetHex = loadColor;
         }
         
         if (mesh.userData.demoActive) {
           targetHex = 0xFF2D55; // Red loading override
         }
         
         const targetColorObj = new THREE.Color(targetHex);
         mesh.material.color.lerp(targetColorObj, 0.05);
         mesh.material.emissive.lerp(targetColorObj, 0.05);
         
         let targetOpacity = 0.15;
         if (mesh.userData.demoActive) targetOpacity = 0.7;
         else if (targetHex !== 0xE8B4A8) targetOpacity = 0.45;
         
         mesh.material.opacity = THREE.MathUtils.lerp(mesh.material.opacity, targetOpacity, 0.05);
      });
    }"""
    
    content = content.replace(region_lerp_old, region_lerp_new)

    # 7. Modify startup to dynamically configure transparency properly
    old_startup = """  // STARTUP ANIMATION
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
  setTimeout(startup, 500);"""

    new_startup = """  // STARTUP ANIMATION
  const startup = () => {
    const f_overlay = document.getElementById('f_overlay');
    if (f_overlay) f_overlay.style.opacity = '0';
    
    brainGroup.traverse(c => { 
      if(c.material) {
        c.material.transparent = true;
        c.material.opacity = 0; 
      }
    });
    if(leftEye) leftEye.visible = false;
    if(rightEye) rightEye.visible = false;
    
    setTimeout(() => {
      // Fade in brain
      let op = 0;
      const fIn = setInterval(() => {
        op += 0.05;
        brainGroup.traverse(c => { 
           if(c.material && c.userData.region===undefined) {
             c.material.opacity = op;
             if (op >= 1) {
               // Restore normal rendering properties once visible
               c.material.transparent = (c === buildDura() || c.userData.region !== undefined); 
             }
           }
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
       if (f_overlay) {
         f_overlay.style.transition = 'opacity 1s';
         f_overlay.style.opacity = '1';
       }
    }, 3500);
  };
  // Wait a moment for scene to build then run startup
  setTimeout(startup, 500);"""

    content = content.replace(old_startup, new_startup)

    with open('nop.html', 'w', encoding='utf-8') as f:
        f.write(content)

if __name__ == '__main__':
    fix_brain_html()
