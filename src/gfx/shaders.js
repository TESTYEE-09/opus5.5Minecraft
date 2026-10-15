// GLSL for the world, water, sky, entities, particles and post-processing.
// All lighting is computed in linear HDR; the composite pass tone-maps.

export const COMMON = /* glsl */`
precision highp sampler2DArray;
precision highp sampler2DShadow;
uniform vec3 uSunDir;
uniform vec3 uLightDir;
uniform vec3 uLightCol;
uniform vec3 uAmbient;
uniform vec3 uBlockCol;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uSunsetCol;
uniform float uFogStart;
uniform float uFogEnd;
uniform float uHaze;
uniform float uUnderwater;
uniform vec3 uWaterFog;
uniform float uTime;
uniform float uFlicker;
uniform float uRain;
uniform float uNight;

vec3 skyGradient(vec3 rd) {
  float y = rd.y;
  float h = pow(1.0 - clamp(y, 0.0, 1.0), 3.5);
  vec3 col = mix(uSkyTop, uSkyHorizon, h);
  if (y < 0.0) col = mix(uSkyHorizon, uSkyHorizon * 0.62, smoothstep(0.0, -0.35, y));
  vec2 sd = normalize(uSunDir.xz + vec2(1e-4));
  vec2 rdh = normalize(rd.xz + vec2(1e-4));
  float toward = max(dot(rdh, sd), 0.0);
  float band = exp(-abs(y) * 5.0);
  col += uSunsetCol * (pow(toward, 4.0) * band + pow(max(dot(rd, uSunDir), 0.0), 12.0) * 0.6);
  return col;
}

vec3 applyFog(vec3 col, vec3 wp) {
  vec3 d = wp - cameraPosition;
  float dist = length(d);
  vec3 rd = d / max(dist, 1e-4);
  if (uUnderwater > 0.5) {
    float f = 1.0 - exp(-dist * 0.085);
    return mix(col, uWaterFog, f);
  }
  float f = smoothstep(uFogStart, uFogEnd, dist);
  float haze = (1.0 - exp(-dist * uHaze)) * 0.85;
  // thin ground mist in valleys at dawn/night
  f = max(f, haze);
  return mix(col, skyGradient(rd), f);
}
`;

export const SHADOW = /* glsl */`
uniform sampler2DShadow uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowOn;
uniform vec2 uShadowTexel;
float getShadow(vec3 wp, vec3 n) {
  if (uShadowOn < 0.5) return 1.0;
  float ndl = dot(n, uLightDir);
  vec4 sp = uShadowMatrix * vec4(wp + n * 0.045 + uLightDir * 0.02, 1.0);
  vec3 s = sp.xyz / sp.w;
  if (s.x <= 0.0 || s.x >= 1.0 || s.y <= 0.0 || s.y >= 1.0 || s.z >= 1.0) return 1.0;
  float bias = 0.00035 + 0.0006 * (1.0 - clamp(abs(ndl), 0.0, 1.0));
  float sum = 0.0;
  vec2 t = uShadowTexel;
  sum += texture(uShadowMap, vec3(s.xy + vec2(-0.75, -0.75) * t, s.z - bias));
  sum += texture(uShadowMap, vec3(s.xy + vec2(0.75, -0.75) * t, s.z - bias));
  sum += texture(uShadowMap, vec3(s.xy + vec2(-0.75, 0.75) * t, s.z - bias));
  sum += texture(uShadowMap, vec3(s.xy + vec2(0.75, 0.75) * t, s.z - bias));
  sum += texture(uShadowMap, vec3(s.xy + vec2(0.0, 1.6) * t, s.z - bias));
  sum += texture(uShadowMap, vec3(s.xy + vec2(1.6, 0.0) * t, s.z - bias));
  sum += texture(uShadowMap, vec3(s.xy + vec2(0.0, -1.6) * t, s.z - bias));
  sum += texture(uShadowMap, vec3(s.xy + vec2(-1.6, 0.0) * t, s.z - bias));
  float sh = sum / 8.0;
  vec2 e = min(s.xy, 1.0 - s.xy);
  return mix(1.0, sh, smoothstep(0.0, 0.06, min(e.x, e.y)));
}
`;

