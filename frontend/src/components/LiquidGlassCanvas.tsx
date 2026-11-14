import React, { useEffect, useRef, useState } from 'react';

export interface LiquidGlassOptics {
  ior: number;        // 1.00 - 2.50 (default 1.46)
  dispersion: number; // 0.00 - 1.00 (default 0.35)
  smoothK: number;    // 0 - 90 (default 30)
  blur: number;       // 0.00 - 1.00 (default 0.35)
}

interface LiquidGlassCanvasProps {
  isDark: boolean;
  optics: LiquidGlassOptics;
  resetTrigger?: number;
  onSelectFlashcards?: () => void;
  onWebglUnavailable?: () => void;
}

interface PillState {
  x: number;
  y: number;
  tx: number;
  ty: number;
  halfLen: number;
  radius: number;
}

const BLOBS = [
  { color: [0x3b, 0x5b, 0xdb], radius: 0.44, speedA: 0.24, speedB: 0.19, phase: 0.0 },
  { color: [0x0a, 0x84, 0xff], radius: 0.48, speedA: 0.18, speedB: 0.25, phase: 1.7 },
  { color: [0x5e, 0x5c, 0xe6], radius: 0.36, speedA: 0.22, speedB: 0.16, phase: 3.1 },
  { color: [0x2b, 0x8a, 0x3e], radius: 0.28, speedA: 0.16, speedB: 0.22, phase: 4.4 },
];

const LIGHT_PASTELS = [
  [59, 91, 219],
  [56, 189, 248],
  [129, 140, 248],
  [43, 138, 62],
];

const VERT_SRC = `
  attribute vec2 aPos;
  uniform vec4 uView;
  varying vec2 vDip;
  void main() {
    vec2 zeroToOne = (aPos + 1.0) * 0.5;
    vDip = vec2(zeroToOne.x * uView.x, (1.0 - zeroToOne.y) * uView.y);
    gl_Position = vec4(aPos, 0.0, 1.0);
  }
`;

const BG_FRAG_SRC = `
  precision highp float;
  uniform sampler2D uBackground;
  uniform vec4 uView;
  varying vec2 vDip;
  void main() {
    vec2 uv = clamp(vDip / uView.xy, vec2(0.0), vec2(1.0));
    gl_FragColor = texture2D(uBackground, uv);
  }
`;

