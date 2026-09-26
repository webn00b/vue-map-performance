import type { City } from './city'
import { createRandom } from './random'

export const Status = {
  Idle: 0,
  Delivering: 1,
  Returning: 2,
} as const
export type Status = (typeof Status)[keyof typeof Status]

export const METERS_PER_DEGREE = 111_320
export const MIN_SPEED = 6 // m/s
export const MAX_SPEED = 16

/**
 * Fleet state in flat typed arrays, so a whole update is one allocation-free
 * loop and can be sent to the main thread without copying object graphs.
 */
export interface Fleet {
  readonly count: number
  readonly city: City
  /** [lng0, lat0, lng1, lat1, ...] */
  readonly positions: Float32Array
  readonly targets: Float32Array
  /** Meters per second. */
  readonly speeds: Float32Array
  readonly statuses: Uint8Array
  readonly random: () => number
}

export function createFleet(count: number, seed: number, city: City): Fleet {
  const random = createRandom(seed)
  const fleet: Fleet = {
    count,
    city,
    positions: new Float32Array(count * 2),
    targets: new Float32Array(count * 2),
    speeds: new Float32Array(count),
    statuses: new Uint8Array(count),
    random,
  }

  for (let i = 0; i < count; i++) {
    setRandomPoint(fleet, fleet.positions, i)
    setRandomPoint(fleet, fleet.targets, i)
    fleet.speeds[i] = MIN_SPEED + random() * (MAX_SPEED - MIN_SPEED)
    fleet.statuses[i] = Math.floor(random() * 3) as Status
  }
  return fleet
}

/** Moves every courier towards its target; on arrival picks a new one. */
export function stepFleet(fleet: Fleet, seconds: number): void {
  const { positions, targets, speeds, statuses } = fleet

  for (let i = 0; i < fleet.count; i++) {
    const x = i * 2
    const y = x + 1
    const lat = positions[y]!
    const metersPerLng = METERS_PER_DEGREE * Math.cos((lat * Math.PI) / 180)

    const dx = (targets[x]! - positions[x]!) * metersPerLng
    const dy = (targets[y]! - lat) * METERS_PER_DEGREE
    const distance = Math.hypot(dx, dy)
    const step = speeds[i]! * seconds

    if (distance <= step) {
      positions[x] = targets[x]!
      positions[y] = targets[y]!
      setRandomPoint(fleet, targets, i)
      statuses[i] = nextStatus(statuses[i] as Status)
    } else {
      positions[x] = positions[x]! + ((dx / distance) * step) / metersPerLng
      positions[y] = lat + ((dy / distance) * step) / METERS_PER_DEGREE
    }
  }
}

function nextStatus(status: Status): Status {
  if (status === Status.Delivering) return Status.Returning
  if (status === Status.Returning) return Status.Idle
  return Status.Delivering
}

function setRandomPoint(fleet: Fleet, target: Float32Array, i: number): void {
  const { west, south, east, north } = fleet.city.bounds
  let lng: number
  let lat: number
  do {
    lng = west + fleet.random() * (east - west)
    lat = south + fleet.random() * (north - south)
  } while (!fleet.city.contains(lng, lat))
  target[i * 2] = lng
  target[i * 2 + 1] = lat
}