// ------------------------------------------------------------------ chunks
export const CHUNK_VERT = /* glsl */`
attribute vec4 aA;
attribute vec4 aB;
attribute vec4 aT;
uniform float uTime;
uniform float uWind;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vUV;
varying vec3 vL;
varying vec3 vTint;
varying float vFlags;
varying float vNi;
const vec3 NRM[7] = vec3[7](vec3(1.,0.,0.), vec3(-1.,0.,0.), vec3(0.,1.,0.), vec3(0.,-1.,0.), vec3(0.,0.,1.), vec3(0.,0.,-1.), vec3(0.,1.,0.));
void main() {
  int ni = int(aA.x + 0.5);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  int f = int(aB.w + 0.5);
  int wave = f & 3;
  if (wave == 1) {
    float ph = uTime * 1.7 + wp.x * 0.7 + wp.z * 0.5 + wp.y * 0.35;
    wp.xyz += vec3(sin(ph), sin(ph * 1.31) * 0.6, cos(ph * 0.93)) * 0.03 * uWind;
  } else if (wave >= 2) {
    float top = wave == 3 ? fract(wp.y) * 0.5 + 0.3 : aB.z / 16.0;
    float ph = uTime * 2.0 + wp.x * 0.42 + wp.z * 0.57;
    float g = sin(ph) * 0.6 + sin(ph * 2.3 + 1.7) * 0.3 + sin(ph * 0.47) * 0.4;
    wp.xz += vec2(g, cos(ph * 1.13) * 0.7 + g * 0.3) * 0.075 * top * uWind;
  }
  vWorld = wp.xyz;
  vNormal = NRM[ni];
  vNi = aA.x;
  vUV = vec3(aB.y / 16.0, 1.0 - aB.z / 16.0, aB.x);
  vL = vec3(aA.y / 3.0, aA.z / 255.0, aA.w / 255.0);
  vTint = aT.rgb;
  vFlags = aB.w;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const CHUNK_FRAG = /* glsl */`
