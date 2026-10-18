// Realistic Earth for the brand film: Blue Marble day side, gold city lights on the night side,
// terrain relief, ocean glint and an atmosphere halo. Orthographic camera, 1 unit = 1 CSS pixel,
// so globe placement is expressed directly in screen pixels (cx, cy, radius).
(function () {
  const W = 1080, H = 1920;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, p) => a + (b - a) * p;
  const prog = (t, a, b) => clamp((t - a) / (b - a));
  const inOutCubic = (p) => p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  const outCubic = (p) => 1 - Math.pow(1 - p, 3);

  const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("earth"), antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, -10000, 10000);
  camera.position.z = 5000;

  const loader = new THREE.TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const load = (f) => new Promise((res, rej) => loader.load("assets/earth/" + f, (tx) => { tx.anisotropy = maxAniso; res(tx); }, undefined, rej));

  /* ---------- Earth ---------- */
  const earthMat = new THREE.ShaderMaterial({
    uniforms: {
      dayTex: { value: null }, nightTex: { value: null }, topoTex: { value: null }, waterTex: { value: null },
      sunDir: { value: new THREE.Vector3(-0.5, 0.3, 0.8).normalize() },
      bumpScale: { value: 3.0 },
      fade: { value: 1 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vN; varying vec3 vPos;
      void main() {
        vUv = uv;
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vPos = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D dayTex, nightTex, topoTex, waterTex;
      uniform vec3 sunDir; uniform float bumpScale; uniform float fade;
      varying vec2 vUv; varying vec3 vN; varying vec3 vPos;

      vec3 perturb(vec3 pos, vec3 n, float h) {
        vec3 dpx = dFdx(pos), dpy = dFdy(pos);
        float dhx = dFdx(h), dhy = dFdy(h);
        vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
        float det = dot(dpx, r1);
        vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
        return normalize(abs(det) * n - grad);
      }

      void main() {
        vec3 n0 = normalize(vN);
        vec3 V = vec3(0.0, 0.0, 1.0);
        vec3 n = perturb(vPos, n0, texture2D(topoTex, vUv).r * bumpScale);

        float ndl = dot(n, sunDir);
        float ndl0 = dot(n0, sunDir);
        float dayAmt = smoothstep(-0.10, 0.22, ndl0);

        vec3 day = texture2D(dayTex, vUv).rgb;
        day = mix(vec3(dot(day, vec3(0.299, 0.587, 0.114))), day, 1.15) * 1.08;
        vec3 lit = day * (0.03 + 1.1 * max(ndl, 0.0));
        // warm band along the terminator
        float term = smoothstep(-0.10, 0.04, ndl0) * (1.0 - smoothstep(0.04, 0.32, ndl0));
        lit += vec3(1.0, 0.42, 0.12) * term * 0.10;

        float lum = dot(texture2D(nightTex, vUv).rgb, vec3(0.299, 0.587, 0.114));
        vec3 lights = vec3(1.0, 0.80, 0.30) * pow(lum, 1.6) * 2.4;
        vec3 col = mix(lights + day * 0.015, lit, dayAmt);

        float water = texture2D(waterTex, vUv).r;
        vec3 Hv = normalize(sunDir + V);
        float spec = pow(max(dot(n0, Hv), 0.0), 70.0) * water * dayAmt;
        col += vec3(1.0, 0.93, 0.80) * spec * 0.75;

        // atmosphere: rim scattering, brighter on the sun side (also when backlit)
        float fres = pow(1.0 - max(dot(n0, V), 0.0), 2.6);
        float rimLit = smoothstep(-0.35, 0.55, ndl0);
        col = mix(col, vec3(0.38, 0.64, 1.0), fres * (0.12 + 0.75 * rimLit));
        col += vec3(0.30, 0.55, 1.0) * pow(fres, 2.0) * rimLit * 0.6;

        gl_FragColor = vec4(col * fade, 1.0);
      }`,
  });
  earthMat.extensions = { derivatives: true };

  const tilt = new THREE.Group();          // rotation.x = latitude of the point facing camera
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 256, 128), earthMat);
  tilt.add(earth);

  /* ---------- Atmosphere halo (screen-aligned quad behind the globe) ---------- */
  const HALO = 2.4;
  const haloMat = new THREE.ShaderMaterial({
    uniforms: { sun2: { value: new THREE.Vector2(-0.6, 0.4) }, strength: { value: 1 }, backlit: { value: 0 } },
    // premultiplied-alpha canvas: rgb with alpha 0 composites additively over the page background
    transparent: true, depthWrite: false, blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec2 sun2; uniform float strength; uniform float backlit;
      varying vec2 vUv;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0 * ${HALO.toFixed(2)};
        float d = length(p);
        if (d < 0.995) discard;
        float g = exp(-(d - 1.0) * 14.0) * 0.9 + exp(-(d - 1.0) * 3.5) * 0.18;
        // reach exactly zero well inside the quad, or its square edge shows as a line
        g *= 1.0 - smoothstep(1.5, 2.3, d);
        float side = smoothstep(-0.7, 0.9, dot(normalize(p), normalize(sun2)));
        float amt = g * (0.18 + side * (0.55 + 1.6 * backlit));
        vec3 c = mix(vec3(0.30, 0.55, 1.0), vec3(0.75, 0.88, 1.0), side * backlit * 0.6);
        gl_FragColor = vec4(c * amt * strength, 0.0);
      }`,
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(2 * HALO, 2 * HALO), haloMat);

  const globe = new THREE.Group();
  globe.add(halo); halo.position.z = -1.2;
  globe.add(tilt);
  scene.add(globe);

  /* ---------- Stars ---------- */
  let seed = 7;
  const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const starLayers = [[320, 1.6, 0.55], [90, 2.6, 0.8]].map(([count, size, opacity]) => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { pos[i * 3] = (rnd() - 0.5) * W; pos[i * 3 + 1] = (rnd() - 0.5) * H; pos[i * 3 + 2] = -8000; }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: 0xffffff, size, sizeAttenuation: false, transparent: true, opacity, depthWrite: false });
    const pts = new THREE.Points(g, m); scene.add(pts);
    return { m, opacity };
  });

  /* ---------- Choreography ---------- */
  const rad = (d) => d * Math.PI / 180;
  // Greece faces the camera when the plane lands (t = 2.0)
  const LAT = 37.98, LON = 23.73;
  const RY0 = Math.PI / 2 - rad(LON + 180);

  // [cx, cy, radius] in screen px
  const FULL = [540, 960, 400];
  const HORIZON_A = [540, 2430, 1090];
  const HORIZON_B = [540, 2470, 1140];
  const END_FROM = [540, 2780, 1200];
  const END_TO = [540, 2560, 1200];

  const SUN_FULL = new THREE.Vector3(-0.55, 0.35, 0.76).normalize();
  const SUN_HORIZON = new THREE.Vector3(-0.40, 0.50, -0.55).normalize();
  // tilt so Europe / the Mediterranean sits along the horizon instead of the Arctic
  const HORIZON_LAT = -12;
  const SUN_END = new THREE.Vector3(0.22, 0.62, -0.75).normalize();
  const tmp = new THREE.Vector3();

  function place([cx, cy, r]) {
    globe.position.set(cx - W / 2, H / 2 - cy, 0);
    tilt.scale.setScalar(r);
    halo.scale.setScalar(r);
  }
  const mixKey = (a, b, p) => [lerp(a[0], b[0], p), lerp(a[1], b[1], p), lerp(a[2], b[2], p)];

  window.renderEarth = function (t) {
    let key, sun, spinExtra = 0;
    if (t < 11.2) {
      const toHorizon = inOutCubic(prog(t, 2.35, 3.15));
      const pushIn = prog(t, 3.15, 9.0);
      key = mixKey(mixKey(FULL, HORIZON_A, toHorizon), HORIZON_B, toHorizon * pushIn);
      // gentle settle-in at the very start
      key[2] *= lerp(0.9, 1, outCubic(prog(t, 0, 2.2)));
      sun = tmp.copy(SUN_FULL).lerp(SUN_HORIZON, toHorizon).normalize();
      // the roll scene spins the planet up like a slot machine
      spinExtra = 1.5 * inOutCubic(prog(t, 5.1, 9.0));
      tilt.rotation.x = rad(lerp(LAT, HORIZON_LAT, toHorizon));
    } else {
      key = mixKey(END_FROM, END_TO, outCubic(prog(t, 11.2, 13.4)));
      sun = tmp.copy(SUN_END);
      spinExtra = 1.5;
      tilt.rotation.x = rad(HORIZON_LAT);
    }
    place(key);
    window.earthCenterY = key[1];
    earthMat.uniforms.sunDir.value.copy(sun);
    haloMat.uniforms.sun2.value.set(sun.x, sun.y);
    haloMat.uniforms.backlit.value = clamp(-sun.z * 1.4);

    earth.rotation.y = RY0 + 0.05 * (t - 2.0) + spinExtra;

    const fadeIn = outCubic(prog(t, 0, 1.0));
    earthMat.uniforms.fade.value = fadeIn;
    haloMat.uniforms.strength.value = fadeIn;
    starLayers.forEach(({ m, opacity }, i) => { m.opacity = opacity * fadeIn * (0.85 + 0.15 * Math.sin(t * (1.3 + i) + i)); });

    renderer.render(scene, camera);
  };

  window.ready = Promise.all(["earth-blue-marble.jpg", "earth-night.jpg", "earth-topology.png", "earth-water.png"].map(load))
    .then(([day, night, topo, water]) => {
      const u = earthMat.uniforms;
      u.dayTex.value = day; u.nightTex.value = night; u.topoTex.value = topo; u.waterTex.value = water;
    });
})();
