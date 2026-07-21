// ═══════════════════════════════════════════
// PERLIN-LIKE NOISE (for brain surface)
// ═══════════════════════════════════════════
function fade(t){return t*t*t*(t*(t*6-15)+10);}
function lerp(a,b,t){return a+t*(b-a);}
function grad(h,x,y,z){
  h&=15;const u=h<8?x:y,v=h<4?y:h===12||h===14?x:z;
  return((h&1)?-u:u)+((h&2)?-v:v);
}
const perm=(()=>{
  const p=[151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,
    103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,
    62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,
    136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,
    229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,
    25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,
    116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,
    202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,
    28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,
    43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,
    218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,
    145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,
    115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,
    141,128,195,78,66,215,61,156,180];
  const pp=new Uint8Array(512);
  for(let i=0;i<256;i++) pp[i]=pp[i+256]=p[i];
  return pp;
})();
function noise3(x,y,z){
  const xi=Math.floor(x)&255,yi=Math.floor(y)&255,zi=Math.floor(z)&255;
  const xf=x-Math.floor(x),yf=y-Math.floor(y),zf=z-Math.floor(z);
  const u=fade(xf),v=fade(yf),w=fade(zf);
  const a=perm[xi]+yi,aa=perm[a]+zi,ab=perm[a+1]+zi;
  const b=perm[xi+1]+yi,ba=perm[b]+zi,bb=perm[b+1]+zi;
  return lerp(
    lerp(lerp(grad(perm[aa],xf,yf,zf),grad(perm[ba],xf-1,yf,zf),u),
         lerp(grad(perm[ab],xf,yf-1,zf),grad(perm[bb],xf-1,yf-1,zf),u),v),
    lerp(lerp(grad(perm[aa+1],xf,yf,zf-1),grad(perm[ba+1],xf-1,yf,zf-1),u),
         lerp(grad(perm[ab+1],xf,yf-1,zf-1),grad(perm[bb+1],xf-1,yf-1,zf-1),u),v),
    w);
}
// ── Ridged-multifractal helpers — produce elongated, vein-like ridges
// that read as authentic cortical gyri/sulci instead of blobby lumps ──
function ridgeN(n){ return 1-Math.abs(n); }
function fbm(x,y,z,octaves,freq,lac,gain){
  let amp=1,f=freq,sum=0,norm=0;
  for(let o=0;o<octaves;o++){
    sum+=noise3(x*f,y*f,z*f)*amp; norm+=amp;
    f*=lac; amp*=gain;
  }
  return sum/norm;
}
function fbmRidge(x,y,z,octaves,freq,lac,gain){
  let amp=1,f=freq,sum=0,norm=0,prev=1;
  for(let o=0;o<octaves;o++){
    let n=ridgeN(noise3(x*f,y*f,z*f));
    n=n*n*prev; prev=n;
    sum+=n*amp; norm+=amp;
    f*=lac; amp*=gain;
  }
  return sum/norm;
}