${COMMON}
${SHADOW}
uniform sampler2DArray uAtlas;
uniform float uOverlayLayer;
uniform float uCutout;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vUV;
varying vec3 vL;
varying vec3 vTint;
varying float vFlags;
varying float vNi;
void main() {
  int f = int(vFlags + 0.5);
  int mat = (f >> 4) & 7;
  vec3 uvl = vUV;
  if (mat == 4) uvl.xy = fract(uvl.xy + vec2(uTime * 0.018, uTime * 0.011) + 0.03 * sin(uTime * 0.7 + vWorld.zx * 0.8));
  vec4 tex = texture(uAtlas, uvl);
  if (uCutout > 0.5 && tex.a < 0.5) discard;
  int overlay = (f >> 2) & 1;
  int wave = f & 3;
  vec3 tint = pow(vTint, vec3(2.2));
  vec3 albedo = pow(tex.rgb, vec3(2.2));
  if (overlay == 1) {
    vec4 ov = texture(uAtlas, vec3(vUV.xy, uOverlayLayer));
    albedo = mix(albedo, pow(ov.rgb, vec3(2.2)) * tint, ov.a);
  } else albedo *= tint;

  vec3 n = vNormal;
  bool foliage = wave != 0 || vNi > 5.5;
  if (!gl_FrontFacing && !foliage) n = -n;
  float ao = vL.x;
  float aoF = 0.42 + 0.58 * ao * ao * (3.0 - 2.0 * ao);
  float sky = vL.y, blk = vL.z;
  float ndl = dot(n, uLightDir);
  float diff = foliage ? (vNi > 5.5 ? 0.75 : max(ndl, 0.0) * 0.6 + 0.4) : max(ndl, 0.0);
  float sh = getShadow(vWorld, vNi > 5.5 ? vec3(0.0, 1.0, 0.0) : n);
  float outdoor = smoothstep(0.3, 0.9, sky);
  vec3 L = uLightCol * diff * sh * outdoor * mix(0.75, 1.0, ao);
  float skyL = sky * sky * (3.0 - 2.0 * sky);
  float hemi = 0.72 + 0.28 * n.y;
  L += uAmbient * skyL * skyL * hemi * aoF;
  float bl = pow(blk, 1.7);
  L += uBlockCol * bl * aoF * (1.0 + uFlicker * 0.08);
  L += vec3(0.010, 0.011, 0.016) * aoF;
  // foliage transmits a little warm light when backlit by the sun
  if (foliage) L += uLightCol * 0.25 * pow(max(-ndl, 0.0), 2.0) * sh * outdoor * vec3(1.0, 0.95, 0.6);
  vec3 col = albedo * L;
  float lum = max(tex.r, max(tex.g, tex.b));
  if (mat == 2) col += albedo * 2.6 * smoothstep(0.52, 0.85, lum);
  else if (mat == 4) col = albedo * 3.2 + vec3(0.25, 0.04, 0.0);
  else if (mat == 3) {
    float sat = max(albedo.r, max(albedo.g, albedo.b)) - min(albedo.r, min(albedo.g, albedo.b));
    vec3 cell = floor(vWorld * 16.0);
    float tw = pow(0.5 + 0.5 * sin(uTime * 2.6 + dot(cell, vec3(1.7, 3.1, 2.3))), 16.0);
    col += albedo * step(0.12, sat) * (0.35 + 3.0 * tw);
  }
  if (mat == 1 || mat == 3) {
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 H = normalize(V + uLightDir);
    col += uLightCol * pow(max(dot(n, H), 0.0), 70.0) * 0.6 * sh * outdoor;
  }
  // rain makes surfaces darker and glossier
  if (uRain > 0.01 && n.y > 0.5) {
    vec3 V = normalize(cameraPosition - vWorld);
    col *= 1.0 - 0.25 * uRain * outdoor;
    col += skyGradient(reflect(-V, n)) * 0.08 * uRain * outdoor * pow(1.0 - max(dot(V, n), 0.0), 3.0);
  }
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;

// depth-only pass for the sun shadow map; waves leaves so shadows sway too
export const SHADOW_VERT = /* glsl */`
attribute vec4 aB;
uniform float uTime;
uniform float uWind;
varying vec3 vUV;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  int f = int(aB.w + 0.5);
  int wave = f & 3;
  if (wave == 1) {
    float ph = uTime * 1.7 + wp.x * 0.7 + wp.z * 0.5 + wp.y * 0.35;
    wp.xyz += vec3(sin(ph), sin(ph * 1.31) * 0.6, cos(ph * 0.93)) * 0.03 * uWind;
  } else if (wave >= 2) {
    float top = wave == 3 ? 0.5 : aB.z / 16.0;
    float ph = uTime * 2.0 + wp.x * 0.42 + wp.z * 0.57;
    float g = sin(ph) * 0.6 + sin(ph * 2.3 + 1.7) * 0.3 + sin(ph * 0.47) * 0.4;
    wp.xz += vec2(g, cos(ph * 1.13) * 0.7 + g * 0.3) * 0.075 * top * uWind;
  }
  vUV = vec3(aB.y / 16.0, 1.0 - aB.z / 16.0, aB.x);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
export const SHADOW_FRAG = /* glsl */`
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
uniform float uCutout;
varying vec3 vUV;
void main() {
  if (uCutout > 0.5 && texture(uAtlas, vUV).a < 0.5) discard;
  gl_FragColor = vec4(1.0);
}
`;

// ------------------------------------------------------------------ water
export const WATER_VERT = /* glsl */`
attribute vec4 aA;
attribute vec4 aB;
attribute vec4 aT;
uniform float uTime;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vL;
varying vec3 vTint;
varying float vViewDepth;
varying float vLava;
const vec3 NRM[7] = vec3[7](vec3(1.,0.,0.), vec3(-1.,0.,0.), vec3(0.,1.,0.), vec3(0.,-1.,0.), vec3(0.,0.,1.), vec3(0.,0.,-1.), vec3(0.,1.,0.));
void main() {
  int ni = int(aA.x + 0.5);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  if (ni == 2) {
    float w = sin(uTime * 1.3 + wp.x * 0.8 + wp.z * 0.3) * 0.5 + sin(uTime * 1.7 - wp.z * 0.9 + wp.x * 0.2) * 0.5;
    wp.y += w * 0.035 - 0.04;
  }
  vWorld = wp.xyz;
  vNormal = NRM[ni];
  vL = vec3(aA.y / 3.0, aA.z / 255.0, aA.w / 255.0);
  vTint = aT.rgb;
  vLava = aT.a;
  vec4 mv = viewMatrix * wp;
  vViewDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

export const WATER_FRAG = /* glsl */`
${COMMON}
${SHADOW}
uniform sampler2D tScene;     // rgb colour, a = linear depth
uniform vec2 uRes;
uniform mat4 uViewProj;
uniform vec3 uCamFwd;
uniform float uSSR;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vL;
varying vec3 vTint;
varying float vViewDepth;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float waveH(vec2 p) {
  float t = uTime;
  float h = vnoise(p * 0.9 + vec2(t * 0.35, t * 0.22)) * 0.55;
  h += vnoise(p * 2.1 - vec2(t * 0.5, -t * 0.3)) * 0.28;
  h += vnoise(p * 4.7 + vec2(-t * 0.8, t * 0.6)) * 0.12;
  h += sin(p.x * 1.3 + t * 1.6) * 0.05 + sin(p.y * 1.7 - t * 1.2) * 0.05;
  return h;
}
vec3 waterNormal(vec2 p, float strength) {
  float e = 0.08;
  float h = waveH(p);
  float hx = waveH(p + vec2(e, 0.0)) - h;
  float hz = waveH(p + vec2(0.0, e)) - h;
  return normalize(vec3(-hx / e * strength, 1.0, -hz / e * strength));
}
vec3 project(vec3 p) {
  vec4 c = uViewProj * vec4(p, 1.0);
  return vec3(c.xy / c.w * 0.5 + 0.5, c.w);
}

void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float sky = vL.y, blk = vL.z;
  bool top = vNormal.y > 0.5;
  vec3 n = top ? waterNormal(vWorld.xz, 0.22 + uRain * 0.25) : normalize(vNormal + vec3(0.0, 0.0, 0.0));
  bool below = dot(V, vNormal) < 0.0;
  if (below) n = -n;
  vec2 suv = gl_FragCoord.xy / uRes;
  float sceneD = texture(tScene, suv).a;
  float wd = max(sceneD - vViewDepth, 0.0);
  // refraction
  vec2 ruv = suv + n.xz * 0.045 * clamp(wd * 0.5, 0.0, 1.0) / max(vViewDepth * 0.08, 1.0);
  float rD = texture(tScene, ruv).a;
  if (rD < vViewDepth) ruv = suv;
  vec3 refr = texture(tScene, ruv).rgb;
  float wdr = max(texture(tScene, ruv).a - vViewDepth, 0.0);
  vec3 wcol = pow(vTint, vec3(2.2));
  float skyL = sky * sky;
  vec3 lightAmb = uAmbient * (0.35 + 0.65 * skyL) + uLightCol * max(uLightDir.y, 0.0) * 0.35 * skyL + uBlockCol * pow(blk, 1.7) * 0.6;
  vec3 scatter = wcol * lightAmb * 0.55;
  vec3 absorb = vec3(0.42, 0.11, 0.06) / max(wcol + 0.2, vec3(0.2));
  vec3 trans = exp(-absorb * (below ? 0.0 : wdr) * 0.55);
  vec3 under = refr * trans + scatter * (1.0 - trans);
  if (below) under = refr * vec3(0.7, 0.85, 0.95);

  // reflection: screen-space march, sky fallback
  vec3 R = reflect(-V, n);
  if (R.y < 0.02) R.y = 0.02;
  vec3 refl = skyGradient(normalize(R));
  float sh = getShadow(vWorld, vec3(0.0, 1.0, 0.0));
  float sunSpec = pow(max(dot(R, uLightDir), 0.0), 900.0) * 60.0 + pow(max(dot(R, uLightDir), 0.0), 90.0) * 1.2;
  refl += uLightCol * sunSpec * sh * smoothstep(0.5, 0.9, sky);
  refl *= mix(0.08, 1.0, smoothstep(0.2, 0.9, sky));
  if (uSSR > 0.5 && top && !below) {
    vec3 p = vWorld + n * 0.02;
    float stepL = 0.35;
    for (int i = 0; i < 28; i++) {
      p += R * stepL;
      stepL *= 1.16;
      vec3 sp = project(p);
      if (sp.x < 0.0 || sp.x > 1.0 || sp.y < 0.0 || sp.y > 1.0 || sp.z < 0.0) break;
      float d = texture(tScene, sp.xy).a;
      if (sp.z > d + 0.08 && sp.z - d < stepL * 2.5 + 0.6) {
        vec2 e = min(sp.xy, 1.0 - sp.xy);
        float fade = smoothstep(0.0, 0.12, min(e.x, e.y)) * (1.0 - float(i) / 28.0);
        refl = mix(refl, texture(tScene, sp.xy).rgb, fade);
        break;
      }
    }
  }
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  if (below) fres = smoothstep(0.55, 0.75, 1.0 - max(dot(n, V), 0.0)) * 0.9;
  vec3 col = mix(under, refl, clamp(fres, 0.0, 1.0));
  // shoreline foam
  if (top && !below) {
    float foam = smoothstep(0.35, 0.0, wd) * smoothstep(0.35, 0.75, vnoise(vWorld.xz * 3.0 + uTime * 0.6));
    col += foam * lightAmb * 0.35;
  }
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ------------------------------------------------------------------ sky
export const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
  gl_Position = p.xyww;
  gl_Position.z = gl_Position.w * 0.99999;
}
`;

export const SKY_FRAG = /* glsl */`
${COMMON}
uniform vec3 uMoonDir;
uniform float uStars;
uniform float uAurora;
uniform float uCloudCover;
uniform float uCloudDark;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec4 uShoot;   // start dir xyz, progress w
uniform vec3 uShootDir;
uniform float uFlash;
uniform float uSunSize;
varying vec3 vDir;

float hash13(vec3 p3) { p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += vnoise(p) * a; p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return s;
}

void main() {
  vec3 rd = normalize(vDir);
  vec3 col = skyGradient(rd);
  float up = max(rd.y, 0.0);

  // stars + milky band
  if (uStars > 0.01 && rd.y > -0.1) {
    vec3 sp = rd * 260.0;
    vec3 cell = floor(sp);
    float h = hash13(cell);
    if (h > 0.9965) {
      vec3 c = cell + 0.5 + (vec3(hash13(cell + 1.3), hash13(cell + 2.7), hash13(cell + 4.1)) - 0.5) * 0.6;
      float d = length(sp - c);
      float tw = 0.6 + 0.4 * sin(uTime * (2.0 + h * 40.0) + h * 100.0);
      float b = smoothstep(0.55, 0.0, d) * tw * (h - 0.9965) / 0.0035;
      vec3 sc = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.85, 0.7), hash13(cell + 9.1));
      col += sc * b * 3.5 * uStars;
    }
    float band = exp(-pow(dot(rd, normalize(vec3(0.3, 0.5, 0.8))) * 3.2, 2.0));
    col += vec3(0.08, 0.07, 0.12) * band * fbm(rd.xz * 8.0 + rd.y * 3.0) * uStars * up;
  }

  // sun and moon
  float sd = dot(rd, uSunDir);
  float sunDisk = smoothstep(uSunSize, uSunSize + 0.0006, sd);
  col += vec3(1.0, 0.9, 0.75) * sunDisk * 40.0 * (1.0 - uRain * 0.9) * smoothstep(-0.06, 0.02, uSunDir.y);
  col += uSunsetCol * pow(max(sd, 0.0), 250.0) * 3.0;
  float md = dot(rd, uMoonDir);
  if (md > 0.9985) {
    vec3 mt = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
    vec3 mb = cross(mt, uMoonDir);
    vec2 muv = vec2(dot(rd, mt), dot(rd, mb)) / 0.055;
    float crater = vnoise(muv * 9.0) * 0.5 + vnoise(muv * 23.0) * 0.25;
    float m = smoothstep(0.9985, 0.99875, md);
    col = mix(col, vec3(0.9, 0.93, 1.0) * (1.6 + crater * 0.8), m * (1.0 - uRain * 0.8));
  }
  col += vec3(0.35, 0.45, 0.7) * pow(max(md, 0.0), 300.0) * 0.6 * uNight;

  // aurora ribbons
  if (uAurora > 0.01 && rd.y > 0.02) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 10; i++) {
      float hgt = 1.0 + float(i) * 0.06;
      vec2 p = rd.xz / rd.y * hgt;
      float n = vnoise(p * 1.4 + vec2(uTime * 0.03, float(i) * 0.1)) ;
      float ribbon = smoothstep(0.08, 0.0, abs(sin(p.x * 1.2 + n * 4.0 + uTime * 0.05) * 0.5 + p.y * 0.18 - 0.2));
      vec3 c = mix(vec3(0.1, 1.0, 0.55), vec3(0.6, 0.2, 1.0), float(i) / 10.0);
      acc += c * ribbon * (1.0 - float(i) / 10.0);
    }
    col += acc * 0.22 * uAurora * smoothstep(0.02, 0.25, rd.y);
  }

  // shooting star
  if (uShoot.w > 0.0 && uShoot.w < 1.0) {
    vec3 a = normalize(uShoot.xyz);
    vec3 b = normalize(uShoot.xyz + uShootDir * 0.5);
    vec3 head = normalize(mix(a, b, uShoot.w));
    vec3 tail = normalize(mix(a, b, max(uShoot.w - 0.25, 0.0)));
    vec3 ab = head - tail;
    float t = clamp(dot(rd - tail, ab) / dot(ab, ab), 0.0, 1.0);
    float d = length(rd - (tail + ab * t));
    col += vec3(1.0, 0.95, 0.85) * smoothstep(0.0025, 0.0, d) * t * 6.0 * uStars * sin(uShoot.w * 3.14159);
  }

  // clouds: a soft fbm deck
  if (rd.y > 0.0) {
    float t = (2.0 - 0.0) / rd.y;
    vec2 p = rd.xz * t * 0.55 + vec2(uTime * 0.012, uTime * 0.004) + cameraPosition.xz * 0.0035;
    float cov = uCloudCover;
    float n = fbm(p * 1.3);
    float d = smoothstep(1.0 - cov, 1.0 - cov + 0.32, n);
    if (d > 0.0) {
      float n2 = fbm(p * 1.3 + uSunDir.xz * 0.08);
      float lit = clamp(0.55 + (n - n2) * 6.0, 0.0, 1.0);
      vec3 cc = mix(uCloudShade, uCloudLit, lit);
      cc += uSunsetCol * 0.5 * pow(max(sd, 0.0), 6.0);
      float fade = smoothstep(0.0, 0.22, rd.y);
      col = mix(col, cc, d * fade * 0.95);
    }
  }
  col += vec3(0.8, 0.85, 1.0) * uFlash;
  if (uUnderwater > 0.5) col = uWaterFog;
  gl_FragColor = vec4(col, 1.0);
}
`;

// ------------------------------------------------------------------ entities (box models, held items)
export const ENTITY_VERT = /* glsl */`
// position, normal and uv are declared by three.js for ShaderMaterial
varying vec3 vWorld;
varying vec3 vN;
varying vec2 vUv;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
export const ENTITY_FRAG = /* glsl */`
${COMMON}
${SHADOW}
uniform sampler2D uMap;
uniform vec3 uEnt;      // sky, block, hurt flash
uniform float uEmissive;
uniform float uFog;
uniform float uGlint;
varying vec3 vWorld;
varying vec3 vN;
varying vec2 vUv;
void main() {
  vec4 tex = texture(uMap, vUv);
  if (tex.a < 0.5) discard;
  vec3 albedo = pow(tex.rgb, vec3(2.2));
  vec3 n = normalize(vN);
  float sky = uEnt.x, blk = uEnt.y;
  float ndl = max(dot(n, uLightDir), 0.0);
  float sh = getShadow(vWorld, n);
  float outdoor = smoothstep(0.3, 0.9, sky);
  vec3 L = uLightCol * ndl * sh * outdoor;
  L += uAmbient * sky * sky * (0.75 + 0.25 * n.y);
  L += uBlockCol * pow(blk, 1.7);
  L += vec3(0.02);
  vec3 col = albedo * L + albedo * uEmissive;
  col = mix(col, vec3(1.2, 0.1, 0.05), uEnt.z * 0.6);
  if (uGlint > 0.5) {
    float g = pow(0.5 + 0.5 * sin((vUv.x + vUv.y) * 12.0 - uTime * 3.0), 6.0);
    col += vec3(0.6, 0.35, 1.0) * g * 0.9;
  }
  if (uFog > 0.5) col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;
export const ENTITY_SHADOW_FRAG = /* glsl */`
uniform sampler2D uMap;
varying vec2 vUv;
void main() { if (texture(uMap, vUv).a < 0.5) discard; gl_FragColor = vec4(1.0); }
`;

// blocks rendered as entities (dropped items, held blocks, falling sand): chunk attributes + uniform light
export const BLOCKENT_FRAG = /* glsl */`
${COMMON}
${SHADOW}
uniform sampler2DArray uAtlas;
uniform float uOverlayLayer;
uniform vec3 uEnt;
uniform float uFog;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vUV;
varying vec3 vL;
varying vec3 vTint;
varying float vFlags;
varying float vNi;
void main() {
  vec4 tex = texture(uAtlas, vUV);
  if (tex.a < 0.5) discard;
  int f = int(vFlags + 0.5);
  int overlay = (f >> 2) & 1;
  int mat = (f >> 4) & 7;
  vec3 tint = pow(vTint, vec3(2.2));
  vec3 albedo = pow(tex.rgb, vec3(2.2));
  if (overlay == 1) { vec4 ov = texture(uAtlas, vec3(vUV.xy, uOverlayLayer)); albedo = mix(albedo, pow(ov.rgb, vec3(2.2)) * tint, ov.a); }
  else albedo *= tint;
  vec3 n = normalize(vNormal);
  float sky = uEnt.x, blk = uEnt.y;
  float sh = getShadow(vWorld, n);
  float outdoor = smoothstep(0.3, 0.9, sky);
  vec3 L = uLightCol * max(dot(n, uLightDir), 0.0) * sh * outdoor + uAmbient * sky * sky * (0.75 + 0.25 * n.y) + uBlockCol * pow(blk, 1.7) + vec3(0.03);
  vec3 col = albedo * L;
  if (mat == 2 || mat == 4) col += albedo * 2.0 * smoothstep(0.5, 0.85, max(tex.r, max(tex.g, tex.b)));
  col = mix(col, vec3(1.0), uEnt.z);
  if (uFog > 0.5) col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;
export const BLOCKENT_VERT = /* glsl */`
attribute vec4 aA;
attribute vec4 aB;
attribute vec4 aT;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vUV;
varying vec3 vL;
varying vec3 vTint;
varying float vFlags;
varying float vNi;
const vec3 NRM[7] = vec3[7](vec3(1.,0.,0.), vec3(-1.,0.,0.), vec3(0.,1.,0.), vec3(0.,-1.,0.), vec3(0.,0.,1.), vec3(0.,0.,-1.), vec3(0.,1.,0.));
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * NRM[int(aA.x + 0.5)]);
  vNi = aA.x;
  vUV = vec3(aB.y / 16.0, 1.0 - aB.z / 16.0, aB.x);
  vL = vec3(aA.y / 3.0, aA.z / 255.0, aA.w / 255.0);
  vTint = aT.rgb;
  vFlags = aB.w;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

// ------------------------------------------------------------------ particles (instanced billboards)
export const PART_VERT = /* glsl */`
attribute vec3 iPos;
attribute vec4 iCol;     // rgb, alpha
attribute vec4 iTex;     // layer (-1 = soft dot), u0, v0, size
attribute float iGlow;
varying vec4 vCol;
varying vec3 vUV;
varying float vGlow;
varying vec2 vQ;
varying vec3 vWorld;
void main() {
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 wp = iPos + (right * position.x + up * position.y) * iTex.w;
  vWorld = wp;
  vCol = iCol;
  vGlow = iGlow;
  vQ = position.xy;
  vUV = vec3(iTex.y + (position.x + 0.5) * 0.25, 1.0 - (iTex.z + (0.5 - position.y) * 0.25), iTex.x);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
export const PART_FRAG = /* glsl */`
${COMMON}
uniform sampler2DArray uAtlas;
varying vec4 vCol;
varying vec3 vUV;
varying float vGlow;
varying vec2 vQ;
varying vec3 vWorld;
void main() {
  vec4 c;
  if (vUV.z < -0.5) {
    float d = length(vQ) * 2.0;
    float a = smoothstep(1.0, 0.0, d);
    a *= a;
    c = vec4(vCol.rgb, vCol.a * a);
    if (c.a < 0.01) discard;
  } else {
    vec4 t = texture(uAtlas, vUV);
    if (t.a < 0.5) discard;
    c = vec4(pow(t.rgb, vec3(2.2)) * vCol.rgb, vCol.a);
  }
  vec3 col = c.rgb * (vGlow > 0.5 ? 1.0 : 1.0);
  if (vGlow < 0.5) col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, c.a);
}
`;

// rain / snow streaks, GPU animated around the camera
export const RAIN_VERT = /* glsl */`
attribute vec4 iSeed;   // x, z offset, phase, speed
uniform float uTime;
uniform vec3 uCam;
uniform float uSnow;
uniform sampler2D uHeight;   // top block heights around the camera
uniform vec2 uHOrigin;       // world x,z of the height texture origin
varying float vA;
varying vec2 vQ;
void main() {
  float R = 26.0;
  float Hh = 34.0;
  vec2 off = (iSeed.xy - 0.5) * 2.0 * R;
  vec3 base = vec3(floor(uCam.x / (2.0 * R)) * 2.0 * R, 0.0, floor(uCam.z / (2.0 * R)) * 2.0 * R);
  vec3 p = vec3(base.x + off.x, 0.0, base.z + off.y);
  if (p.x - uCam.x > R) p.x -= 2.0 * R; if (p.x - uCam.x < -R) p.x += 2.0 * R;
  if (p.z - uCam.z > R) p.z -= 2.0 * R; if (p.z - uCam.z < -R) p.z += 2.0 * R;
  float speed = mix(iSeed.w * 8.0 + 16.0, iSeed.w * 0.8 + 1.4, uSnow);
  float y = mod(iSeed.z * Hh - uTime * speed, Hh);
  p.y = uCam.y + Hh * 0.5 - y;
  if (uSnow > 0.5) { p.x += sin(uTime * 0.9 + iSeed.z * 30.0) * 0.6; p.z += cos(uTime * 0.7 + iSeed.z * 21.0) * 0.6; }
  vec2 huv = (p.xz - uHOrigin) / 64.0;
  float ground = texture2D(uHeight, huv).r * 255.0 + 1.0;
  vA = (p.y < ground || huv.x < 0.0 || huv.x > 1.0 || huv.y < 0.0 || huv.y > 1.0) ? 0.0 : 1.0;
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), p - uCam));
  float w = uSnow > 0.5 ? 0.06 : 0.025;
  float len = uSnow > 0.5 ? 0.06 : 0.9;
  vec3 wp = p + right * position.x * w * 2.0 + (uSnow > 0.5 ? cross(right, normalize(p - uCam)) * position.y * w * 2.0 : vec3(0.0, position.y * len, 0.0));
  vA *= smoothstep(R, R * 0.6, length(p.xz - uCam.xz));
  vQ = position.xy;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
