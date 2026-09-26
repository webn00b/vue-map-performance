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

  // With the regular tick, the couriers reporting in a tick repeat every
  // REPORT_INTERVAL_MS / TICK_MS ticks, so group them once up front instead
  // of checking the whole fleet on every tick.
  const groups = groupByTick(phases)

  let elapsed = 0
  let sinceSnapshot = 0

  const snapshot = (): FeedMessage => ({
    type: 'snapshot',
    positions: fleet.positions.slice(),
    statuses: fleet.statuses.slice(),
  })

  const reportedBetween = (from: number, to: number): Uint32Array => {
    if (to - from === TICK_MS && from % TICK_MS === 0) {
      return groups[(from / TICK_MS) % groups.length]!
    }
    const reported: number[] = []
    phases.forEach((phase, i) => {
      if (reportsBefore(to, phase) > reportsBefore(from, phase)) reported.push(i)
    })
    return Uint32Array.from(reported)
  }

  const delta = (from: number, to: number): FeedMessage | undefined => {
    const reported = reportedBetween(from, to)
    if (reported.length === 0) return undefined

    // Copied, because the buffer is transferred to the page.
    const indices = reported.slice()
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

/**
 * A courier with phase p reports whenever `p + k * REPORT_INTERVAL_MS` falls
 * into (from, to], so with fixed ticks it always reports in the tick that
 * covers (ceil(p / TICK_MS) - 1) modulo the ticks per interval.
 */
function groupByTick(phases: Float64Array): Uint32Array[] {
  const ticksPerInterval = REPORT_INTERVAL_MS / TICK_MS
  const members: number[][] = Array.from({ length: ticksPerInterval }, () => [])
  phases.forEach((phase, i) => {
    const tick = (Math.ceil(phase / TICK_MS) - 1 + ticksPerInterval) % ticksPerInterval
    members[tick]!.push(i)
  })
  return members.map((group) => Uint32Array.from(group))
}

function reportsBefore(time: number, phase: number): number {
  return Math.floor((time - phase) / REPORT_INTERVAL_MS)
}
