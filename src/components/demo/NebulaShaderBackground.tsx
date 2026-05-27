'use client';

// Procedural nebula via WebGL fragment shader.
// Domain-warped fractional brownian motion (FBM) generates organic
// flowing patterns — same technique used by Inigo Quilez for the
// classic "clouds" demo. Two passes of warping create the swirling
// aurora-like motion, then a gold/amber/cream gradient grades the
// result. No primitives, no dots — just procedural light.
//
// Performance: DPR capped at 1.5, fullscreen quad rendered once per
// frame. ~60fps on M1, comfortable on most laptops.

import { useEffect, useRef } from 'react';

const VERT_SHADER = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAG_SHADER = `precision highp float;
uniform float u_time;
uniform vec2 u_resolution;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 p = (uv * 2.0 - 1.0);
  p.x *= u_resolution.x / u_resolution.y;

  float t = u_time * 0.05;

  // Two passes of domain warping for organic aurora flow
  vec2 q;
  q.x = fbm(p + vec2(t * 0.30, t * 0.15));
  q.y = fbm(p + vec2(t * 0.20 + 1.7, -t * 0.25 + 9.2));

  vec2 r;
  r.x = fbm(p + 4.0 * q + vec2(t * 0.40, t * 0.20));
  r.y = fbm(p + 4.0 * q + vec2(-t * 0.20 + 8.3, t * 0.10));

  float n = fbm(p + 4.0 * r);

  // Aurora — gentler now so cards on top stay readable
  float aurora = smoothstep(0.0, 0.7, n) * 0.50;

  // Edge vignette — dims the corners/edges slightly
  float edgeVignette = smoothstep(1.6, 0.5, length(p));

  // Content darkening — dim the middle of the screen where UI cards
  // sit, so text on top of the cards has a darker bg through the
  // backdrop-blur. Strongest at center, fades by ~50% radius out.
  float contentDim = 1.0 - smoothstep(0.55, 0.0, length(p)) * 0.55;

  // Muted palette — pulled brightness ~30% lower so the brightest
  // peaks no longer punch through the glass cards
  vec3 deep  = vec3(0.42, 0.16, 0.00);
  vec3 gold  = vec3(0.78, 0.46, 0.00);
  vec3 cream = vec3(0.85, 0.62, 0.32);

  vec3 col = mix(deep, gold, smoothstep(0.0, 0.6, n));
  col = mix(col, cream, smoothstep(0.55, 0.95, n) * 0.4);
  col *= aurora * edgeVignette * contentDim;

  // Faint warm atmosphere fills the dim regions (also reduced)
  col += vec3(0.012, 0.006, 0.001) * edgeVignette;

  // Near-black base (matches #0a0a0a)
  vec3 bg = vec3(0.039);

  gl_FragColor = vec4(bg + col, 1.0);
}
`;

function compileShader(gl: WebGLRenderingContext, source: string, type: number): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export const NebulaShaderBackground = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false });
    if (!gl) {
      console.warn('WebGL not supported — nebula background unavailable');
      return;
    }

    const vert = compileShader(gl, VERT_SHADER, gl.VERTEX_SHADER);
    const frag = compileShader(gl, FRAG_SHADER, gl.FRAGMENT_SHADER);
    if (!vert || !frag) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      return;
    }

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );

    const posLoc = gl.getAttribLocation(program, 'a_position');
    const timeLoc = gl.getUniformLocation(program, 'u_time');
    const resLoc = gl.getUniformLocation(program, 'u_resolution');

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener('resize', resize);

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let animationId = 0;
    const start = performance.now();

    const render = () => {
      const t = reduced ? 0 : (performance.now() - start) / 1000;
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(timeLoc, t);
      gl.uniform2f(resLoc, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (!reduced) {
        animationId = requestAnimationFrame(render);
      }
    };
    render();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationId);
      gl.deleteProgram(program);
      gl.deleteShader(vert);
      gl.deleteShader(frag);
      gl.deleteBuffer(buffer);
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: -1,
        background: '#0a0a0a',
        overflow: 'hidden',
      }}
    >
      <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0 }} />
    </div>
  );
};