export const RAIN_FRAG = /* glsl */`
uniform float uSnow;
uniform float uAmount;
uniform vec3 uTintR;
varying float vA;
varying vec2 vQ;
void main() {
  if (vA < 0.01) discard;
  float a = uSnow > 0.5 ? smoothstep(0.5, 0.2, length(vQ)) : smoothstep(0.5, 0.0, abs(vQ.x)) * 0.45;
  gl_FragColor = vec4(uTintR * (uSnow > 0.5 ? 1.2 : 1.0), a * vA * uAmount);
}
`;

// ------------------------------------------------------------------ post
export const FS_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
export const COPY_FRAG = /* glsl */`
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform float uNear;
uniform float uFar;
varying vec2 vUv;
void main() {
  float z = texture2D(tDepth, vUv).r;
  float ndc = z * 2.0 - 1.0;
  float lin = 2.0 * uNear * uFar / (uFar + uNear - ndc * (uFar - uNear));
  gl_FragColor = vec4(texture2D(tColor, vUv).rgb, lin);
}
`;
export const BRIGHT_FRAG = /* glsl */`
uniform sampler2D tColor;
uniform vec2 uTexel;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = vec3(0.0);
  c += texture2D(tColor, vUv + uTexel * vec2(-0.5, -0.5)).rgb;
  c += texture2D(tColor, vUv + uTexel * vec2(0.5, -0.5)).rgb;
  c += texture2D(tColor, vUv + uTexel * vec2(-0.5, 0.5)).rgb;
  c += texture2D(tColor, vUv + uTexel * vec2(0.5, 0.5)).rgb;
  c *= 0.25;
  float b = max(c.r, max(c.g, c.b));
  float soft = clamp(b - uThreshold + 0.5, 0.0, 1.0);
  soft = soft * soft * 0.5;
  float contrib = max(soft, b - uThreshold) / max(b, 1e-4);
  gl_FragColor = vec4(min(c * contrib, vec3(60.0)), 1.0);
}
`;
export const DOWN_FRAG = /* glsl */`
uniform sampler2D tColor;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(tColor, vUv).rgb * 4.0;
  s += texture2D(tColor, vUv - uTexel).rgb;
  s += texture2D(tColor, vUv + uTexel).rgb;
  s += texture2D(tColor, vUv + vec2(uTexel.x, -uTexel.y)).rgb;
  s += texture2D(tColor, vUv - vec2(uTexel.x, -uTexel.y)).rgb;
  gl_FragColor = vec4(s / 8.0, 1.0);
}
`;
export const UP_FRAG = /* glsl */`
uniform sampler2D tColor;
uniform sampler2D tPrev;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec2 h = uTexel * 0.5;
  vec3 s = texture2D(tColor, vUv + vec2(-h.x * 2.0, 0.0)).rgb;
  s += texture2D(tColor, vUv + vec2(-h.x, h.y)).rgb * 2.0;
  s += texture2D(tColor, vUv + vec2(0.0, h.y * 2.0)).rgb;
  s += texture2D(tColor, vUv + vec2(h.x, h.y)).rgb * 2.0;
  s += texture2D(tColor, vUv + vec2(h.x * 2.0, 0.0)).rgb;
  s += texture2D(tColor, vUv + vec2(h.x, -h.y)).rgb * 2.0;
  s += texture2D(tColor, vUv + vec2(0.0, -h.y * 2.0)).rgb;
  s += texture2D(tColor, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
  gl_FragColor = vec4(s / 12.0 + texture2D(tPrev, vUv).rgb, 1.0);
}
`;
export const RAYS_FRAG = /* glsl */`
uniform sampler2D tScene;
uniform vec2 uSun;
uniform float uFar;
uniform float uStrength;
uniform vec3 uColor;
varying vec2 vUv;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  if (uStrength <= 0.001) { gl_FragColor = vec4(0.0); return; }
  vec2 d = (uSun - vUv) / 48.0;
  vec2 p = vUv + d * hash12(gl_FragCoord.xy);
  float acc = 0.0, w = 1.0;
  for (int i = 0; i < 48; i++) {
    float sky = step(uFar * 0.9, texture2D(tScene, p).a);
    float r = length((p - uSun) * vec2(1.6, 1.0));
    acc += sky * w * exp(-r * 3.0);
    w *= 0.97;
    p += d;
  }
  gl_FragColor = vec4(uColor * acc / 48.0 * uStrength, 1.0);
}
`;
export const COMPOSITE_FRAG = /* glsl */`
uniform sampler2D tColor;
uniform sampler2D tBloom;
uniform sampler2D tRays;
uniform float uExposure;
uniform float uBloom;
uniform float uUnderwater;
uniform float uDamage;
uniform float uTime;
uniform float uSat;
uniform float uVignette;
uniform float uFade;
uniform vec3 uGrade;
varying vec2 vUv;
vec3 aces(vec3 x) {
  const mat3 ACESIn = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 ACESOut = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  vec3 v = ACESIn * x;
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(ACESOut * (a / b), 0.0, 1.0);
}
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec2 uv = vUv;
  if (uUnderwater > 0.5) uv += vec2(sin(uv.y * 24.0 + uTime * 2.0), cos(uv.x * 19.0 + uTime * 1.7)) * 0.0025;
  vec3 c = texture2D(tColor, uv).rgb;
  c += texture2D(tBloom, uv).rgb * uBloom;
  c += texture2D(tRays, uv).rgb;
  c *= uExposure;
  c *= uGrade;
  c = aces(c);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  c = pow(c, vec3(1.0 / 2.2));
  vec2 q = vUv - 0.5;
  float vig = 1.0 - dot(q, q) * uVignette;
  c *= vig;
  if (uUnderwater > 0.5) c = mix(c, c * vec3(0.55, 0.8, 1.0), 0.5);
  float dmg = uDamage * smoothstep(0.15, 0.75, length(q) * 1.4);
  c = mix(c, vec3(0.7, 0.02, 0.02), dmg * 0.65);
  c *= uFade;
  c += (hash12(gl_FragCoord.xy + uTime) - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
}
`;
