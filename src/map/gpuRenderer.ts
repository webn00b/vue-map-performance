import { STATUS_COLORS } from '../colors'
import { Status } from '../simulation/fleet'
import type { FleetView } from '../state/useCouriers'
import type { CustomLayerInterface, Map as MapLibreMap } from './maplibre'
import type { Renderer } from './renderers'

const LAYER_ID = 'couriers-gpu'
/** Same look as the GeoJSON circle layer: 4 px radius plus a 1 px white stroke. */
const POINT_SIZE = 10

const VERTEX_SHADER = `#version 300 es
uniform mat4 u_matrix;
uniform float u_size;
uniform vec3 u_colors[3];
in vec2 a_position;
in float a_status;
out vec3 v_color;

void main() {
  gl_Position = u_matrix * vec4(a_position, 0.0, 1.0);
  gl_PointSize = u_size;
  v_color = u_colors[int(a_status)];
}`

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform float u_size;
in vec3 v_color;
out vec4 fragColor;

void main() {
  float r = length(gl_PointCoord * 2.0 - 1.0);
  if (r > 1.0) discard;
  // The outer pixel of the radius is the white stroke.
  fragColor = r > 1.0 - 2.0 / u_size ? vec4(1.0) : vec4(v_color, 1.0);
}`

/**
 * Draws couriers as points straight from typed arrays. Positions are kept in
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
  let statuses = new Uint8Array()
  let dirty = true
  let uploaded = -1 // courier count the GPU buffers were sized for
  let gpu: ReturnType<typeof setUp> | undefined

  const write = (i: number) => {
    positions[i * 2] = mercatorX(view.lng(i))
    positions[i * 2 + 1] = mercatorY(view.lat(i))
    statuses[i] = view.status(i)
  }

  const update = (changed: Uint32Array | null) => {
    const count = view.count()
    if (statuses.length !== count) {
      positions = new Float32Array(count * 2)
      statuses = new Uint8Array(count)
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
      gl.useProgram(gpu.program)
      gl.bindVertexArray(gpu.vao)
      if (dirty) {
        // Reallocate only when the fleet size changes; otherwise overwrite in place.
        const resize = uploaded !== statuses.length
        const upload = (buffer: WebGLBuffer, data: ArrayBufferView) => {
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
          if (resize) gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW)
          else gl.bufferSubData(gl.ARRAY_BUFFER, 0, data)
        }
        upload(gpu.positionBuffer, positions)
        upload(gpu.statusBuffer, statuses)
        uploaded = statuses.length
        dirty = false
        onApplied()
      }
      // Maps Web Mercator 0..1 to clip space; enough for a mercator-only layer.
      gl.uniformMatrix4fv(
        gpu.uniforms.matrix,
        false,
        new Float32Array(defaultProjectionData.mainMatrix),
      )
      gl.uniform1f(gpu.uniforms.size, POINT_SIZE * window.devicePixelRatio)
      gl.uniform3fv(gpu.uniforms.colors, gpu.colors)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.drawArrays(gl.POINTS, 0, statuses.length)
      gl.bindVertexArray(null)
    },
    onRemove(_map, gl) {
      if (!gpu) return
      gl.deleteBuffer(gpu.positionBuffer)
      gl.deleteBuffer(gpu.statusBuffer)
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
  const positionBuffer = attribute(gl, program, 'a_position', 2, gl.FLOAT)
  const statusBuffer = attribute(gl, program, 'a_status', 1, gl.UNSIGNED_BYTE)
  gl.bindVertexArray(null)

  return {
    program,
    vao,
    positionBuffer,
    statusBuffer,
    uniforms: {
      matrix: gl.getUniformLocation(program, 'u_matrix'),
      size: gl.getUniformLocation(program, 'u_size'),
      colors: gl.getUniformLocation(program, 'u_colors'),
    },
    // Indexed by status value, like the shader's u_colors[3].
    colors: new Float32Array(
      [Status.Idle, Status.Delivering, Status.Returning].flatMap((status) =>
        rgb(STATUS_COLORS[status]),
      ),
    ),
  }
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
): WebGLBuffer {
  const buffer = gl.createBuffer()
  const location = gl.getAttribLocation(program, name)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.enableVertexAttribArray(location)
  gl.vertexAttribPointer(location, size, type, false, 0, 0)
  return buffer
}

/** Web Mercator in MapLibre's world units: the whole world is 0..1 on both axes. */
function mercatorX(lng: number): number {
  return (180 + lng) / 360
}

function mercatorY(lat: number): number {
  return (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360
}

function rgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}
