import { invariant } from './invariant';
// Original native WebGL classroom illustration. This geometry is schematic,
// not a dimensional drawing of the motor or the Schneider drive. The physical
// shaft angle comes only from the engine; see Fuentes.md for the motor model.
export interface MotorView {
  draw(angle: number): void;
  dispose(): void;
}
type Vec3 = readonly [number, number, number];
interface MeshData { data: Float32Array; vertices: number }
interface GPUMesh { buffer: WebGLBuffer; vertices: number }
interface Resources {
  program: WebGLProgram;
  position: number;
  normal: number;
  tone: number;
  clip: WebGLUniformLocation;
  model: WebGLUniformLocation;
  housing: GPUMesh;
  rotor: GPUMesh;
}
type GPUResult<T> = { ok: true; value: T } | { ok: false; message: string };
type ViewState =
  | { kind: 'ready'; gl: WebGLRenderingContext; resources: Resources }
  | { kind: 'unavailable'; message: string }
  | { kind: 'lost' }
  | { kind: 'disposed' };
const VERTEX_SHADER = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute float aTone;
uniform mat4 uClip;
uniform mat4 uModel;
varying vec3 vNormal;
varying float vTone;
void main() {
  gl_Position = uClip * uModel * vec4(aPosition, 1.0);
  vNormal = mat3(uModel) * aNormal;
  vTone = aTone;
}`;
const FRAGMENT_SHADER = `
precision mediump float;
varying vec3 vNormal;
varying float vTone;
void main() {
  vec3 light = normalize(vec3(-0.45, 0.8, 1.0));
  float shade = 0.47 + 0.53 * max(dot(normalize(vNormal), light), 0.0);
  gl_FragColor = vec4(vec3(vTone * shade), 1.0);
}`;
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const NO_WEBGL = 'Vista 3D no disponible. Este navegador no ofrece WebGL.';
const NO_RESOURCES = 'No se pudo iniciar la vista 3D.';

function subtract(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalized(vector: Vec3): Vec3 {
  const length = Math.hypot(...vector);
  invariant(length > 0, 'un vector de cámara tiene longitud cero');
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}
function matrixEntry(matrix: Float32Array, index: number): number {
  const value = matrix[index];
  invariant(value !== undefined, 'índice de matriz fuera de rango');
  return value;
}
function product(left: Float32Array, right: Float32Array): Float32Array {
  invariant(left.length === 16 && right.length === 16, 'se esperaba una matriz de 4 por 4');
  return new Float32Array(Array.from({ length: 16 }, (_, index) => {
    const column = Math.floor(index / 4), row = index % 4;
    let value = 0;
    for (let k = 0; k < 4; k++) value += matrixEntry(left, 4 * k + row) * matrixEntry(right, 4 * column + k);
    return value;
  }));
}
function cameraProjection(aspect: number): Float32Array {
  invariant(aspect > 0 && Number.isFinite(aspect), 'relación de aspecto inválida');
  const halfAngle = 14 * Math.PI / 180;
  // Fit the complete motor in either dimension, including narrow layouts.
  const limitingAngle = Math.min(halfAngle, Math.atan(Math.tan(halfAngle) * aspect));
  const distance = 1.36 / Math.sin(limitingAngle);
  const direction = normalized([-2.75, 1.6, 4.15]);
  const target: Vec3 = [0, 0, -0.31];
  const eye: Vec3 = [direction[0] * distance, direction[1] * distance, target[2] + direction[2] * distance];
  const z = normalized(subtract(eye, target));
  const x = normalized(cross([0, 1, 0], z));
  const y = cross(z, x);
  const view = new Float32Array([
    x[0], y[0], z[0], 0, x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
  const near = 0.1, far = distance + 8, f = 1 / Math.tan(halfAngle);
  const projection = new Float32Array([
    f / aspect, 0, 0, 0, 0, f, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, 2 * far * near / (near - far), 0,
  ]);
  return product(projection, view);
}
function rotation(angle: number): Float32Array {
  const c = Math.cos(angle), s = Math.sin(angle);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}
function vertex(output: number[], position: Vec3, normal: Vec3, tone: number): void {
  output.push(...position, ...normal, tone);
}
function triangle(output: number[], a: Vec3, b: Vec3, c: Vec3, normal: Vec3, tone: number): void {
  vertex(output, a, normal, tone); vertex(output, b, normal, tone); vertex(output, c, normal, tone);
}
function box(output: number[], center: Vec3, size: Vec3, tone: number, angle = 0): void {
  const c = Math.cos(angle), s = Math.sin(angle);
  const point = (x: number, y: number, z: number): Vec3 => [center[0] + x * c - y * s, center[1] + x * s + y * c, center[2] + z];
  const half: Vec3 = [size[0] / 2, size[1] / 2, size[2] / 2];
  const face = (normal: Vec3, a: Vec3, b: Vec3, d: Vec3, e: Vec3): void => {
    const transformed: Vec3 = [normal[0] * c - normal[1] * s, normal[0] * s + normal[1] * c, normal[2]];
    const transform = (v: Vec3): Vec3 => point(v[0] * half[0], v[1] * half[1], v[2] * half[2]);
    triangle(output, transform(a), transform(b), transform(d), transformed, tone);
    triangle(output, transform(a), transform(d), transform(e), transformed, tone);
  };
  face([1, 0, 0], [1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]);
  face([-1, 0, 0], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]);
  face([0, 1, 0], [-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]);
  face([0, -1, 0], [-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]);
  face([0, 0, 1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]);
  face([0, 0, -1], [1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]);
}
function cylinder(output: number[], radius: number, rear: number, front: number, tone: number, segments = 64): void {
  for (let i = 0; i < segments; i++) {
    const a = 2 * Math.PI * i / segments, b = 2 * Math.PI * (i + 1) / segments;
    const na: Vec3 = [Math.cos(a), Math.sin(a), 0], nb: Vec3 = [Math.cos(b), Math.sin(b), 0];
    const ra: Vec3 = [radius * na[0], radius * na[1], rear], rb: Vec3 = [radius * nb[0], radius * nb[1], rear];
    const fa: Vec3 = [ra[0], ra[1], front], fb: Vec3 = [rb[0], rb[1], front];
    vertex(output, ra, na, tone); vertex(output, rb, nb, tone); vertex(output, fb, nb, tone);
    vertex(output, ra, na, tone); vertex(output, fb, nb, tone); vertex(output, fa, na, tone);
    triangle(output, [0, 0, front], fa, fb, [0, 0, 1], tone);
    triangle(output, [0, 0, rear], rb, ra, [0, 0, -1], tone);
  }
}
function meshData(values: number[]): MeshData {
  invariant(values.length > 0 && values.length % 21 === 0, 'la geometría no contiene triángulos completos');
  invariant(values.every(Number.isFinite), 'la geometría contiene coordenadas inválidas');
  return { data: new Float32Array(values), vertices: values.length / 7 };
}
function motorGeometry(): { housing: MeshData; rotor: MeshData } {
  const housing: number[] = [], rotor: number[] = [];
  cylinder(housing, 0.5, -1.3, 0.02, 0.74);
  cylinder(housing, 0.54, -1.42, -1.29, 0.67);
  cylinder(housing, 0.55, 0.02, 0.14, 0.77);
  for (let i = 0; i < 18; i++) {
    const angle = i * 2 * Math.PI / 18;
    box(housing, [0.55 * Math.cos(angle), 0.55 * Math.sin(angle), -0.65], [0.14, 0.028, 1.2], 0.71, angle);
  }
  for (const x of [-0.34, 0.34]) {
    box(housing, [x, -0.58, -0.68], [0.18, 0.25, 0.9], 0.64);
    box(housing, [x, -0.73, -0.68], [0.3, 0.07, 1.06], 0.68);
  }
  box(housing, [0, 0.65, -0.7], [0.47, 0.22, 0.44], 0.72);
  box(housing, [0, 0.77, -0.7], [0.5, 0.035, 0.47], 0.8);
  cylinder(rotor, 0.105, 0.13, 0.6, 0.62);
  cylinder(rotor, 0.73, 0.56, 0.67, 0.87);
  cylinder(rotor, 0.15, 0.67, 0.72, 0.57);
  // A raised dark radial mark rotates with the actual shaft angle.
  box(rotor, [0, 0.425, 0.675], [0.055, 0.51, 0.008], 0.13);
  return { housing: meshData(housing), rotor: meshData(rotor) };
}
function shader(gl: WebGLRenderingContext, type: number, source: string): GPUResult<WebGLShader> {
  const compiled = gl.createShader(type);
  if (!compiled) return { ok: false, message: NO_RESOURCES };
  gl.shaderSource(compiled, source); gl.compileShader(compiled);
  if (!gl.getShaderParameter(compiled, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(compiled);
    gl.deleteShader(compiled);
    if (gl.isContextLost()) return { ok: false, message: NO_RESOURCES };
    invariant(false, 'el shader propio no compiló: ' + message);
  }
  return { ok: true, value: compiled };
}
function upload(gl: WebGLRenderingContext, mesh: MeshData): GPUResult<GPUMesh> {
  const buffer = gl.createBuffer();
  if (!buffer) return { ok: false, message: NO_RESOURCES };
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, mesh.data, gl.STATIC_DRAW);
  const error = gl.getError();
  if (error !== gl.NO_ERROR) {
    gl.deleteBuffer(buffer);
    if (error === gl.OUT_OF_MEMORY || gl.isContextLost()) return { ok: false, message: NO_RESOURCES };
    invariant(false, 'falló la carga de geometría: ' + error);
  }
  return { ok: true, value: { buffer, vertices: mesh.vertices } };
}
function createResources(gl: WebGLRenderingContext, geometry: ReturnType<typeof motorGeometry>): GPUResult<Resources> {
  const vertex = shader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  if (!vertex.ok) return vertex;
  const fragment = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!fragment.ok) { gl.deleteShader(vertex.value); return fragment; }
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertex.value); gl.deleteShader(fragment.value);
    return { ok: false, message: NO_RESOURCES };
  }
  gl.attachShader(program, vertex.value); gl.attachShader(program, fragment.value); gl.linkProgram(program);
  gl.deleteShader(vertex.value); gl.deleteShader(fragment.value);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    if (gl.isContextLost()) return { ok: false, message: NO_RESOURCES };
    invariant(false, 'el programa propio no enlazó: ' + message);
  }
  const housing = upload(gl, geometry.housing);
  if (!housing.ok) { gl.deleteProgram(program); return housing; }
  const rotor = upload(gl, geometry.rotor);
  if (!rotor.ok) { gl.deleteBuffer(housing.value.buffer); gl.deleteProgram(program); return rotor; }
  const position = gl.getAttribLocation(program, 'aPosition');
  const normal = gl.getAttribLocation(program, 'aNormal');
  const tone = gl.getAttribLocation(program, 'aTone');
  const clip = gl.getUniformLocation(program, 'uClip'), model = gl.getUniformLocation(program, 'uModel');
  if (gl.isContextLost()) {
    gl.deleteBuffer(housing.value.buffer); gl.deleteBuffer(rotor.value.buffer); gl.deleteProgram(program);
    return { ok: false, message: NO_RESOURCES };
  }
  invariant(position >= 0 && normal >= 0 && tone >= 0 && clip !== null && model !== null, 'faltan entradas del programa gráfico');
  return { ok: true, value: { program, position, normal, tone, clip, model, housing: housing.value, rotor: rotor.value } };
}
function deleteResources(gl: WebGLRenderingContext, resources: Resources): void {
  gl.deleteBuffer(resources.housing.buffer); gl.deleteBuffer(resources.rotor.buffer); gl.deleteProgram(resources.program);
}
function drawMesh(gl: WebGLRenderingContext, resources: Resources, mesh: GPUMesh, model: Float32Array): void {
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
  gl.vertexAttribPointer(resources.position, 3, gl.FLOAT, false, 28, 0);
  gl.vertexAttribPointer(resources.normal, 3, gl.FLOAT, false, 28, 12);
  gl.vertexAttribPointer(resources.tone, 1, gl.FLOAT, false, 28, 24);
  gl.enableVertexAttribArray(resources.position); gl.enableVertexAttribArray(resources.normal); gl.enableVertexAttribArray(resources.tone);
  gl.uniformMatrix4fv(resources.model, false, model); gl.drawArrays(gl.TRIANGLES, 0, mesh.vertices);
}

export function makeMotorView(canvas: HTMLCanvasElement): MotorView {
  invariant(canvas.isConnected, 'el canvas debe estar conectado al documento');
  const geometry = motorGeometry();
  const context = canvas.getContext('webgl', { alpha: false, antialias: true, depth: true });
  const fallback = document.createElement('div');
  fallback.setAttribute('role', 'status');
  Object.assign(fallback.style, {
    position: 'fixed', display: 'none', boxSizing: 'border-box', padding: '18px',
    background: '#fff', color: '#333', font: '16px/1.4 Arial, sans-serif',
    alignItems: 'center', justifyContent: 'center', textAlign: 'center', pointerEvents: 'none', zIndex: '10',
  });
  document.body.append(fallback);
  const originalVisibility = canvas.style.visibility;
  let lastAngle: number | null = null;
  let lastFrame: { angle: number; width: number; height: number; ratio: number; resources: Resources } | null = null;
  let state: ViewState;
  function initialize(gl: WebGLRenderingContext): ViewState {
    const result = createResources(gl, geometry);
    return result.ok ? { kind: 'ready', gl, resources: result.value } : { kind: 'unavailable', message: result.message };
  }
  state = context ? initialize(context) : { kind: 'unavailable', message: NO_WEBGL };
  function showFallback(message: string): void {
    const bounds = canvas.getBoundingClientRect();
    fallback.textContent = message;
    Object.assign(fallback.style, {
      display: bounds.width > 0 && bounds.height > 0 ? 'flex' : 'none',
      left: bounds.left + 'px', top: bounds.top + 'px', width: bounds.width + 'px', height: bounds.height + 'px',
    });
    canvas.style.visibility = 'hidden';
  }
  function draw(angle: number): void {
    invariant(state.kind !== 'disposed', 'se intentó dibujar después de liberar la vista');
    invariant(Number.isFinite(angle), 'el ángulo físico debe ser finito');
    lastAngle = angle;
    if (state.kind === 'unavailable') { showFallback(state.message); return; }
    if (state.kind === 'lost') { showFallback('Se perdió la vista 3D. Esperando recuperar WebGL.'); return; }
    const { gl, resources } = state;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const ratio = window.devicePixelRatio;
    invariant(Number.isFinite(ratio) && ratio > 0, 'densidad de píxeles inválida');
    const width = Math.max(1, Math.round(bounds.width * ratio)), height = Math.max(1, Math.round(bounds.height * ratio));
    // A stationary canvas retains its displayed frame. Resource identity also
    // invalidates this cache when a lost WebGL context is restored.
    if (lastFrame?.angle === angle && lastFrame.width === bounds.width && lastFrame.height === bounds.height
      && lastFrame.ratio === ratio && lastFrame.resources === resources && canvas.width === width && canvas.height === height) return;
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    fallback.style.display = 'none'; canvas.style.visibility = originalVisibility;
    gl.viewport(0, 0, width, height); gl.clearColor(1, 1, 1, 1);
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.useProgram(resources.program);
    gl.uniformMatrix4fv(resources.clip, false, cameraProjection(bounds.width / bounds.height));
    drawMesh(gl, resources, resources.housing, IDENTITY);
    drawMesh(gl, resources, resources.rotor, rotation(angle));
    lastFrame = { angle, width: bounds.width, height: bounds.height, ratio, resources };
  }
  const lost = (event: Event): void => {
    event.preventDefault();
    if (state.kind === 'disposed') return;
    state = { kind: 'lost' };
    lastFrame = null;
    showFallback('Se perdió la vista 3D. Esperando recuperar WebGL.');
  };
  const restored = (): void => {
    if (state.kind === 'disposed') return;
    invariant(context !== null, 'la restauración requiere un contexto creado');
    state = initialize(context);
    if (lastAngle !== null) draw(lastAngle);
  };
  const resize = (): void => { if (state.kind !== 'disposed' && lastAngle !== null) draw(lastAngle); };
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', restored);
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
  observer?.observe(canvas);
  return {
    draw,
    dispose(): void {
      if (state.kind === 'disposed') return;
      if (state.kind === 'ready') deleteResources(state.gl, state.resources);
      state = { kind: 'disposed' };
      lastFrame = null;
      observer?.disconnect();
      canvas.removeEventListener('webglcontextlost', lost); canvas.removeEventListener('webglcontextrestored', restored);
      canvas.style.visibility = originalVisibility;
      fallback.remove();
    },
  };
}
