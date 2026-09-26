import { packHeading } from '../simulation/feed'
import type { FleetView } from '../state/useCouriers'
import { createSprite, drawBadge, drawPointer, SPRITE_SIZE, STATUSES, VEHICLES } from './icons'
import type { CustomLayerInterface, Map as MapLibreMap } from './maplibre'
import type { Renderer } from './renderers'

const LAYER_ID = 'couriers-gpu'
/** Atlas layout: one pointer per status, then a badge per vehicle and status. */
const POINTER_CELLS = STATUSES.length
const CELLS = POINTER_CELLS + VEHICLES.length * STATUSES.length

const VERTEX_SHADER = `#version 300 es
uniform mat4 u_matrix;
uniform float u_size;
in vec2 a_position;
in float a_status;
in float a_vehicle;
in float a_heading;
out float v_pointer;
out float v_badge;
out float v_heading;

void main() {
  gl_Position = u_matrix * vec4(a_position, 0.0, 1.0);
  gl_PointSize = u_size;
  v_pointer = a_status;
  v_badge = ${POINTER_CELLS}.0 + a_vehicle * ${STATUSES.length}.0 + a_status;
  v_heading = a_heading / 256.0 * 6.2831853;
}`

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_atlas;
in float v_pointer;
in float v_badge;
in float v_heading;
out vec4 fragColor;

vec4 cell(float index, vec2 uv) {
  return texture(u_atlas, vec2((index + uv.x) / ${CELLS}.0, uv.y));
}