const GLASS_FRAG_SRC = `
  precision highp float;
  uniform sampler2D uBackground;
  uniform sampler2D uBackdrop;

  uniform vec4 uView;
  uniform vec4 uGlassA;
  uniform vec4 uGlassB;
  uniform vec4 uDroplet;   // Unused / 0.0 (no cursor glass)
  uniform vec4 uOptics;    // x=ior, y=disp, z=smoothK, w=blur
  uniform vec4 uSurface;   // x=bezel, y=depth, z=specIntensity, w=tintStrength
  uniform float uLightMode;
  uniform float uLayer;    // 0.0=panels, 1.0=metaballs

  uniform vec4 uPanelRects[16];
  uniform vec4 uPanelMeta[16];

  varying vec2 vDip;
  const float EPS = 0.001;

  float sstep(float e0, float e1, float x) {
    float den = e1 - e0;
    if (abs(den) < EPS) den = den < 0.0 ? -EPS : EPS;
    float t = clamp((x - e0) / den, 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
  }

  float sdCapsule(vec2 p, vec4 cap) {
    vec2 q = p - cap.xy;
    float hl = max(cap.z, EPS);
    vec2 pa = vec2(q.x + hl, q.y);
    vec2 ba = vec2(2.0 * hl, 0.0);
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - cap.w;
  }

  float sdRoundBox(vec2 p, vec2 c, vec2 b, float r) {
    float rr = min(r, min(b.x, b.y));
    vec2 q = abs(p - c) - b + vec2(rr);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rr;
  }

  float smin(float a, float b, float k) {
    if (k < 0.0005) return min(a, b);
    float kk = max(k, EPS);
    float h = clamp(0.5 + 0.5 * (b - a) / kk, 0.0, 1.0);
    return mix(b, a, h) - kk * h * (1.0 - h);
  }

  float blobsSdf(vec2 p) {
    return smin(sdCapsule(p, uGlassA), sdCapsule(p, uGlassB), uOptics.z);
  }

  float hardSdf(vec2 p) {
    return min(sdCapsule(p, uGlassA), sdCapsule(p, uGlassB));
  }

  float uiPanelsSdf(vec2 p, out float outBezel, out float outBodyMix) {
    float d = 10000.0;
    outBezel = uSurface.x;
    outBodyMix = 0.0;
    for (int i = 0; i < 16; i++) {
      if (uPanelMeta[i].w > 0.5) {
        float pd = sdRoundBox(p, uPanelRects[i].xy, uPanelRects[i].zw, uPanelMeta[i].x);
        if (pd < d) {
          d = pd;
          outBezel = uPanelMeta[i].y;
          outBodyMix = uPanelMeta[i].z;
        }
      }
    }
    return d;
  }

  float sceneSdf(vec2 p, out float outBezel, out float outBodyMix, out float isBlob) {
    if (uLayer > 0.5) {
      outBezel = uSurface.x;
      outBodyMix = 0.0;
      isBlob = 1.0;
      return blobsSdf(p);
    }
    float bBezel, bMix;
    float dp = uiPanelsSdf(p, bBezel, bMix);
    outBezel = bBezel;
    outBodyMix = bMix;
    isBlob = 0.0;
    return dp;
  }

  float sceneOnlyDist(vec2 p) {
    float dummy1, dummy2, dummy3;
    return sceneSdf(p, dummy1, dummy2, dummy3);
  }

  vec2 gradAt(vec2 p) {
    float e = 1.0;
    float dx = sceneOnlyDist(p + vec2(e, 0.0)) - sceneOnlyDist(p - vec2(e, 0.0));
    float dy = sceneOnlyDist(p + vec2(0.0, e)) - sceneOnlyDist(p - vec2(0.0, e));
    vec2 g = vec2(dx, dy);
    float m = length(g);
    if (m < EPS) return vec2(0.0, -1.0);
    return g / m;
  }

  void main() {
    vec2 p = vDip;
    float bezel, bodyMix, isBlob;
    float d = sceneSdf(p, bezel, bodyMix, isBlob);

    float aa = 1.15;
    float cover = 1.0 - sstep(-aa, aa, d);
    float shadowOpacity = uLightMode > 0.5 ? (isBlob > 0.5 ? 0.22 : 0.10) : 0.45;
    float shadow = (1.0 - sstep(0.0, 38.0, d)) * (1.0 - cover) * shadowOpacity;

    if (cover <= 0.0008 && shadow <= 0.0008) {
      discard;
    }

    vec3 shadowTint = uLightMode > 0.5 ? vec3(0.07, 0.09, 0.16) : vec3(0.0);
    if (cover <= 0.0008) {
      gl_FragColor = vec4(shadowTint * shadow, shadow);
      return;
    }

    float bz = max(bezel, 2.0);
    float inner = clamp(-d / bz, 0.0, 1.0);
    float slope = pow(max(0.0, 1.0 - inner * inner), 0.78);

    vec2 n = gradAt(p);
    vec2 ripple = vec2(sin(p.y * 0.047 + uView.z * 1.9),
                       cos(p.x * 0.041 - uView.z * 1.6)) * 0.05 * slope * (0.45 + 0.55 * isBlob);
    vec2 nn = normalize(n + ripple);

    float ior = clamp(uOptics.x, 1.0, 2.5);
    float depth = max(uSurface.y, 0.0);
    float flow = 0.72 + 0.28 * sin(uView.z * 1.15 + (p.x + p.y) * 0.010);
    float amp = slope * depth * ((ior - 1.0) / 0.5) * flow * (isBlob > 0.5 ? 1.0 : 0.75);
    float disp = clamp(uOptics.y, 0.0, 1.0) * 0.30;
    float blurMix = clamp(uOptics.w, 0.0, 1.0) * (0.28 + 0.72 * pow(1.0 - inner, 1.4));

    vec2 offR = nn * amp * (1.0 - disp);
    vec2 offG = nn * amp;
    vec2 offB = nn * amp * (1.0 + disp);

    vec2 invView = 1.0 / max(uView.xy, vec2(1.0));
    float sR = texture2D(uBackground, clamp((p + offR) * invView, vec2(0.0), vec2(1.0))).r;
    float sG = texture2D(uBackground, clamp((p + offG) * invView, vec2(0.0), vec2(1.0))).g;
    float sB = texture2D(uBackground, clamp((p + offB) * invView, vec2(0.0), vec2(1.0))).b;
    vec3 refr = vec3(sR, sG, sB);

    if (blurMix > 0.01) {
      vec3 soft = texture2D(uBackdrop, clamp((p + offG) * invView, vec2(0.0), vec2(1.0))).rgb;
      refr = mix(refr, soft, clamp(blurMix, 0.0, 1.0));
    }

    float rim = pow(1.0 - inner, 2.1);
    vec2 ld = normalize(vec2(-0.52, -0.86));
    float ndl = clamp(dot(nn, ld), 0.0, 1.0);
    float specular = (pow(ndl, 18.0) * 0.45 + pow(ndl, 220.0) * 1.35) * max(uSurface.z, 0.0);

    vec3 tintCol = uLightMode > 0.5 ? vec3(0.99, 0.99, 0.98) : vec3(0.11, 0.12, 0.15);
    vec3 col = refr;

    if (bodyMix > 0.001) {
      vec3 readTint = uLightMode > 0.5 ? vec3(1.0, 1.0, 1.0) : vec3(0.09, 0.10, 0.13);
      col = mix(col, readTint, bodyMix * (uLightMode > 0.5 ? 0.55 : 0.55 + 0.35 * inner));
    }

    vec3 iceRim = uLightMode > 0.5 ? vec3(0.90, 0.94, 1.0) : vec3(0.36, 0.48, 0.85);
    col = mix(col, mix(tintCol, iceRim, 0.45), clamp(uSurface.w, 0.0, 1.0) * (0.06 + 0.32 * rim));
    col *= 1.0 - (uLightMode > 0.5 ? 0.10 : 0.18) * (1.0 - sstep(0.0, 2.6, -d));

    float edgeLine = pow(clamp(1.0 - abs(d + 0.9) / 2.4, 0.0, 1.0), 2.2);
    col += edgeLine * (uLightMode > 0.5 ? 0.38 : 0.16) * iceRim;
    if (uLightMode > 0.5) {
      col = mix(col, vec3(0.74, 0.82, 0.94), edgeLine * (isBlob > 0.5 ? 0.44 : 0.24));
      col.r -= disp * rim * 0.20 * (0.35 + 0.65 * max(nn.x, 0.0));
      col.g -= disp * rim * 0.07;
      col.b -= disp * rim * 0.13 * (0.35 + 0.65 * max(-nn.x, 0.0));
    } else {
      col.r += disp * rim * 0.34;
      col.b += disp * rim * 0.24;
    }
    col += specular * (uLightMode > 0.5 ? vec3(1.0) * 0.72 : vec3(0.92, 0.95, 1.0) * 0.85);

    if (isBlob > 0.5) {
      float glue = hardSdf(p) - blobsSdf(p);
      float bridge = clamp(glue * 0.42, 0.0, 1.0) * clamp(uOptics.z / 24.0, 0.0, 1.0);
      col += bridge * (uLightMode > 0.5 ? -0.05 * vec3(0.45, 0.18, 0.0) : 0.22 * vec3(0.72, 0.84, 1.0));
    }

    float aOut = cover + (1.0 - cover) * shadow;
    vec3 pm = clamp(col, 0.0, 1.0) * cover + shadowTint * (1.0 - cover) * shadow;
    gl_FragColor = vec4(pm, aOut);
  }
`;

