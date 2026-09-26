import type { FeedMode } from '../settings'
import type { Bounds } from './city'
import { createFleet, stepFleet } from './fleet'
import { createRandom } from './random'

export interface FeedOptions {
  count: number
  seed: number
  mode: FeedMode
  /** How often a full snapshot is sent in `snapshot` mode. */
  snapshotIntervalMs: number
  bounds: Bounds
}

// Plain ArrayBuffers (not shared), so they can be transferred to the main thread.
export type FeedMessage =
  | { type: 'snapshot'; positions: Float32Array<ArrayBuffer>; statuses: Uint8Array<ArrayBuffer> }
  | {
      type: 'delta'
      indices: Uint32Array<ArrayBuffer>
      positions: Float32Array<ArrayBuffer>
      statuses: Uint8Array<ArrayBuffer>
    }

export const TICK_MS = 100
/** Simulated time runs faster than real time, otherwise nothing visibly moves at city zoom. */
export const TIME_SCALE = 10
/** In `stream` mode every courier reports its position once per interval, at its own phase. */
export const REPORT_INTERVAL_MS = 1000

export function createFeed(options: FeedOptions) {
  const fleet = createFleet(options.count, options.seed, options.bounds)
  const phaseRandom = createRandom(options.seed + 1)
  const phases = Float64Array.from(
    { length: options.count },
    () => phaseRandom() * REPORT_INTERVAL_MS,
  )

  let elapsed = 0
  let sinceSnapshot = 0

  const snapshot = (): FeedMessage => ({
    type: 'snapshot',
    positions: fleet.positions.slice(),
    statuses: fleet.statuses.slice(),
  })

  const delta = (from: number, to: number): FeedMessage | undefined => {
    const reported: number[] = []
    for (let i = 0; i < fleet.count; i++) {
      const phase = phases[i]!
      if (reportsBefore(to, phase) > reportsBefore(from, phase)) reported.push(i)
    }
    if (reported.length === 0) return undefined

    const indices = Uint32Array.from(reported)
    const positions = new Float32Array(indices.length * 2)
    const statuses = new Uint8Array(indices.length)
    indices.forEach((courier, k) => {
      positions[k * 2] = fleet.positions[courier * 2]!
      positions[k * 2 + 1] = fleet.positions[courier * 2 + 1]!
      statuses[k] = fleet.statuses[courier]!
    })
    return { type: 'delta', indices, positions, statuses }
  }

  return {
    /** Full state to start from, sent once in both modes. */
    initial: snapshot,

    /** Advances the simulation and returns what should be sent for this tick, if anything. */
    tick(ms = TICK_MS): FeedMessage | undefined {
      stepFleet(fleet, (ms / 1000) * TIME_SCALE)
      const from = elapsed
      elapsed += ms

      if (options.mode === 'stream') return delta(from, elapsed)

      sinceSnapshot += ms
      if (sinceSnapshot < options.snapshotIntervalMs) return undefined
      sinceSnapshot = 0
      return snapshot()
    },
  }
}

function reportsBefore(time: number, phase: number): number {
  return Math.floor((time - phase) / REPORT_INTERVAL_MS)
}
