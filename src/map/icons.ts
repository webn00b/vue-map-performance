import bike from 'lucide-static/icons/bike.svg?raw'
import car from 'lucide-static/icons/car-front.svg?raw'
import scooter from 'lucide-static/icons/scooter.svg?raw'
import { COLORS, STATUS_COLORS } from '../colors'
import { Status, Vehicle } from '../simulation/fleet'

/** Sprite side in CSS pixels: the badge plus room for the heading pointer. */
export const SPRITE_SIZE = 34
const CENTER = SPRITE_SIZE / 2
const BADGE_RADIUS = 10
const GLYPH_SIZE = 13

export const STATUSES = [Status.Idle, Status.Delivering, Status.Returning] as const
export const VEHICLES = [Vehicle.Bike, Vehicle.Scooter, Vehicle.Car] as const

export const VEHICLE_NAMES: Record<Vehicle, string> = {
  [Vehicle.Bike]: 'bike',
  [Vehicle.Scooter]: 'scooter',
  [Vehicle.Car]: 'car',
}

const GLYPHS: Record<Vehicle, string> = {
  [Vehicle.Bike]: bike,
  [Vehicle.Scooter]: scooter,
  [Vehicle.Car]: car,
}

let glyphPaths: Record<Vehicle, Path2D[]> | undefined

/**
 * The upright part of a courier: a circle in the status color with a white
 * outline and the vehicle glyph. It never rotates, so the glyph stays readable.
 */
export function drawBadge(context: CanvasRenderingContext2D, vehicle: Vehicle, status: Status) {
  context.beginPath()
  context.arc(CENTER, CENTER, BADGE_RADIUS, 0, Math.PI * 2)
  context.fillStyle = STATUS_COLORS[status]
  context.fill()
  context.lineWidth = 1.5
  context.strokeStyle = COLORS.surface
  context.stroke()

  // Lucide icons are drawn on a 24×24 grid with a 2 px stroke.
  const scale = GLYPH_SIZE / 24
  context.save()
  context.translate(CENTER - GLYPH_SIZE / 2, CENTER - GLYPH_SIZE / 2)
  context.scale(scale, scale)
  context.lineWidth = 2.5
  context.lineCap = 'round'
  context.lineJoin = 'round'
  glyphPaths ??= {
    [Vehicle.Bike]: toPaths(GLYPHS[Vehicle.Bike]),
    [Vehicle.Scooter]: toPaths(GLYPHS[Vehicle.Scooter]),
    [Vehicle.Car]: toPaths(GLYPHS[Vehicle.Car]),
  }
  for (const path of glyphPaths[vehicle]) context.stroke(path)
  context.restore()
}

/** The heading pointer, drawn facing north; renderers rotate it by the courier's heading. */
export function drawPointer(context: CanvasRenderingContext2D, status: Status) {
  context.beginPath()
  // The base tucks under the badge, so only the tip shows.
  const base = CENTER - BADGE_RADIUS + 3
  context.moveTo(CENTER, 1.5)
  context.lineTo(CENTER + 5.5, base)
  context.lineTo(CENTER - 5.5, base)
  context.closePath()
  context.fillStyle = STATUS_COLORS[status]
  context.fill()
  context.lineWidth = 1.5
  context.lineJoin = 'round'
  context.strokeStyle = COLORS.surface
  context.stroke()
}

/** Badge and pointer in one image, with the pointer turned to one of `HEADING_STEPS` directions. */
export function drawCourier(
  context: CanvasRenderingContext2D,
  vehicle: Vehicle,
  status: Status,
  step: number,
) {
  context.save()
  context.translate(CENTER, CENTER)
  context.rotate((step / HEADING_STEPS) * Math.PI * 2)
  context.translate(-CENTER, -CENTER)
  drawPointer(context, status)
  context.restore()
  drawBadge(context, vehicle, status)
}

/** Draws one sprite into a canvas at the given pixel ratio. */
export function createSprite(
  draw: (context: CanvasRenderingContext2D) => void,
  ratio = window.devicePixelRatio,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = Math.round(SPRITE_SIZE * ratio)
  const context = canvas.getContext('2d')!
  context.scale(ratio, ratio)
  draw(context)
  return canvas
}

/** Parses the few SVG elements Lucide icons use into canvas paths. */
function toPaths(svg: string): Path2D[] {
  const paths: Path2D[] = []
  for (const [, tag, attributes] of svg.matchAll(/<(path|circle|rect)\b([^>]*)\/>/g)) {
    const a = Object.fromEntries(
      [...attributes!.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]),
    ) as Record<string, string>
    const path = new Path2D()
    if (tag === 'path') {
      path.addPath(new Path2D(a.d))
    } else if (tag === 'circle') {
      path.arc(Number(a.cx), Number(a.cy), Number(a.r), 0, Math.PI * 2)
    } else {
      path.roundRect(
        Number(a.x ?? 0),
        Number(a.y ?? 0),
        Number(a.width),
        Number(a.height),
        Number(a.rx ?? 0),
      )
    }
    paths.push(path)
  }
  return paths
}

export const badgeKey = (vehicle: Vehicle, status: Status) => `badge-${vehicle}-${status}`
export const pointerKey = (status: Status) => `pointer-${status}`

/**
 * Directions the GeoJSON layer pre-renders. Rotating icons with `icon-rotate`
 * in a second symbol layer costs MapLibre far more at tens of thousands of points.
 */
export const HEADING_STEPS = 16

export const courierKey = (vehicle: Vehicle, status: Status, heading: number) =>
  `courier-${vehicle}-${status}-${Math.round((heading / 360) * HEADING_STEPS) % HEADING_STEPS}`

/** Reads back what `courierKey` encoded, or `undefined` for any other image id. */
export function parseCourierKey(key: string): [Vehicle, Status, number] | undefined {
  const match = /^courier-(\d)-(\d)-(\d+)$/.exec(key)
  if (!match) return undefined
  return [Number(match[1]) as Vehicle, Number(match[2]) as Status, Number(match[3])]
}

let sprites: Map<string, HTMLCanvasElement> | undefined

/** Every sprite, drawn once at the screen's pixel ratio and keyed like the MapLibre images. */
export function getSprites(): Map<string, HTMLCanvasElement> {
  if (!sprites) {
    sprites = new Map()
    for (const status of STATUSES) {
      sprites.set(
        pointerKey(status),
        createSprite((c) => drawPointer(c, status)),
      )
      for (const vehicle of VEHICLES) {
        sprites.set(
          badgeKey(vehicle, status),
          createSprite((c) => drawBadge(c, vehicle, status)),
        )
      }
    }
  }
  return sprites
}

const urls = new Map<string, string>()

/** Data URL of a sprite, for `<img>` elements. */
export function spriteUrl(key: string): string {
  let url = urls.get(key)
  if (!url) {
    url = getSprites().get(key)!.toDataURL()
    urls.set(key, url)
  }
  return url
}
