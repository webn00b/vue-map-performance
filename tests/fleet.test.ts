import { describe, expect, test } from 'vitest'
import { MOSCOW } from '../src/simulation/city'
import { createFleet, stepFleet } from '../src/simulation/fleet'

describe('fleet', () => {
  test('the same seed gives the same fleet', () => {
    const a = createFleet(100, 7, MOSCOW)
    const b = createFleet(100, 7, MOSCOW)
    stepFleet(a, 30)
    stepFleet(b, 30)
    expect(a.positions).toEqual(b.positions)
    expect(a.statuses).toEqual(b.statuses)
  })

  test('a different seed gives a different fleet', () => {
    expect(createFleet(100, 1, MOSCOW).positions).not.toEqual(createFleet(100, 2, MOSCOW).positions)
  })

  test('couriers stay inside the city', () => {
    const fleet = createFleet(500, 3, MOSCOW)
    for (let step = 0; step < 200; step++) stepFleet(fleet, 60)

    for (let i = 0; i < fleet.count; i++) {
      const lng = fleet.positions[i * 2]!
      const lat = fleet.positions[i * 2 + 1]!
      expect(lng).toBeGreaterThanOrEqual(MOSCOW.west - 1e-4)
      expect(lng).toBeLessThanOrEqual(MOSCOW.east + 1e-4)
      expect(lat).toBeGreaterThanOrEqual(MOSCOW.south - 1e-4)
      expect(lat).toBeLessThanOrEqual(MOSCOW.north + 1e-4)
    }
  })

  test('couriers move at a plausible speed', () => {
    const fleet = createFleet(50, 5, MOSCOW)
    const before = fleet.positions.slice()
    stepFleet(fleet, 1)

    for (let i = 0; i < fleet.count; i++) {
      const dLat = (fleet.positions[i * 2 + 1]! - before[i * 2 + 1]!) * 111_320
      const dLng =
        (fleet.positions[i * 2]! - before[i * 2]!) * 111_320 * Math.cos((55.75 * Math.PI) / 180)
      // Speeds are 6–16 m/s; allow for float32 rounding.
      expect(Math.hypot(dLat, dLng)).toBeLessThan(17)
    }
  })
})
