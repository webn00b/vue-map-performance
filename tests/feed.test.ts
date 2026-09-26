import { describe, expect, test } from 'vitest'
import { MOSCOW } from '../src/simulation/city'
import { MAX_SPEED, METERS_PER_DEGREE } from '../src/simulation/fleet'
import {
  createFeed,
  REPORT_INTERVAL_MS,
  TICK_MS,
  TIME_SCALE,
  type FeedMessage,
} from '../src/simulation/feed'

const options = { count: 300, seed: 11, snapshotIntervalMs: 3000, bounds: MOSCOW }

function run(feed: ReturnType<typeof createFeed>, ms: number): FeedMessage[] {
  const out: FeedMessage[] = []
  for (let t = 0; t < ms; t += TICK_MS) {
    const message = feed.tick()
    if (message) out.push(message)
  }
  return out
}

describe('snapshot mode', () => {
  test('sends the whole fleet once per interval', () => {
    const feed = createFeed({ ...options, mode: 'snapshot' })
    const messages = run(feed, 9000)
    expect(messages).toHaveLength(3)
    for (const message of messages) {
      expect(message.type).toBe('snapshot')
      expect(message.positions).toHaveLength(options.count * 2)
    }
  })
})

describe('stream mode', () => {
  test('every courier reports exactly once per report interval', () => {
    const feed = createFeed({ ...options, mode: 'stream' })
    const reports = new Uint32Array(options.count)
    for (const message of run(feed, REPORT_INTERVAL_MS * 5)) {
      if (message.type === 'delta') message.indices.forEach((i) => reports[i]!++)
    }
    expect(new Set(reports)).toEqual(new Set([5]))
  })

  test('deltas applied on top of the initial snapshot match a full snapshot', () => {
    const stream = createFeed({ ...options, mode: 'stream' })
    const snapshot = createFeed({ ...options, mode: 'snapshot', snapshotIntervalMs: 2000 })

    const state = stream.initial().positions
    for (const message of run(stream, 2000)) {
      if (message.type !== 'delta') continue
      message.indices.forEach((courier, k) => {
        state[courier * 2] = message.positions[k * 2]!
        state[courier * 2 + 1] = message.positions[k * 2 + 1]!
      })
    }
    const [full] = run(snapshot, 2000)

    // Each courier reported within the last interval, so the stream can lag the
    // snapshot by at most one interval of movement at top speed. A degree of
    // longitude is shortest at the northern edge, which gives the widest bound.
    const maxLagMeters = MAX_SPEED * TIME_SCALE * (REPORT_INTERVAL_MS / 1000)
    const metersPerDegreeLng = METERS_PER_DEGREE * Math.cos((MOSCOW.north * Math.PI) / 180)
    const maxLagDegrees = maxLagMeters / metersPerDegreeLng
    state.forEach((value, i) => {
      expect(Math.abs(value - full!.positions[i]!)).toBeLessThan(maxLagDegrees)
    })
  })
})
