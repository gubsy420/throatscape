/* ============================================================
   WebGL context, shaders, and the one program the game uses
   ------------------------------------------------------------
   Everything in the Throat is drawn the same way: untextured
   triangles carrying a colour per vertex, lit by one directional
   light and a fill, and faded into the distance by fog. That is
   the whole material system, and it is the material system the
   games this one is imitating had.
   ============================================================ */

const VERT = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;

uniform mat4 uViewProj;
uniform mat4 uModel;
uniform vec3 uTint;        // multiplied into the colour: hurt flashes, depletion
uniform float uFade;       // 1 solid, 0 invisible

out vec3 vColor;
out vec3 vNormal;
out float vDist;
out float vFade;

void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  gl_Position = uViewProj * world;

  // No non-uniform scaling is ever used, so the model matrix rotates
  // normals correctly without needing an inverse transpose.
  vNormal = mat3(uModel) * aNormal;
  vColor = aColor * uTint;
  vDist = gl_Position.w;
  vFade = uFade;
}`;

const FRAG = `#version 300 es
precision highp float;

in vec3 vColor;
in vec3 vNormal;
in float vDist;
in float vFade;

uniform vec3 uLightDir;    // towards the key light
uniform vec3 uSun;         // its colour and strength
uniform vec3 uSky;         // fill arriving from above
uniform vec3 uGround;      // fill bounced back off the floor
uniform vec3 uFogColor;
uniform vec2 uFogRange;    // starts, ends
uniform float uAlpha;

out vec4 fragColor;

void main() {
  vec3 n = normalize(vNormal);

  /*
   * One key light plus a two-colour fill: sky from above, bounce from below,
   * blended by which way the face points. A single ambient term makes every
   * shadowed face the same flat grey, which is what a box of low-polygon
   * models looks worst under - this keeps the undersides readable and still
   * lets the key light do the shaping.
   */
  float ndl = max(dot(n, normalize(uLightDir)), 0.0);
  float hemi = n.y * 0.5 + 0.5;
  vec3 lit = vColor * (mix(uGround, uSky, hemi) + uSun * ndl);

  float fog = clamp((vDist - uFogRange.x) / max(uFogRange.y - uFogRange.x, 0.001), 0.0, 1.0);
  vec3 out3 = mix(lit, uFogColor, fog * fog);

  if (vFade < 0.999) {
    // Ordered dither, so a fading object needs neither sorting nor blending.
    float m = mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y) * 2.0, 4.0) / 4.0;
    if (vFade < m) discard;
  }
  fragColor = vec4(out3, uAlpha);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('shader failed to compile: ' + log);
  }
  return sh;
}

/**
 * A compiled program with its uniform locations already looked up. Locations
 * are fetched once here rather than by name every draw, which matters when
 * there are a few hundred draws a frame.
 */
export function makeProgram(gl) {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('program failed to link: ' + gl.getProgramInfoLog(prog));
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  const u = {};
  for (const name of ['uViewProj', 'uModel', 'uTint', 'uFade', 'uAlpha',
                      'uLightDir', 'uSun', 'uSky', 'uGround', 'uFogColor', 'uFogRange']) {
    u[name] = gl.getUniformLocation(prog, name);
  }
  return { prog, u };
}

/**
 * Asks for a context suited to a game rather than to a document: no alpha to
 * composite, no premultiply, and antialiasing on, because flat-shaded edges
 * without it look like a mistake.
 */
export function getContext(canvas) {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: true,
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false
  });
  if (!gl) return null;

  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.frontFace(gl.CCW);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  return gl;
}

/** Is there any hope of running the 3D renderer here? */
export function supported() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}