// ═══════════════════════════════════════════
// 3D BRAIN VISUALIZATION
// ═══════════════════════════════════════════
const BrainViz=(()=>{
  let scene,cam,renderer,brainGroup;
  let lHemi,rHemi,lOutline,rOutline;
  let leftEye,rightEye,nerveL,nerveR,nerveMotorL;
  let autoRotate=true,cogLoad=0,mouseDown=false,lastMX=0,lastMY=0,controls,nervesVisible=true;
  let particleSystems=[];

  // ══════════════════════════════════════════
  // REALISTIC HUMAN BRAIN HEMISPHERE
  // Resolution 8 icosahedron + 5-octave noise
  // for authentic human gyri/sulci morphology
  // ══════════════════════════════════════════
  function buildHemisphere(side){
    const geo=new THREE.IcosahedronGeometry(1.0,36);
    const pos=geo.attributes.position;
    const colors=new Float32Array(pos.count*3);

    const deep=new THREE.Color(0x5c332f);    // dark sulcus shadow (red-brown groove)
    const mid =new THREE.Color(0xb97768);    // mid cortex tone
    const ridgeCol=new THREE.Color(0xe2ab9b);// light gyral crown (coral pink)

    for(let i=0;i<pos.count;i++){
      let x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);
      const len=Math.sqrt(x*x+y*y+z*z)+0.0001;
      const nx=x/len,ny=y/len,nz=z/len;

      // Anatomically accurate proportions
      x=nx*1.56; y=ny*1.34; z=nz*1.32;

      // Interhemispheric fissure — smooth falloff (no hard crease)
      {
        const cut=-0.05*side;
        const w=THREE.MathUtils.smoothstep(x*side,-0.16,0.02);
        x=cut+(x-cut)*w;
      }
      // Basal surface flattening — smooth blend
      {
        const w=THREE.MathUtils.smoothstep(y,-0.62,-0.12);
        const flat=(y+0.32)*0.55-0.32;
        y=flat+(y-flat)*w;
      }
      // Frontal pole bulge
      {
        const wz=THREE.MathUtils.smoothstep(z,0.30,0.85);
        const wy=THREE.MathUtils.smoothstep(y,-0.35,0.15);
        x*=(1+0.07*wz*wy); y*=(1+0.08*wz*wy);
      }
      // Occipital bulge
      {
        const w=THREE.MathUtils.smoothstep(-z,0.25,0.85);
        x*=(1-0.05*w); z*=(1+0.13*w);
      }
      // Temporal lobe broadening
      {
        const w=THREE.MathUtils.smoothstep(Math.abs(x*side),0.55,0.95)*THREE.MathUtils.smoothstep(-y,-0.25,0.3);
        y*=(1-0.10*w); x*=(1+0.04*w);
      }

      const sx=x,sy=y,sz=z;

      // Domain warp — bends the sampling space so folds wind organically
      // instead of tracing the noise lattice (avoids a "checkerboard" look)
      const warpAmp=0.45;
      const wx=sx+fbm(sx*0.85+17,sy*0.85+17,sz*0.85+17,2,1,2,0.5)*warpAmp;
      const wy2=sy+fbm(sx*0.85+91,sy*0.85+91,sz*0.85+91,2,1,2,0.5)*warpAmp;
      const wz2=sz+fbm(sx*0.85+53,sy*0.85+53,sz*0.85+53,2,1,2,0.5)*warpAmp;

      // Large-scale gentle undulation (lobe-scale bulges)
      const big=fbm(sx,sy,sz,3,0.7,2.0,0.5)*0.05;
      // Ridged multifractal — elongated gyral ridges / sulcal valleys
      const ridgeField=fbmRidge(wx,wy2,wz2,4,3.6,2.0,0.52); // 0..1
      // Fine high-frequency surface micro-texture
      const micro=noise3(sx*26+11,sy*26+11,sz*26+11)*0.006;

      const foldAmp=0.115;
      const fold=(ridgeField-0.50)*foldAmp;
      const bump=big+fold+micro;

      const nl=Math.sqrt(x*x+y*y+z*z)+0.001;
      x+=(x/nl)*bump; y+=(y/nl)*bump; z+=(z/nl)*bump;
      pos.setXYZ(i,x,y,z);

      // Vertex color from ridge field (deep sulci = dark, gyral crowns = light)
      let t=THREE.MathUtils.clamp((ridgeField-0.30)/0.46,0,1);
      const c=deep.clone().lerp(mid,Math.min(1,t*1.3)).lerp(ridgeCol,Math.max(0,t-0.6)*2.5);
      const fissureDist=Math.abs(x);
      if(fissureDist<0.12){ c.multiplyScalar(0.5+fissureDist*4.2); }
      colors[i*3]=c.r; colors[i*3+1]=c.g; colors[i*3+2]=c.b;
    }
    geo.setAttribute('color',new THREE.BufferAttribute(colors,3));
    geo.computeVertexNormals();

    // Authentic human cortex material — vertex-shaded gyri/sulci
    const mat=new THREE.MeshPhongMaterial({
      color:0xffffff,
      vertexColors:true,
      emissive:0x150606,
      emissiveIntensity:0.06,
      specular:0x221512,
      shininess:14,
      transparent:false,
      side:THREE.FrontSide
    });
    const mesh=new THREE.Mesh(geo,mat);
    mesh.position.x=side*0.055;
    return mesh;
  }

  // ══════════════════════════════════════════
  // COGNITIVE-LOAD RED OUTLINE MESH
  // BackSide trick: slightly expanded, inverted
  // normals render as a glowing red rim/outline.
  // Opacity is 0 at low load → 0.85 at overload.
  // ══════════════════════════════════════════
  function buildOutline(side){
    const geo=new THREE.IcosahedronGeometry(1.0,10);
    const pos=geo.attributes.position;
    for(let i=0;i<pos.count;i++){
      let x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);
      const len=Math.sqrt(x*x+y*y+z*z)+0.0001;
      const nx=x/len,ny=y/len,nz=z/len;
      x=nx*1.66; y=ny*1.42; z=nz*1.40;
      {
        const cut=-0.05*side;
        const w=THREE.MathUtils.smoothstep(x*side,-0.16,0.02);
        x=cut+(x-cut)*w;
      }
      {
        const w=THREE.MathUtils.smoothstep(y,-0.62,-0.12);
        const flat=(y+0.32)*0.55-0.32;
        y=flat+(y-flat)*w;
      }
      {
        const wz=THREE.MathUtils.smoothstep(z,0.30,0.85);
        const wy=THREE.MathUtils.smoothstep(y,-0.35,0.15);
        x*=(1+0.07*wz*wy); y*=(1+0.08*wz*wy);
      }
      {
        const w=THREE.MathUtils.smoothstep(-z,0.25,0.85);
        x*=(1-0.05*w); z*=(1+0.13*w);
      }
      const sx=x,sy=y,sz=z;
      const bump=fbm(sx,sy,sz,3,0.7,2.0,0.5)*0.05
               +(fbmRidge(sx,sy,sz,3,3.6,2.0,0.52)-0.5)*0.10;
      const nl=Math.sqrt(x*x+y*y+z*z)+0.001;
      x+=(x/nl)*bump; y+=(y/nl)*bump; z+=(z/nl)*bump;
      pos.setXYZ(i,x,y,z);
    }
    geo.computeVertexNormals();
    const mat=new THREE.MeshBasicMaterial({
      color:0xff1100,
      transparent:true,
      opacity:0.0,
      side:THREE.BackSide
    });
    const mesh=new THREE.Mesh(geo,mat);
    mesh.position.x=side*0.055;
    return{mesh,mat};
  }

  // ══════════════════════════════════════════
  // BLOOD VESSELS — red veins on brain surface
  // ══════════════════════════════════════════
  function buildVessels(side){
    const grp=new THREE.Group();
    // Use a seeded-like pattern for consistent appearance
    const seed=[0.12,0.45,0.78,0.23,0.67,0.34,0.89,0.11,0.56,0.90,
                0.03,0.72,0.38,0.61,0.17,0.84,0.29,0.50,0.95,0.42,0.08,0.76];
    for(let v=0;v<22;v++){
      const angle=(v/22)*Math.PI*1.85+(side<0?0:Math.PI*0.05);
      const pts=[];
      const r0=seed[v]*0.4+0.8;
      let px=Math.cos(angle)*r0*side*1.55;
      let py=(seed[(v+3)%22]-0.3)*1.1;
      let pz=Math.sin(angle)*1.28;
      for(let s=0;s<11;s++){
        const nl=Math.sqrt(px*px+py*py+pz*pz)+0.001;
        const rad=1.58+seed[(v+s)%22]*0.07;
        pts.push(new THREE.Vector3(px/nl*rad,py/nl*1.22,pz/nl*1.30));
        px+=(seed[(v*s+1)%22]-0.5)*0.24;
        py+=(seed[(v*s+2)%22]-0.5)*0.16;
        pz+=(seed[(v*s+3)%22]-0.5)*0.22;
      }
      const geo=new THREE.BufferGeometry().setFromPoints(pts);
      const op=0.28+seed[(v+7)%22]*0.28;
      const mat=new THREE.LineBasicMaterial({color:0xaa2211,transparent:true,opacity:op});
      grp.add(new THREE.Line(geo,mat));
    }
    return grp;
  }

  // ── Cerebellum ──
  function buildCerebellum(){
    const geo=new THREE.IcosahedronGeometry(0.50,20);
    const pos=geo.attributes.position;
    const colors=new Float32Array(pos.count*3);
    const deep=new THREE.Color(0x5c332f),mid=new THREE.Color(0xaa6e5c),ridgeCol=new THREE.Color(0xd99e8a);
    for(let i=0;i<pos.count;i++){
      let x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);
      x*=1.70; y*=0.62; z*=1.18;
      // fine, tight, mostly-parallel folia ridges (cerebellum's signature look)
      const folia=ridgeN(noise3(x*9.0,y*2.2,z*9.0));
      const folia2=ridgeN(noise3(x*9.0+30,y*2.2+30,z*9.0+30)*1.6)*0.5;
      const r=Math.pow(Math.max(folia,folia2*0.7),2.2);
      const bump=(r-0.5)*0.075+noise3(x*16,y*16,z*16)*0.012;
      const nl=Math.sqrt(x*x+y*y+z*z)+0.001;
      x+=x/nl*bump; y+=y/nl*bump; z+=z/nl*bump;
      pos.setXYZ(i,x,y,z);
      const t=THREE.MathUtils.clamp((r-0.35)/0.5,0,1);
      const c=deep.clone().lerp(mid,Math.min(1,t*1.3)).lerp(ridgeCol,Math.max(0,t-0.6)*2.5);
      colors[i*3]=c.r;colors[i*3+1]=c.g;colors[i*3+2]=c.b;
    }
    geo.setAttribute('color',new THREE.BufferAttribute(colors,3));
    geo.computeVertexNormals();
    const mat=new THREE.MeshPhongMaterial({
      color:0xffffff,vertexColors:true,emissive:0x120505,emissiveIntensity:0.06,
      specular:0x221512,shininess:14
    });
    const m=new THREE.Mesh(geo,mat);
    m.position.set(0,-0.92,-1.02);
    return m;
  }

  // ── Brainstem ──
  function buildBrainstem(){
    const geo=new THREE.CylinderGeometry(0.19,0.27,0.86,24,6);
    const pos=geo.attributes.position;
    for(let i=0;i<pos.count;i++){
      let x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);
      const n=noise3(x*8,y*4,z*8)*0.018;
      x+=n; z+=n*0.8;
      pos.setXYZ(i,x,y,z);
    }
    geo.computeVertexNormals();
    const mat=new THREE.MeshPhongMaterial({
      color:0xa9705c,emissive:0x0e0604,emissiveIntensity:0.07,specular:0x2a1410,shininess:18
    });
    const m=new THREE.Mesh(geo,mat);
    m.position.set(0,-1.28,-0.34); m.rotation.x=0.32;
    return m;
  }

  // ── Meningeal dura shell ──
  function buildDura(){
    const geo=new THREE.IcosahedronGeometry(1.72,3);
    const mat=new THREE.MeshBasicMaterial({color:0x00e5ff,transparent:true,opacity:0.015,side:THREE.BackSide});
    return new THREE.Mesh(geo,mat);
  }

  // ── Brain region dots ──
  
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
function buildFibers(regionList){
    const lines=[];
    const pairs=[[0,3],[0,4],[1,3],[1,4],[2,3],[2,4],[3,4],[5,0],[5,1]];
    pairs.forEach(([a,b])=>{
      const pa=new THREE.Vector3(...regionList[a].r.pos);
      const pb=new THREE.Vector3(...regionList[b].r.pos);
      const mid=new THREE.Vector3(
        (pa.x+pb.x)/2+(Math.random()-.5)*.2,
        (pa.y+pb.y)/2+(Math.random()-.5)*.2,
        (pa.z+pb.z)/2
      );
      const curve=new THREE.CatmullRomCurve3([pa,mid,pb]);
      const pts=curve.getPoints(24);
      const geo=new THREE.BufferGeometry().setFromPoints(pts);
      const mat=new THREE.LineBasicMaterial({color:0x00e5ff,transparent:true,opacity:0.18});
      lines.push(new THREE.Line(geo,mat));
    });
    return lines;
  }

  // ══════════════════════════════════════════
  // REALISTIC HUMAN EYE
  // Sclera + limbus ring + iris + pupil +
  // corneal highlight + specular spot
  // ══════════════════════════════════════════
  function buildEye(side){
    const grp=new THREE.Group();
    const Rs=0.27; // sclera radius — realistic ~1/6 of brain width

    // Sclera (white)
    const sg=new THREE.SphereGeometry(Rs,32,32);
    const sm=new THREE.MeshPhongMaterial({
      color:0xf2ede6,emissive:0x0a0604,emissiveIntensity:0.03,
      specular:0xffffff,shininess:90,transparent:true,opacity:0.98
    });
    grp.add(new THREE.Mesh(sg,sm));

    // Iris + pupil bulge OUTWARD past the sclera radius — the cornea/iris
    // dome anatomically protrudes slightly from the eyeball's main curvature,
    // which is what actually makes them visible (otherwise they're swallowed
    // by the sclera sphere and read as a blank white ball).
    const irisR=0.135, irisZ=0.205;
    const ig=new THREE.SphereGeometry(irisR,28,28);
    const im=new THREE.MeshPhongMaterial({
      color:0x6b4226,emissive:0x2a1608,emissiveIntensity:0.35,
      specular:0xc8a060,shininess:120
    });
    const iris=new THREE.Mesh(ig,im);
    iris.position.z=irisZ;
    grp.add(iris);

    // Limbus — dark ring marking the iris/sclera boundary
    const lg=new THREE.TorusGeometry(irisR*0.97,0.014,10,40);
    const lm=new THREE.MeshPhongMaterial({color:0x140906,emissive:0x080302,shininess:4});
    const limbus=new THREE.Mesh(lg,lm);
    limbus.position.z=irisZ-0.02;
    grp.add(limbus);

    // Pupil
    const pg=new THREE.SphereGeometry(0.062,14,14);
    const pm=new THREE.MeshPhongMaterial({color:0x010101,shininess:300});
    const pupil=new THREE.Mesh(pg,pm);
    pupil.position.z=irisZ+0.05;
    grp.add(pupil);

    // Clear corneal dome over the iris — subtle glassy sheen
    const cg=new THREE.SphereGeometry(irisR*1.08,20,20,0,Math.PI*2,0,Math.PI*0.6);
    const cm=new THREE.MeshPhongMaterial({color:0xffffff,transparent:true,opacity:0.10,specular:0xffffff,shininess:200});
    const cornea=new THREE.Mesh(cg,cm);
    cornea.position.z=irisZ-0.05;
    grp.add(cornea);

    // Bright specular highlight dot
    const spg=new THREE.SphereGeometry(0.024,10,10);
    const spm=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0.9});
    const sp=new THREE.Mesh(spg,spm);
    sp.position.set(0.055,0.075,irisZ+0.075);
    grp.add(sp);

    // Anatomical placement: front of skull, close to the brain mass
    // (not flung out to the sides like ears)
    grp.position.set(side*0.40,-0.62,1.62);
    grp.rotation.y=side*0.32;
    grp.userData={iris,pupil,baseEmissive:0x2a1608};
    return grp;
  }

  // ══════════════════════════════════════════
  // OPTIC NERVE with ANIMATED SIGNAL PARTICLES
  // Glowing dots travel from eye → visual cortex
  // Speed increases with cognitive load
  // ══════════════════════════════════════════
  
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
function buildStarfield(){
    const cnt=400,pts=new Float32Array(cnt*3);
    for(let i=0;i<cnt;i++){
      pts[i*3]=(Math.random()-.5)*28;
      pts[i*3+1]=(Math.random()-.5)*22;
      pts[i*3+2]=(Math.random()-.5)*28-8;
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.BufferAttribute(pts,3));
    const m=new THREE.PointsMaterial({color:0x00e5ff,size:0.04,transparent:true,opacity:0.20});
    return new THREE.Points(g,m);
  }

  // ══════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════
  function init(){
    const canvas=$('brainCanvas');
    if(!canvas||!THREE) return;

    scene=new THREE.Scene();
    scene.background=new THREE.Color(0x050510);
    scene.fog=new THREE.FogExp2(0x050510,0.050);

    const W=canvas.clientWidth,H=canvas.clientHeight;
    cam=new THREE.PerspectiveCamera(40,W/H,0.1,1000);
    cam.position.set(0,1.5,8.5);
    cam.lookAt(0,0,0);

    renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});
    renderer.setSize(W,H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));

    // Medical imaging studio lighting
    scene.add(new THREE.AmbientLight(0x907880,0.48));
    const keyL=new THREE.DirectionalLight(0xffe8d0,1.55);
    keyL.position.set(3,7,5); scene.add(keyL);
    const fillL=new THREE.DirectionalLight(0x4488bb,0.42);
    fillL.position.set(-5,2,-3); scene.add(fillL);
    const rimL=new THREE.DirectionalLight(0x00e5ff,0.28);
    rimL.position.set(0,-3,6); scene.add(rimL);
    const topL=new THREE.DirectionalLight(0xfff0e8,0.38);
    topL.position.set(0,9,2); scene.add(topL);
    const backPt=new THREE.PointLight(0xff4488,0.22,20);
    backPt.position.set(0,4,-4); scene.add(backPt);

    // Brain group
    brainGroup=new THREE.Group();

    lHemi=buildHemisphere(-1);
    rHemi=buildHemisphere(1);
    brainGroup.userData.lHemi=lHemi;
    brainGroup.userData.rHemi=rHemi;
    brainGroup.add(lHemi,rHemi);

    brainGroup.add(buildCerebellum());
    brainGroup.add(buildBrainstem());
    brainGroup.add(buildDura());

    // Cognitive-load outline meshes
    const outL=buildOutline(-1), outR=buildOutline(1);
    lOutline=outL; rOutline=outR;
    brainGroup.add(outL.mesh,outR.mesh);

    const regionMeshes=buildRegions();
    regionMeshes.forEach(({dot,halo})=>{brainGroup.add(dot);brainGroup.add(halo);});
    brainGroup.userData.regions=regionMeshes;
    buildFibers(regionMeshes).forEach(l=>brainGroup.add(l));

    brainGroup.rotation.x=-0.18;
    scene.add(brainGroup);

    // Realistic eyes
    leftEye=buildEye(-1); rightEye=buildEye(1);
    scene.add(leftEye); scene.add(rightEye);

    // Optic nerves: eye → base of brain near the optic chiasm
    // (short anatomically-correct path; full eye→occipital-cortex visual
    // processing is represented separately by the VC region marker/fibers)
    nerveL=buildNerve(
      new THREE.Vector3(-0.40,-0.62,1.62),
      new THREE.Vector3(-0.12,-0.50,0.55),0x00e5ff,5);
    nerveR=buildNerve(
      new THREE.Vector3(0.40,-0.62,1.62),
      new THREE.Vector3(0.12,-0.50,0.55),0x00e5ff,5);
    
    scene.add(nerveL.mesh); scene.add(nerveR.mesh);
    scene.add(nerveL.instancedMesh); scene.add(nerveR.instancedMesh);


    // Motor cortex → eye FEF fibers
    nerveMotorL=buildNerve(
      new THREE.Vector3(-0.6,0.65,1.0),
      new THREE.Vector3(-0.40,-0.62,1.62),0xff2d55,3);
    
    scene.add(nerveMotorL.mesh);
    scene.add(nerveMotorL.instancedMesh);


    scene.add(buildStarfield());

    // OrbitControls for Drag/Rotate/Zoom/Pan
    controls = new THREE.OrbitControls(cam, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 4;
    controls.maxDistance = 18;
    controls.target.set(0, 0, 0);

    window.addEventListener('resize',onResize);
    // ── BUG FIX: pause render loop when tab is hidden to save GPU/battery ──
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        renderer.setAnimationLoop(null);
      } else {
        renderer.setAnimationLoop(animate);
      }
    });
    animate();
  }

  // ══════════════════════════════════════════
  // ANIMATION LOOP
  // ══════════════════════════════════════════
  function animate(){
    requestAnimationFrame(animate);
    const t=Date.now()*0.001;

    if (controls) {
      controls.autoRotate = autoRotate;
      controls.update();
    }

    // Breathing pulse
    if(brainGroup){
      const p=1+Math.sin(t*1.05)*0.010;
      brainGroup.scale.setScalar(p);
    }

    // ── COGNITIVE LOAD → BRAIN COLOR + RED OUTLINE ──
    if(lHemi&&rHemi){
      // Emissive warmth shifts with load
      let emR,emG,emB;
      if(cogLoad<25){      emR=0.06;emG=0.04;emB=0.08;}
      else if(cogLoad<50){ emR=0.10;emG=0.05;emB=0.05;}
      else if(cogLoad<70){ emR=0.18;emG=0.05;emB=0.03;}
      else if(cogLoad<85){ emR=0.28;emG=0.04;emB=0.02;}
      else{                emR=0.40;emG=0.03;emB=0.01;}
      const emC=new THREE.Color(emR,emG,emB);
      [lHemi,rHemi].forEach(h=>h.material.emissive.lerp(emC,0.045));

      // ── RED OUTLINE — appears when cogLoad > 30, intensifies to overload ──
      let targetOpacity=0;
      if(cogLoad>30){
        // linear scale: 30→0.0, 100→0.85
        targetOpacity=Math.min(0.85,(cogLoad-30)/70*0.85);
      }
      // Pulsing at high load
      let pulseScale=1;
      if(cogLoad>70){
        pulseScale=0.65+Math.abs(Math.sin(t*(2.5+cogLoad*0.025)))*0.55;
      }
      const finalOpacity=targetOpacity*pulseScale;
      // Smooth lerp to avoid jumps
      lOutline.mat.opacity+=(finalOpacity-lOutline.mat.opacity)*0.07;
      rOutline.mat.opacity+=(finalOpacity-rOutline.mat.opacity)*0.07;

      // Red colour tint on hemispheres at very high load
      if(cogLoad>75){
        const redTint=new THREE.Color(0.38+Math.abs(Math.sin(t*3))*0.12, 0.04, 0.01);
        [lHemi,rHemi].forEach(h=>h.material.emissive.lerp(redTint,0.06));
      }

      // Region dots pulse faster and brighter with load
      if(brainGroup.userData.regions){
        const loadBoost=cogLoad/100;
        brainGroup.userData.regions.forEach(({dot,halo},i)=>{
          const freq=1.3+i*0.25+loadBoost*1.5;
          const base=0.4+loadBoost*0.4;
          dot.material.emissiveIntensity=base+Math.sin(t*freq)*0.42;
          dot.scale.setScalar(0.85+Math.sin(t*freq)*0.16);
          halo.material.opacity=0.07+loadBoost*0.18;
        });
      }
    }

    // ── REALISTIC EYE ANIMATION ──
    if(leftEye&&rightEye){
      // Natural blink at irregular intervals
      const blink=Math.sin(t*0.62)>0.93||(Math.sin(t*0.17)>0.97)?0.06:1;
      leftEye.scale.y=blink; rightEye.scale.y=blink;

      // Iris glow intensity driven by cognitive load
      const irBase=0.45+Math.sin(t*3.0)*0.30;
      const irExtra=cogLoad/100*0.55;
      leftEye.userData.iris.material.emissiveIntensity=irBase+irExtra;
      rightEye.userData.iris.material.emissiveIntensity=irBase+irExtra;

      // Subtle saccadic micro-movements
      leftEye.position.x=-1.34+Math.sin(t*0.31)*0.10+Math.sin(t*1.7)*0.03;
      rightEye.position.x=1.34+Math.sin(t*0.31)*0.10+Math.sin(t*1.7)*0.03;
      leftEye.position.y=-0.26+Math.sin(t*0.47)*0.055;
      rightEye.position.y=-0.26+Math.sin(t*0.47)*0.055;

      // Eye tracks toward brain with increasing load
      const lookBias=cogLoad/100*0.08;
      leftEye.rotation.y=-0.15-lookBias;
      rightEye.rotation.y=0.15+lookBias;
    }

    
    // ── REGION ACTIVATION ──
    if (brainGroup.userData.regions) {
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

      const f_tp = document.getElementById('f_tp');
      const dpCnt = document.getElementById('dpCnt');
      if (f_tp && dpCnt) {
        f_tp.textContent = dpCnt.textContent + ' pkts';
      }
      const f_lstm = document.getElementById('f_lstm');
      const lstmStatusBadge = document.getElementById('lstmStatusBadge');
      if (f_lstm && lstmStatusBadge) {
        f_lstm.textContent = lstmStatusBadge.textContent.replace('● ', '').replace('⟳ ', '');
      }

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

    // ── OLD OPTIC NERVE SIGNALS (eye → visual cortex) ──

    [nerveL,nerveR,nerveMotorL].forEach(nerve=>{
      if(!nerve)return;
      // Signal speed proportional to cognitive activity
      const speed=0.0028+(cogLoad/100)*0.0065;
      nerve.signals.forEach(sig=>{
        sig.t+=speed;
        if(sig.t>1) sig.t-=1;
        const pt=sig.curve.getPoint(sig.t);
        sig.mesh.position.copy(pt);
        // Fade at wire ends, full brightness in middle
        const fade=sig.t<0.08?sig.t/0.08:sig.t>0.92?(1-sig.t)/0.08:1;
        sig.mat.opacity=fade*(0.75+(cogLoad/100)*0.25);
        // Size pulses with signal
        const sc=0.9+Math.sin(sig.t*Math.PI*6)*0.25;
        sig.mesh.scale.setScalar(sc);
      });
      // Nerve tube glow
      nerve.mat.opacity=0.40+Math.sin(t*3.8)*0.22+(cogLoad/100)*0.18;
    });

    // Particle effects decay
    particleSystems=particleSystems.filter(({pts,mat})=>{
      mat.opacity-=0.014;
      pts.position.y+=0.008;
      if(mat.opacity<=0){scene.remove(pts);return false;}
      return true;
    });

    renderer.render(scene,cam);
  }

  function onResize(){
    const c=$('brainCanvas');
    if(!c||!cam||!renderer)return;
    cam.aspect=c.clientWidth/c.clientHeight;
    cam.updateProjectionMatrix();
    renderer.setSize(c.clientWidth,c.clientHeight);
  }

  function setLoad(v){cogLoad=Math.max(0,Math.min(100,v));}

  function toggleRotate(){
    autoRotate=!autoRotate;
    $('btnRotate').innerHTML=autoRotate?
      '<i class="fas fa-pause"></i> PAUSE ROTATE':
      '<i class="fas fa-sync-alt"></i> AUTO-ROTATE';
  }

  function resetView(){
    cam.position.set(0,1.5,8.5);
    if(brainGroup) brainGroup.rotation.set(-0.18,0,0);
  }

  function spawnEffect(color){
    if(!scene)return;
    const cnt=180,pos=new Float32Array(cnt*3);
    for(let i=0;i<cnt;i++){
      pos[i*3]=(Math.random()-.5)*6;
      pos[i*3+1]=(Math.random()-.5)*6;
      pos[i*3+2]=(Math.random()-.5)*6;
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.BufferAttribute(pos,3));
    const m=new THREE.PointsMaterial({color,size:0.14,transparent:true,opacity:0.9});
    const pts=new THREE.Points(g,m);
    scene.add(pts);
    particleSystems.push({pts,mat:m});
  }

  function flashBrain(color){
    if(!brainGroup)return;
    const{lHemi,rHemi}=brainGroup.userData;
    let f=0;
    const fl=()=>{
      const c=f%2===0?color:0x050510;
      [lHemi,rHemi].forEach(h=>{h.material.emissive.setHex(c);h.material.emissiveIntensity=f%2===0?0.9:0.10;});
      f++;if(f<14) setTimeout(fl,75);
      else [lHemi,rHemi].forEach(h=>h.material.emissiveIntensity=0.10);
    };
    fl();
  }

    // KEYBOARD CONTROLS & DEMO OVERLAY TRIGGER
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

  
  return{init,setLoad,toggleRotate,resetView,spawnEffect,flashBrain};
})();

// ═══════════════════════════════════════════