export const LiquidGlassCanvas: React.FC<LiquidGlassCanvasProps> = ({
  isDark,
  optics,
  resetTrigger = 0,
  onSelectFlashcards,
  onWebglUnavailable,
}) => {
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pill0Ref = useRef<HTMLDivElement | null>(null);
  const pill1Ref = useRef<HTMLDivElement | null>(null);
  const [pillsReady, setPillsReady] = useState(false);

  const darkRef = useRef(isDark);
  darkRef.current = isDark;
  const opticsRef = useRef(optics);
  opticsRef.current = optics;
  const onFlashcardsRef = useRef(onSelectFlashcards);
  onFlashcardsRef.current = onSelectFlashcards;

  const pillsStateRef = useRef<{
    pills: [PillState, PillState];
    initialised: boolean;
    manuallyMoved: boolean;
    lastW: number;
    lastH: number;
  }>({
    pills: [
      { x: 0, y: 0, tx: 0, ty: 0, halfLen: 64, radius: 22 },
      { x: 0, y: 0, tx: 0, ty: 0, halfLen: 36, radius: 20 },
    ],
    initialised: false,
    manuallyMoved: false,
    lastW: 0,
    lastH: 0,
  });

  useEffect(() => {
    if (resetTrigger > 0) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const dockY = Math.max(220, h - 44);
      const x0 = Math.max(220, w - 220);
      const x1 = Math.max(x0 + 150, w - 70);
      const st = pillsStateRef.current;
      st.manuallyMoved = false;
      st.lastW = w;
      st.lastH = h;
      st.pills[0].tx = x0;
      st.pills[0].ty = dockY;
      st.pills[1].tx = x1;
      st.pills[1].ty = dockY;
    }
  }, [resetTrigger]);

  useEffect(() => {
    const glCanvas = glCanvasRef.current;
    if (!glCanvas) return;

    const gl =
      (glCanvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true }) as WebGLRenderingContext | null) ||
      (glCanvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true }) as WebGLRenderingContext | null) ||
      (glCanvas.getContext('experimental-webgl') as WebGLRenderingContext | null);

    if (!gl) {
      onWebglUnavailable?.();
      return;
    }

    try {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) {
        const renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '').toLowerCase();
        if (renderer.includes('swiftshader') || renderer.includes('llvmpipe')) {
          onWebglUnavailable?.();
          return;
        }
      }
    } catch {
      // ignore if extension blocked
    }

    const compileShader = (type: number, src: string) => {
      const sh = gl.createShader(type);
      if (!sh) throw new Error('Shader creation failed');
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const err = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        throw new Error(err || 'Shader compile error');
      }
      return sh;
    };

    const createProgram = (vsSrc: string, fsSrc: string) => {
      const vs = compileShader(gl.VERTEX_SHADER, vsSrc);
      const fs = compileShader(gl.FRAGMENT_SHADER, fsSrc);
      const prog = gl.createProgram();
      if (!prog) throw new Error('Program creation failed');
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(prog) || 'Program link error');
      }
      return { prog, vs, fs };
    };

    const createClampTexture = () => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return tex;
    };

    let bgCompiled: ReturnType<typeof createProgram>;
    let glassCompiled: ReturnType<typeof createProgram>;
    try {
      bgCompiled = createProgram(VERT_SRC, BG_FRAG_SRC);
      glassCompiled = createProgram(VERT_SRC, GLASS_FRAG_SRC);
    } catch (err) {
      console.error('Liquid Glass shader compile error:', err);
      onWebglUnavailable?.();
      return;
    }

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    const quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const texBg = createClampTexture();
    const texBlur = createClampTexture();

    const bgLocs = {
      aPos: gl.getAttribLocation(bgCompiled.prog, 'aPos'),
      uView: gl.getUniformLocation(bgCompiled.prog, 'uView'),
      uBackground: gl.getUniformLocation(bgCompiled.prog, 'uBackground'),
    };

    const glassLocs = {
      aPos: gl.getAttribLocation(glassCompiled.prog, 'aPos'),
      uBackground: gl.getUniformLocation(glassCompiled.prog, 'uBackground'),
      uBackdrop: gl.getUniformLocation(glassCompiled.prog, 'uBackdrop'),
      uView: gl.getUniformLocation(glassCompiled.prog, 'uView'),
      uGlassA: gl.getUniformLocation(glassCompiled.prog, 'uGlassA'),
      uGlassB: gl.getUniformLocation(glassCompiled.prog, 'uGlassB'),
      uDroplet: gl.getUniformLocation(glassCompiled.prog, 'uDroplet'),
      uOptics: gl.getUniformLocation(glassCompiled.prog, 'uOptics'),
      uSurface: gl.getUniformLocation(glassCompiled.prog, 'uSurface'),
      uLightMode: gl.getUniformLocation(glassCompiled.prog, 'uLightMode'),
      uLayer: gl.getUniformLocation(glassCompiled.prog, 'uLayer'),
      uPanelRects: Array.from({ length: 16 }, (_, i) =>
        gl.getUniformLocation(glassCompiled.prog, `uPanelRects[${i}]`)
      ),
      uPanelMeta: Array.from({ length: 16 }, (_, i) =>
        gl.getUniformLocation(glassCompiled.prog, `uPanelMeta[${i}]`)
      ),
    };

    const bgCanvas = document.createElement('canvas');
    const blurCanvas = document.createElement('canvas');
    const bgCtx = bgCanvas.getContext('2d');
    const blurCtx = blurCanvas.getContext('2d');

    if (!bgCtx || !blurCtx) {
      onWebglUnavailable?.();
      return;
    }

    setPillsReady(true);

    // Drag interactions for bottom-right metaball capsules
    let dragIdx = -1;
    let dragGrabX = 0;
    let dragGrabY = 0;
    let dragStartX = 0;
    let dragStartY = 0;
    let movedThisPress = false;

    const onPtrMove = (e: PointerEvent) => {
      if (dragIdx >= 0) {
        if (Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) > 4) {
          movedThisPress = true;
          pillsStateRef.current.manuallyMoved = true;
        }
        const p = pillsStateRef.current.pills[dragIdx];
        p.tx = e.clientX - dragGrabX;
        p.ty = e.clientY - dragGrabY;
      }
    };

    const onPtrUp = () => {
      if (dragIdx === 1 && !movedThisPress) {
        onFlashcardsRef.current?.();
      }
      dragIdx = -1;
    };

    const makeDownHandler = (idx: 0 | 1) => (e: PointerEvent) => {
      const p = pillsStateRef.current.pills[idx];
      dragIdx = idx;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      movedThisPress = false;
      dragGrabX = e.clientX - p.x;
      dragGrabY = e.clientY - p.y;
      (e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    };

    const down0 = makeDownHandler(0);
    const down1 = makeDownHandler(1);
    const p0El = pill0Ref.current;
    const p1El = pill1Ref.current;

    p0El?.addEventListener('pointerdown', down0);
    p1El?.addEventListener('pointerdown', down1);
    window.addEventListener('pointermove', onPtrMove);
    window.addEventListener('pointerup', onPtrUp);
    window.addEventListener('pointercancel', onPtrUp);

    const gatherDomPanels = () => {
      const els = document.querySelectorAll<HTMLElement>('[data-glass-panel]');
      const mainRect = document.querySelector('main')?.getBoundingClientRect();
      const asideRect = document.querySelector('aside')?.getBoundingClientRect();
      const rects: {
        cx: number;
        cy: number;
        hx: number;
        hy: number;
        radius: number;
        bezel: number;
        darkmix: number;
      }[] = [];

      for (const el of els) {
        if (rects.length >= 16) break;
        const r = el.getBoundingClientRect();
        if (r.width < 12 || r.height < 12) continue;

        let top = r.top;
        let bottom = r.bottom;
        if (el.closest('main') && mainRect) {
          top = Math.max(top, mainRect.top);
          bottom = Math.min(bottom, mainRect.bottom);
        } else if (el.closest('aside') && asideRect) {
          top = Math.max(top, asideRect.top);
          bottom = Math.min(bottom, asideRect.bottom);
        }
        const h = bottom - top;
        if (h < 12 || r.right < 0 || r.left > window.innerWidth) continue;

        const computedRadius = parseFloat(getComputedStyle(el).borderTopLeftRadius || '16') || 16;
        rects.push({
          cx: r.left + r.width * 0.5,
          cy: top + h * 0.5,
          hx: r.width * 0.5,
          hy: h * 0.5,
          radius: parseFloat(el.dataset.radius || String(computedRadius)),
          bezel: parseFloat(el.dataset.bezel || '22'),
          darkmix: parseFloat(el.dataset.darkmix || '0.38'),
        });
      }
      return rects;
    };

    const renderBackdrop = (w: number, h: number, t: number, dpr: number, lightMode: boolean, blurAmt: number) => {
      const pw = Math.max(1, Math.ceil(w * dpr));
      const ph = Math.max(1, Math.ceil(h * dpr));
      const bw = Math.max(1, Math.floor(pw / 3));
      const bh = Math.max(1, Math.floor(ph / 3));

      if (bgCanvas.width !== pw || bgCanvas.height !== ph) {
        bgCanvas.width = pw;
        bgCanvas.height = ph;
      }
      if (blurCanvas.width !== bw || blurCanvas.height !== bh) {
        blurCanvas.width = bw;
        blurCanvas.height = bh;
      }

      const c = bgCtx;
      c.save();
      c.setTransform(dpr, 0, 0, dpr, 0, 0);

      const baseGrad = c.createLinearGradient(0, 0, w, h);
      if (lightMode) {
        baseGrad.addColorStop(0, '#FAF9F6');
        baseGrad.addColorStop(0.55, '#F6F5F0');
        baseGrad.addColorStop(1, '#FAF9F6');
      } else {
        baseGrad.addColorStop(0, '#121316');
        baseGrad.addColorStop(0.55, '#17191E');
        baseGrad.addColorStop(1, '#121316');
      }
      c.fillStyle = baseGrad;
      c.fillRect(0, 0, w, h);

      // Soft ambient blooms
      c.save();
      c.globalCompositeOperation = lightMode ? 'source-over' : 'screen';
      const minSide = Math.min(w, h);
      BLOBS.forEach((b, idx) => {
        const bx = w * (0.5 + 0.36 * Math.sin(t * b.speedA * 1.4 + b.phase));
        const by = h * (0.5 + 0.34 * Math.cos(t * b.speedB * 1.4 + b.phase * 1.3));
        const r = minSide * (b.radius * 1.05);
        const rg = c.createRadialGradient(bx, by, 0, bx, by, r);
        const [cr, cg, cb] = lightMode ? LIGHT_PASTELS[idx] : b.color;
        const a0 = lightMode ? 0.14 : 0.42;
        const a1 = lightMode ? 0.05 : 0.16;
        rg.addColorStop(0, `rgba(${cr},${cg},${cb},${a0})`);
        rg.addColorStop(0.5, `rgba(${cr},${cg},${cb},${a1})`);
        rg.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
        c.fillStyle = rg;
        c.beginPath();
        c.arc(bx, by, r, 0, Math.PI * 2);
        c.fill();
      });
      c.restore();

      // Architectural 46px coordinate grid for visible lens refraction
      const step = 46;
      c.lineWidth = 1;
      for (let x = 0, i = 0; x <= w; x += step, i += 1) {
        const major = i % 5 === 0;
        c.strokeStyle = lightMode
          ? `rgba(59, 91, 219, ${major ? 0.075 : 0.032})`
          : `rgba(255, 255, 255, ${major ? 0.09 : 0.035})`;
        c.beginPath();
        c.moveTo(x, 0);
        c.lineTo(x, h);
        c.stroke();
      }
      for (let y = 0, i = 0; y <= h; y += step, i += 1) {
        const major = i % 5 === 0;
        c.strokeStyle = lightMode
          ? `rgba(59, 91, 219, ${major ? 0.075 : 0.032})`
          : `rgba(255, 255, 255, ${major ? 0.09 : 0.035})`;
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(w, y);
        c.stroke();
      }

      // Concentric refraction calibration rings in bottom-right dock
      const mbCx = w - 150;
      const mbCy = h - 46;
      for (let i = 0; i < 6; i += 1) {
        c.strokeStyle = lightMode
          ? `rgba(59, 91, 219, ${(0.085 + i * 0.015).toFixed(3)})`
          : `rgba(92, 124, 250, ${(0.14 + i * 0.025).toFixed(3)})`;
        c.lineWidth = 1.25;
        c.beginPath();
        c.arc(mbCx, mbCy, 30 + i * 24, 0, Math.PI * 2);
        c.stroke();
      }
      c.restore();

      // Generate 1/3 downsampled blurred uBackdrop
      const sigma = (1.0 + 2.6 * Math.max(0, Math.min(1, blurAmt))).toFixed(2);
      blurCtx.clearRect(0, 0, bw, bh);
      blurCtx.save();
      blurCtx.filter = `blur(${sigma}px)`;
      blurCtx.drawImage(bgCanvas, 0, 0, bw, bh);
      blurCtx.restore();
    };

    const startTime = performance.now();
    let lastFrame = startTime;
    let rafId = 0;

    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1000));
      lastFrame = now;
      const t = (now - startTime) / 1000;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);

      const st = pillsStateRef.current;
      if (!st.initialised || (!st.manuallyMoved && (w !== st.lastW || h !== st.lastH))) {
        st.initialised = true;
        st.lastW = w;
        st.lastH = h;
        const dockY = Math.max(220, h - 44);
        const x0 = Math.max(220, w - 220);
        const x1 = Math.max(x0 + 150, w - 70);
        st.pills[0].x = st.pills[0].tx = x0;
        st.pills[0].y = st.pills[0].ty = dockY;
        st.pills[1].x = st.pills[1].tx = x1;
        st.pills[1].y = st.pills[1].ty = dockY;
      }

      const pillEase = 1 - Math.exp(-20.0 * dt);
      const pillEls = [pill0Ref.current, pill1Ref.current];
      st.pills.forEach((p, idx) => {
        p.tx = Math.max(p.halfLen + p.radius + 8, Math.min(w - p.halfLen - p.radius - 8, p.tx));
        p.ty = Math.max(p.radius + 114, Math.min(h - p.radius - 8, p.ty));
        p.x += (p.tx - p.x) * pillEase;
        p.y += (p.ty - p.y) * pillEase;
        const el = pillEls[idx];
        if (el) {
          el.style.left = `${p.x.toFixed(1)}px`;
          el.style.top = `${p.y.toFixed(1)}px`;
        }
      });

      const curOpt = opticsRef.current;
      const lightMode = !darkRef.current;
      renderBackdrop(w, h, t, dpr, lightMode, curOpt.blur);
      const panels = gatherDomPanels();

      const pw = Math.max(1, Math.ceil(w * dpr));
      const ph = Math.max(1, Math.ceil(h * dpr));
      if (glCanvas.width !== pw || glCanvas.height !== ph) {
        glCanvas.width = pw;
        glCanvas.height = ph;
      }
      gl.viewport(0, 0, pw, ph);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texBg);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bgCanvas);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, texBlur);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, blurCanvas);

      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);

      gl.disable(gl.BLEND);
      gl.useProgram(bgCompiled.prog);
      gl.enableVertexAttribArray(bgLocs.aPos);
      gl.vertexAttribPointer(bgLocs.aPos, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1i(bgLocs.uBackground, 0);
      gl.uniform4f(bgLocs.uView, w, h, t, dpr);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(glassCompiled.prog);
      gl.enableVertexAttribArray(glassLocs.aPos);
      gl.vertexAttribPointer(glassLocs.aPos, 2, gl.FLOAT, false, 0, 0);

      gl.uniform1i(glassLocs.uBackground, 0);
      gl.uniform1i(glassLocs.uBackdrop, 1);
      gl.uniform4f(glassLocs.uView, w, h, t, dpr);
      gl.uniform4f(
        glassLocs.uGlassA,
        st.pills[0].x,
        st.pills[0].y,
        st.pills[0].halfLen,
        st.pills[0].radius
      );
      gl.uniform4f(
        glassLocs.uGlassB,
        st.pills[1].x,
        st.pills[1].y,
        st.pills[1].halfLen,
        st.pills[1].radius
      );
      gl.uniform4f(glassLocs.uDroplet, 0, 0, 0, 0.0);
      gl.uniform4f(glassLocs.uOptics, curOpt.ior, curOpt.dispersion, curOpt.smoothK, curOpt.blur);
      gl.uniform4f(glassLocs.uSurface, 28.0, 42.0, 1.15, 0.85);
      gl.uniform1f(glassLocs.uLightMode, lightMode ? 1.0 : 0.0);

      for (let i = 0; i < 16; i += 1) {
        if (i < panels.length) {
          const p = panels[i];
          gl.uniform4f(glassLocs.uPanelRects[i], p.cx, p.cy, p.hx, p.hy);
          gl.uniform4f(glassLocs.uPanelMeta[i], p.radius, p.bezel, p.darkmix, 1.0);
        } else {
          gl.uniform4f(glassLocs.uPanelRects[i], 0, 0, 0, 0);
          gl.uniform4f(glassLocs.uPanelMeta[i], 0, 0, 0, 0.0);
        }
      }
      gl.uniform1f(glassLocs.uLayer, 0.0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.uniform1f(glassLocs.uLayer, 1.0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      p0El?.removeEventListener('pointerdown', down0);
      p1El?.removeEventListener('pointerdown', down1);
      window.removeEventListener('pointermove', onPtrMove);
      window.removeEventListener('pointerup', onPtrUp);
      window.removeEventListener('pointercancel', onPtrUp);
      gl.deleteTexture(texBg);
      gl.deleteTexture(texBlur);
      gl.deleteProgram(bgCompiled.prog);
      gl.deleteShader(bgCompiled.vs);
      gl.deleteShader(bgCompiled.fs);
      gl.deleteProgram(glassCompiled.prog);
      gl.deleteShader(glassCompiled.vs);
      gl.deleteShader(glassCompiled.fs);
      gl.deleteBuffer(quadBuf);
    };
  }, [onWebglUnavailable]);

  return (
    <>
      <canvas
        ref={glCanvasRef}
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          width: '100vw',
          height: '100vh',
          display: 'block',
          zIndex: 0,
          pointerEvents: 'none',
        }}
      />
      {/* Two Draggable Liquid Glass Metaball Pills (no cursor-following droplet) */}
      <div
        ref={pill0Ref}
        className="floating-pill-label"
        style={{ opacity: pillsReady ? 1 : 0 }}
        title="按住拖拽主胶囊即可与旁边胶囊融合产生液桥"
      >
        <span className="floating-pill-title">Liquid Glass</span>
        <span className="floating-pill-sub">按住拖拽 · 光学融球</span>
      </div>
      <div
        ref={pill1Ref}
        className="floating-pill-label"
        style={{ opacity: pillsReady ? 1 : 0 }}
        title="点击前往练习 / 闪卡记忆，或拖拽靠近主胶囊融合"
      >
        <span className="floating-pill-title">◎ 键盘闪卡</span>
      </div>
    </>
  );
};