void main() {
  vec2 uv = gl_PointCoord;
  // The pointer is drawn facing north; sample it rotated by the heading.
  vec2 d = uv - 0.5;
  float s = sin(v_heading);
  float c = cos(v_heading);
  vec2 rotated = vec2(c * d.x + s * d.y, -s * d.x + c * d.y) + 0.5;
  bool inside = all(greaterThanEqual(rotated, vec2(0.0))) && all(lessThanEqual(rotated, vec2(1.0)));
  vec4 pointer = inside ? cell(v_pointer, rotated) : vec4(0.0);
  vec4 badge = cell(v_badge, uv);
  // Premultiplied alpha: the badge goes over the pointer.
  fragColor = badge + pointer * (1.0 - badge.a);
  if (fragColor.a == 0.0) discard;
}`

/**
 * Draws couriers as sprites straight from typed arrays. Positions are kept in
 * Web Mercator units, the space MapLibre's matrix expects, and uploaded to the
 * GPU in one call when they change. Unlike a GeoJSON source there is nothing
 * to re-tile in a worker, so every update shows up on the next frame.
 */
export function createGpuRenderer(
  map: MapLibreMap,
  view: FleetView,
  onApplied: () => void,
): Renderer {
  let positions = new Float32Array()
  // status, vehicle and packed heading per courier
  let attributes = new Uint8Array()
  let dirty = true
  let uploaded = -1 // courier count the GPU buffers were sized for
  let gpu: ReturnType<typeof setUp> | undefined

  const write = (i: number) => {
    positions[i * 2] = mercatorX(view.lng(i))
    positions[i * 2 + 1] = mercatorY(view.lat(i))
    attributes[i * 3] = view.status(i)
    attributes[i * 3 + 1] = view.vehicle(i)
    attributes[i * 3 + 2] = packHeading(view.heading(i))
  }

  const update = (changed: Uint32Array | null) => {
    const count = view.count()
    if (positions.length !== count * 2) {
      positions = new Float32Array(count * 2)
      attributes = new Uint8Array(count * 3)
      changed = null
    }
    if (changed) changed.forEach(write)
    else for (let i = 0; i < count; i++) write(i)
    dirty = true
    map.triggerRepaint()
  }

  const layer: CustomLayerInterface = {
    id: LAYER_ID,
    type: 'custom',
    renderingMode: '2d',
    onAdd(_map, gl) {
      gpu = setUp(gl)
    },
    render(gl, { defaultProjectionData }) {
      if (!gpu) return
      const count = positions.length / 2
      gl.useProgram(gpu.program)
      gl.bindVertexArray(gpu.vao)
      if (dirty) {
        // Reallocate only when the fleet size changes; otherwise overwrite in place.
        const resize = uploaded !== count
        const upload = (buffer: WebGLBuffer, data: ArrayBufferView) => {
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
          if (resize) gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW)
          else gl.bufferSubData(gl.ARRAY_BUFFER, 0, data)
        }
        upload(gpu.positionBuffer, positions)
        upload(gpu.attributeBuffer, attributes)
        uploaded = count
        dirty = false
        onApplied()
      }
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, gpu.atlas)
      gl.uniform1i(gpu.uniforms.atlas, 0)
      // Maps Web Mercator 0..1 to clip space; enough for a mercator-only layer.
      gl.uniformMatrix4fv(
        gpu.uniforms.matrix,
        false,
        new Float32Array(defaultProjectionData.mainMatrix),
      )
      gl.uniform1f(gpu.uniforms.size, SPRITE_SIZE * gpu.ratio)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.drawArrays(gl.POINTS, 0, count)
      gl.bindVertexArray(null)
    },
    onRemove(_map, gl) {
      if (!gpu) return
      gl.deleteBuffer(gpu.positionBuffer)
      gl.deleteBuffer(gpu.attributeBuffer)
      gl.deleteTexture(gpu.atlas)
      gl.deleteVertexArray(gpu.vao)
      gl.deleteProgram(gpu.program)
      gpu = undefined
      uploaded = -1
    },
  }

  update(null)
  map.addLayer(layer)

  return {
    update,
    destroy() {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID)
    },
  }
}

function setUp(gl: WebGL2RenderingContext) {
  const program = gl.createProgram()
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER))
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Courier shader failed to link: ${gl.getProgramInfoLog(program)}`)
  }

  const vao = gl.createVertexArray()
  gl.bindVertexArray(vao)
  const positionBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  attribute(gl, program, 'a_position', 2, gl.FLOAT, 0, 0)
  const attributeBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, attributeBuffer)
  attribute(gl, program, 'a_status', 1, gl.UNSIGNED_BYTE, 3, 0)
  attribute(gl, program, 'a_vehicle', 1, gl.UNSIGNED_BYTE, 3, 1)
  attribute(gl, program, 'a_heading', 1, gl.UNSIGNED_BYTE, 3, 2)
  gl.bindVertexArray(null)

  // One texel per device pixel, so NEAREST filtering is sharp and cells don't bleed.
  const ratio = window.devicePixelRatio
  const atlas = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, atlas)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, drawAtlas(ratio))
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

  return {
    program,
    vao,
    positionBuffer,
    attributeBuffer,
    atlas,
    ratio,
    uniforms: {
      matrix: gl.getUniformLocation(program, 'u_matrix'),
      size: gl.getUniformLocation(program, 'u_size'),
      atlas: gl.getUniformLocation(program, 'u_atlas'),
    },
  }
}

/** All sprites in one row, in the order the shaders index them. */
function drawAtlas(ratio: number): HTMLCanvasElement {
  const size = Math.round(SPRITE_SIZE * ratio)
  const atlas = document.createElement('canvas')
  atlas.width = size * CELLS
  atlas.height = size
  const context = atlas.getContext('2d')!
  const sprites = [
    ...STATUSES.map((status) => createSprite((c) => drawPointer(c, status), ratio)),
    ...VEHICLES.flatMap((vehicle) =>
      STATUSES.map((status) => createSprite((c) => drawBadge(c, vehicle, status), ratio)),
    ),
  ]
  sprites.forEach((sprite, i) => context.drawImage(sprite, i * size, 0))
  return atlas
}

function compile(gl: WebGL2RenderingContext, type: GLenum, source: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`Courier shader failed to compile: ${gl.getShaderInfoLog(shader)}`)
  }
  return shader
}

function attribute(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
  size: number,
  type: GLenum,
  stride: number,
  offset: number,
) {
  const location = gl.getAttribLocation(program, name)
  gl.enableVertexAttribArray(location)
  gl.vertexAttribPointer(location, size, type, false, stride, offset)
}

/** Web Mercator in MapLibre's world units: the whole world is 0..1 on both axes. */
function mercatorX(lng: number): number {
  return (180 + lng) / 360
}

function mercatorY(lat: number): number {
  return (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360
}
