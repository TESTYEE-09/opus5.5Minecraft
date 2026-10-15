import * as THREE from 'three';
import {
  CHUNK_VERT, CHUNK_FRAG, SHADOW_VERT, SHADOW_FRAG, WATER_VERT, WATER_FRAG, SKY_VERT, SKY_FRAG,
  ENTITY_VERT, ENTITY_FRAG, ENTITY_SHADOW_FRAG, BLOCKENT_VERT, BLOCKENT_FRAG,
  FS_VERT, COPY_FRAG, BRIGHT_FRAG, DOWN_FRAG, UP_FRAG, RAYS_FRAG, COMPOSITE_FRAG,
} from './shaders.js';
import { TEX } from '../core/blocks.js';

export const LAYER = { WORLD: 0, TRANSPARENT: 1, SKY: 2, HAND: 3, OVERLAY: 4 };

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Renderer {
  constructor(canvas, atlas) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true, preserveDrawingBuffer: false });
    this.gl.autoClear = false;
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.gl.toneMapping = THREE.NoToneMapping;
    this.atlas = atlas;
    atlas.anisotropy = Math.min(8, this.gl.capabilities.getMaxAnisotropy());
    this.settings = { shadows: true, shadowRes: 2048, ssr: true, bloom: true, rays: true, renderScale: 1, fov: 72 };

    this.scene = new THREE.Scene();
    this.scene.matrixWorldAutoUpdate = true;
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.08, 1200);
    this.handScene = new THREE.Scene();
    this.handCamera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);

    const U = this.U = {
      uSunDir: { value: v3(0, 1, 0) }, uLightDir: { value: v3(0, 1, 0) }, uLightCol: { value: v3(3, 3, 3) },
      uAmbient: { value: v3(0.4, 0.5, 0.8) }, uBlockCol: { value: v3(1.0, 0.72, 0.42).multiplyScalar(1.7) },
      uSkyTop: { value: v3(0.2, 0.4, 0.85) }, uSkyHorizon: { value: v3(0.6, 0.75, 0.95) }, uSunsetCol: { value: v3(0, 0, 0) },
      uFogStart: { value: 80 }, uFogEnd: { value: 140 }, uHaze: { value: 0.002 }, uUnderwater: { value: 0 },
      uWaterFog: { value: v3(0.02, 0.08, 0.14) }, uTime: { value: 0 }, uFlicker: { value: 0 }, uRain: { value: 0 }, uNight: { value: 0 },
      uShadowMap: { value: null }, uShadowMatrix: { value: new THREE.Matrix4() }, uShadowOn: { value: 0 },
      uShadowTexel: { value: new THREE.Vector2(1 / 2048, 1 / 2048) },
      uAtlas: { value: atlas }, uOverlayLayer: { value: TEX.grass_side_overlay }, uWind: { value: 1 },
    };

    this.mats = {
      opaque: new THREE.ShaderMaterial({ uniforms: { ...U, uCutout: { value: 0 } }, vertexShader: CHUNK_VERT, fragmentShader: CHUNK_FRAG }),
      cutout: new THREE.ShaderMaterial({ uniforms: { ...U, uCutout: { value: 1 } }, vertexShader: CHUNK_VERT, fragmentShader: CHUNK_FRAG, side: THREE.DoubleSide }),
      water: new THREE.ShaderMaterial({
        uniforms: { ...U, tScene: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uViewProj: { value: new THREE.Matrix4() }, uCamFwd: { value: v3(0, 0, -1) }, uSSR: { value: 1 } },
        vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, side: THREE.DoubleSide,
      }),
      shadowOpaque: new THREE.ShaderMaterial({ uniforms: { uAtlas: U.uAtlas, uTime: U.uTime, uWind: U.uWind, uCutout: { value: 0 } }, vertexShader: SHADOW_VERT, fragmentShader: SHADOW_FRAG }),
      shadowCutout: new THREE.ShaderMaterial({ uniforms: { uAtlas: U.uAtlas, uTime: U.uTime, uWind: U.uWind, uCutout: { value: 1 } }, vertexShader: SHADOW_VERT, fragmentShader: SHADOW_FRAG, side: THREE.DoubleSide }),
    };
    this.chunkMats = [this.mats.opaque, this.mats.cutout, this.mats.water];
    this.chunkShadowMats = [this.mats.shadowOpaque, this.mats.shadowCutout, null];

    // sky dome
    const skyGeo = new THREE.SphereGeometry(500, 48, 24);
    this.skyU = {
      ...U, uMoonDir: { value: v3(0, -1, 0) }, uStars: { value: 0 }, uAurora: { value: 0 }, uCloudCover: { value: 0.45 },
      uCloudDark: { value: 0 }, uCloudLit: { value: v3(1, 1, 1) }, uCloudShade: { value: v3(0.6, 0.65, 0.75) },
      uShoot: { value: new THREE.Vector4(0, 0, 0, 0) }, uShootDir: { value: v3(1, 0, 0) }, uFlash: { value: 0 }, uSunSize: { value: 0.99955 },
    };
    this.sky = new THREE.Mesh(skyGeo, new THREE.ShaderMaterial({ uniforms: this.skyU, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false }));
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.sky.layers.set(LAYER.SKY);
    this.scene.add(this.sky);

    // shadow map
    this.shadowCam = new THREE.OrthographicCamera(-80, 80, 80, -80, 1, 500);
    this.shadowCam.layers.set(LAYER.WORLD);
    this.makeShadowRT(this.settings.shadowRes);

    // post-processing
    this.fsGeo = new THREE.BufferGeometry();
    this.fsGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const fs = (frag, uniforms) => {
      const m = new THREE.ShaderMaterial({ uniforms, vertexShader: FS_VERT, fragmentShader: frag, depthTest: false, depthWrite: false });
      const mesh = new THREE.Mesh(this.fsGeo, m);
      mesh.frustumCulled = false;
      const s = new THREE.Scene(); s.add(mesh);
      return { m, s };
    };
    this.copyPass = fs(COPY_FRAG, { tColor: { value: null }, tDepth: { value: null }, uNear: { value: 0.08 }, uFar: { value: 1200 } });
    this.brightPass = fs(BRIGHT_FRAG, { tColor: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.6 } });
    this.downPass = fs(DOWN_FRAG, { tColor: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.upPass = fs(UP_FRAG, { tColor: { value: null }, tPrev: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.raysPass = fs(RAYS_FRAG, { tScene: { value: null }, uSun: { value: new THREE.Vector2() }, uFar: { value: 1200 }, uStrength: { value: 0 }, uColor: { value: v3(1, 0.8, 0.5) } });
    this.compPass = fs(COMPOSITE_FRAG, {
      tColor: { value: null }, tBloom: { value: null }, tRays: { value: null }, uExposure: { value: 1 }, uBloom: { value: 0.08 },
      uUnderwater: U.uUnderwater, uDamage: { value: 0 }, uTime: U.uTime, uSat: { value: 1.12 }, uVignette: { value: 0.55 },
      uFade: { value: 1 }, uGrade: { value: v3(1, 1, 1) },
    });
    this.blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); this.blackTex.needsUpdate = true;

    this.size = new THREE.Vector2();
    this.env = { day: 1, sunVisible: 1 };
    this.casterRoots = [];
    this.frame = 0;
    this.resize();
  }

  makeShadowRT(res) {
    if (this.shadowRT) this.shadowRT.dispose();
    const dt = new THREE.DepthTexture(res, res);
    dt.type = THREE.UnsignedIntType;
    dt.compareFunction = THREE.LessEqualCompare;
    dt.minFilter = dt.magFilter = THREE.LinearFilter;
    this.shadowRT = new THREE.WebGLRenderTarget(res, res, { depthTexture: dt, depthBuffer: true });
    this.U.uShadowMap.value = dt;
    this.U.uShadowTexel.value.set(1 / res, 1 / res);
    this.shadowRes = res;
  }

  applySettings(s) {
    Object.assign(this.settings, s);
    if (this.settings.shadows && this.settings.shadowRes !== this.shadowRes) this.makeShadowRT(this.settings.shadowRes);
    this.mats.water.uniforms.uSSR.value = this.settings.ssr ? 1 : 0;
    this.camera.fov = this.settings.fov;
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * (this.settings.renderScale || 1);
    this.gl.setPixelRatio(dpr);
    this.gl.setSize(window.innerWidth, window.innerHeight, false);
    const w = this.gl.domElement.width, h = this.gl.domElement.height;
    this.size.set(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.handCamera.aspect = w / h; this.handCamera.updateProjectionMatrix();
    const mk = (ww, hh, depth) => new THREE.WebGLRenderTarget(ww, hh, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: !!depth, depthTexture: depth ? new THREE.DepthTexture(ww, hh) : null,
    });
    for (const k of ['mainRT', 'copyRT', 'raysRT']) if (this[k]) this[k].dispose();
    if (this.down) for (const r of [...this.down, ...this.up]) r.dispose();
    this.mainRT = mk(w, h, true);
    this.copyRT = mk(w, h, false);
    this.copyRT.texture.minFilter = this.copyRT.texture.magFilter = THREE.NearestFilter;
    this.raysRT = mk(Math.max(1, w >> 1), Math.max(1, h >> 1), false);
    this.down = []; this.up = [];
    let bw = w, bh = h;
    for (let i = 0; i < 6; i++) {
      bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
      this.down.push(mk(bw, bh, false));
      if (i < 5) this.up.push(mk(bw, bh, false));
    }
    this.mats.water.uniforms.uRes.value.set(w, h);
  }

  // ---------------------------------------------------------------- materials for other systems
  entityMaterial(map, opts = {}) {
    const U = this.U;
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: U.uSunDir, uLightDir: U.uLightDir, uLightCol: U.uLightCol, uAmbient: U.uAmbient, uBlockCol: U.uBlockCol,
        uSkyTop: U.uSkyTop, uSkyHorizon: U.uSkyHorizon, uSunsetCol: U.uSunsetCol, uFogStart: U.uFogStart, uFogEnd: U.uFogEnd,
        uHaze: U.uHaze, uUnderwater: U.uUnderwater, uWaterFog: U.uWaterFog, uTime: U.uTime, uFlicker: U.uFlicker, uRain: U.uRain,
        uNight: U.uNight, uShadowMap: U.uShadowMap, uShadowMatrix: U.uShadowMatrix, uShadowOn: opts.noShadow ? { value: 0 } : U.uShadowOn,
        uShadowTexel: U.uShadowTexel, uMap: { value: map }, uEnt: { value: v3(1, 0, 0) }, uEmissive: { value: opts.emissive || 0 },
        uFog: { value: opts.noFog ? 0 : 1 }, uGlint: { value: opts.glint ? 1 : 0 },
      },
      vertexShader: ENTITY_VERT, fragmentShader: ENTITY_FRAG, side: opts.side ?? THREE.FrontSide,
    });
    m.userData.shadow = new THREE.ShaderMaterial({ uniforms: { uMap: m.uniforms.uMap }, vertexShader: ENTITY_VERT, fragmentShader: ENTITY_SHADOW_FRAG, side: THREE.DoubleSide });
    return m;
  }

  blockEntityMaterial(opts = {}) {
    const U = this.U;
    const m = new THREE.ShaderMaterial({
      uniforms: { ...U, uShadowOn: opts.noShadow ? { value: 0 } : U.uShadowOn, uEnt: { value: v3(1, 0, 0) }, uFog: { value: opts.noFog ? 0 : 1 } },
      vertexShader: BLOCKENT_VERT, fragmentShader: BLOCKENT_FRAG, side: THREE.DoubleSide,
    });
    m.userData.shadow = this.mats.shadowCutout;
    return m;
  }

  // ---------------------------------------------------------------- environment
  // t: day fraction (0 sunrise, .25 noon, .5 sunset, .75 midnight); rain 0..1; thunder 0..1
  setEnvironment({ t, rain = 0, thunder = 0, flash = 0, aurora = 0, renderDist = 8, cloudCover = 0.45, underwater = false, eyeLight = 1, time }) {
    const U = this.U, S = this.skyU;
    const a = t * Math.PI * 2;
    const sun = v3(Math.cos(a), Math.sin(a), 0.32).normalize();
    U.uSunDir.value.copy(sun);
    S.uMoonDir.value.copy(sun).multiplyScalar(-1);
    const e = sun.y;
    const day = sstep(-0.1, 0.22, e);
    const sunset = (1 - sstep(0.0, 0.32, Math.abs(e + 0.02))) * 1.0;
    const night = 1 - sstep(-0.22, 0.04, e);
    const dark = rain * 0.75 + thunder * 0.2;
    U.uNight.value = night;
    // sky colours
    let top = lerp3([0.010, 0.016, 0.040], [0.17, 0.38, 0.86], day);
    top = lerp3(top, [0.20, 0.24, 0.48], sunset * 0.55);
    let hor = lerp3([0.030, 0.045, 0.090], [0.60, 0.76, 0.98], day);
    hor = lerp3(hor, [0.98, 0.56, 0.36], sunset * 0.75);
    const grey = lerp3([0.02, 0.025, 0.03], [0.36, 0.39, 0.43], day);
    top = lerp3(top, grey, dark); hor = lerp3(hor, lerp3(grey, [1, 1, 1], 0.08), dark);
    U.uSkyTop.value.set(...top); U.uSkyHorizon.value.set(...hor);
    const ss = sunset * (1 - dark * 0.8);
    U.uSunsetCol.value.set(1.0 * ss * 1.4, 0.42 * ss * 1.4, 0.14 * ss * 1.4);
    // direct light: sun by day, moon by night
    let lc, ld;
    if (e > -0.06) {
      const k = sstep(-0.06, 0.12, e);
      const warm = 1 - sstep(0.05, 0.4, e);
      const col = lerp3([1.0, 0.94, 0.84], [1.0, 0.58, 0.28], warm);
      const inten = 2.75 * k * (1 - dark * 0.85);
      lc = [col[0] * inten, col[1] * inten, col[2] * inten]; ld = sun;
    } else {
      const k = sstep(0.06, 0.2, -e) * (1 - dark * 0.8);
      lc = [0.40 * 0.5 * k, 0.50 * 0.5 * k, 0.78 * 0.5 * k]; ld = sun.clone().multiplyScalar(-1);
    }
    U.uLightCol.value.set(...lc); U.uLightDir.value.copy(ld);
    let amb = lerp3([0.05, 0.07, 0.15], [0.42, 0.56, 0.88], day);
    amb = lerp3(amb, [0.52, 0.42, 0.5], sunset * 0.4);
    amb = lerp3(amb, lerp3([0.05, 0.055, 0.065], [0.42, 0.45, 0.5], day), dark);
    const ambK = 0.85;
    U.uAmbient.value.set(amb[0] * ambK, amb[1] * ambK, amb[2] * ambK);
    const fl = 0.5 + 0.5 * Math.sin(time * 9.0) * Math.sin(time * 5.3 + 1.0);
    U.uFlicker.value = fl;
    U.uRain.value = rain;
    U.uFogStart.value = renderDist * 16 * 0.62;
    U.uFogEnd.value = renderDist * 16 * 0.98;
    U.uHaze.value = 0.0012 + rain * 0.006 + sunset * 0.0015 + night * 0.0008;
    U.uUnderwater.value = underwater ? 1 : 0;
    const wf = lerp3([0.004, 0.012, 0.025], [0.03, 0.12, 0.2], day * eyeLight + 0.05);
    U.uWaterFog.value.set(...wf);
    U.uWind.value = 1 + rain * 1.6 + thunder;
    // sky extras
    S.uStars.value = night * (1 - rain);
    S.uAurora.value = aurora * night * (1 - rain);
    S.uCloudCover.value = Math.min(0.95, cloudCover + rain * 0.5);
    const lit = lerp3([0.035, 0.04, 0.06], [1.15, 1.12, 1.08], day);
    const litS = lerp3(lit, [1.2, 0.7, 0.5], sunset * 0.6);
    S.uCloudLit.value.set(...lerp3(litS, lerp3([0.03, 0.03, 0.035], [0.5, 0.52, 0.56], day), dark));
    S.uCloudShade.value.set(...lerp3(lerp3([0.015, 0.02, 0.03], [0.55, 0.6, 0.72], day), lerp3([0.02, 0.02, 0.025], [0.3, 0.32, 0.36], day), dark));
    S.uFlash.value = flash;
    this.env.day = day; this.env.night = night; this.env.sunset = sunset; this.env.rain = rain;
    // exposure: a touch of eye adaptation at night
    this.compPass.m.uniforms.uExposure.value = 1.0 + night * 0.65 * eyeLight;
    this.compPass.m.uniforms.uGrade.value.set(1.0 + sunset * 0.06, 1.0, 1.0 - sunset * 0.05 + night * 0.05);
    this.raysPass.m.uniforms.uColor.value.set(1.0 * 0.5, 0.82 * 0.5, 0.6 * 0.5).multiplyScalar(1 + sunset * 1.5);
    this.env.raysK = day * (1 - rain) * (underwater ? 0 : 1);
    if (flash > 0) U.uAmbient.value.addScalar(flash * 1.5);
  }

  setShootingStar(v4, dir) { this.skyU.uShoot.value.copy(v4); if (dir) this.skyU.uShootDir.value.copy(dir); }

  // ---------------------------------------------------------------- frame
  updateShadowCam(center) {
    const R = 72;
    const cam = this.shadowCam;
    const L = this.U.uLightDir.value;
    // stable light-space basis
    const z = L.clone();
    const x = new THREE.Vector3(0, 1, 0).cross(z);
    if (x.lengthSq() < 1e-4) x.set(1, 0, 0);
    x.normalize();
    const y = z.clone().cross(x).normalize();
    const texel = (2 * R) / this.shadowRes;
    const px = Math.round(center.dot(x) / texel) * texel;
    const py = Math.round(center.dot(y) / texel) * texel;
    const pz = center.dot(z);
    const snapped = x.multiplyScalar(px).add(y.multiplyScalar(py)).add(z.clone().multiplyScalar(pz));
    cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R; cam.near = 1; cam.far = 420;
    cam.position.copy(snapped).addScaledVector(L, 220);
    cam.up.set(0, 1, 0);
    if (Math.abs(L.y) > 0.99) cam.up.set(0, 0, 1);
    cam.lookAt(snapped);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.U.uShadowMatrix.value.copy(bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
  }

  swapShadowMaterials(on) {
    for (const root of this.casterRoots) {
      root.traverse((o) => {
        if (!o.isMesh) return;
        if (on) {
          if (o.userData.bucket !== undefined) { o.userData.mainMat = o.material; o.material = this.chunkShadowMats[o.userData.bucket] || o.material; }
          else if (o.material && o.material.userData && o.material.userData.shadow) { o.userData.mainMat = o.material; o.material = o.material.userData.shadow; }
        } else if (o.userData.mainMat) { o.material = o.userData.mainMat; o.userData.mainMat = null; }
      });
    }
  }

  render(dt, opts = {}) {
    const gl = this.gl;
    const cam = this.camera;
    this.frame++;
    cam.updateMatrixWorld();
    const U = this.U;
    const lightUp = U.uLightDir.value.y > 0.02 && U.uLightCol.value.lengthSq() > 0.0004;
    const doShadow = this.settings.shadows && lightUp;
    U.uShadowOn.value = doShadow ? 1 : 0;

    // 1. shadows
    if (doShadow) {
      this.updateShadowCam(cam.position);
      this.swapShadowMaterials(true);
      gl.setRenderTarget(this.shadowRT);
      gl.clear(true, true, false);
      gl.render(this.scene, this.shadowCam);
      this.swapShadowMaterials(false);
    }

    // 2. opaque world
    gl.setRenderTarget(this.mainRT);
    gl.setClearColor(0x000000, 1);
    gl.clear(true, true, false);
    cam.layers.set(LAYER.WORLD); cam.layers.enable(LAYER.SKY); cam.layers.enable(LAYER.OVERLAY);
    gl.render(this.scene, cam);

    // 3. copy colour + linear depth for water
    const cu = this.copyPass.m.uniforms;
    cu.tColor.value = this.mainRT.texture; cu.tDepth.value = this.mainRT.depthTexture;
    cu.uNear.value = cam.near; cu.uFar.value = cam.far;
    gl.setRenderTarget(this.copyRT);
    gl.render(this.copyPass.s, this.fsCam);

    // 4. water and transparent things
    const wm = this.mats.water.uniforms;
    wm.tScene.value = this.copyRT.texture;
    wm.uViewProj.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    cam.getWorldDirection(wm.uCamFwd.value);
    gl.setRenderTarget(this.mainRT);
    cam.layers.set(LAYER.TRANSPARENT);
    gl.render(this.scene, cam);

    // 5. first-person hand
    if (opts.hand !== false && this.handScene.children.length) {
      gl.clearDepth();
      this.handCamera.layers.set(LAYER.HAND);
      gl.render(this.handScene, this.handCamera);
    }

    // 6. bloom
    let bloomTex = this.blackTex;
    if (this.settings.bloom) {
      const bp = this.brightPass.m.uniforms;
      bp.tColor.value = this.mainRT.texture; bp.uTexel.value.set(1 / this.size.x, 1 / this.size.y);
      gl.setRenderTarget(this.down[0]); gl.render(this.brightPass.s, this.fsCam);
      for (let i = 1; i < this.down.length; i++) {
        const dp = this.downPass.m.uniforms;
        dp.tColor.value = this.down[i - 1].texture;
        dp.uTexel.value.set(1 / this.down[i - 1].width, 1 / this.down[i - 1].height);
        gl.setRenderTarget(this.down[i]); gl.render(this.downPass.s, this.fsCam);
      }
      let src = this.down[this.down.length - 1];
      for (let i = this.up.length - 1; i >= 0; i--) {
        const up = this.upPass.m.uniforms;
        up.tColor.value = src.texture; up.tPrev.value = this.down[i].texture;
        up.uTexel.value.set(1 / src.width, 1 / src.height);
        gl.setRenderTarget(this.up[i]); gl.render(this.upPass.s, this.fsCam);
        src = this.up[i];
      }
      bloomTex = this.up[0].texture;
    }

    // 7. god rays toward the sun
    let raysTex = this.blackTex;
    if (this.settings.rays && this.env.raysK > 0.01) {
      const sp = this.U.uSunDir.value.clone().multiplyScalar(400).add(cam.position).project(cam);
      const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
      const facing = fwd.dot(this.U.uSunDir.value);
      const onScreen = 1 - sstep(0.9, 1.6, Math.max(Math.abs(sp.x), Math.abs(sp.y)));
      const k = this.env.raysK * sstep(0.0, 0.4, facing) * onScreen;
      const rp = this.raysPass.m.uniforms;
      rp.tScene.value = this.copyRT.texture; rp.uSun.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
      rp.uFar.value = cam.far; rp.uStrength.value = k * 1.4;
      if (k > 0.01) {
        gl.setRenderTarget(this.raysRT); gl.render(this.raysPass.s, this.fsCam);
        raysTex = this.raysRT.texture;
      }
    }

    // 8. composite
    const c = this.compPass.m.uniforms;
    c.tColor.value = this.mainRT.texture; c.tBloom.value = bloomTex; c.tRays.value = raysTex;
    c.uBloom.value = this.settings.bloom ? 0.075 : 0;
    gl.setRenderTarget(null);
    gl.clear(true, true, false);
    gl.render(this.compPass.s, this.fsCam);
  }
}
