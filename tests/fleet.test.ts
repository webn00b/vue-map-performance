import { describe, expect, test } from 'vitest'
import { TORONTO } from '../src/simulation/city'
import {
  createFleet,
  MAX_SPEED,
  METERS_PER_DEGREE,
  SPEEDS,
  stepFleet,
  type Vehicle,
} from '../src/simulation/fleet'

describe('fleet', () => {
  test('the same seed gives the same fleet', () => {
    const a = createFleet(100, 7, TORONTO)
    const b = createFleet(100, 7, TORONTO)
    stepFleet(a, 30)
    stepFleet(b, 30)
    expect(a.positions).toEqual(b.positions)
    expect(a.statuses).toEqual(b.statuses)
  })

  test('a different seed gives a different fleet', () => {
    expect(createFleet(100, 1, TORONTO).positions).not.toEqual(
      createFleet(100, 2, TORONTO).positions,
    )
  })

  test('couriers stay inside the city', () => {
    const { west, south, east, north } = TORONTO.bounds
    const fleet = createFleet(500, 3, TORONTO)
    for (let step = 0; step < 200; step++) stepFleet(fleet, 60)

    for (let i = 0; i < fleet.count; i++) {
      const lng = fleet.positions[i * 2]!
      const lat = fleet.positions[i * 2 + 1]!
      expect(lng).toBeGreaterThanOrEqual(west - 1e-4)
      expect(lng).toBeLessThanOrEqual(east + 1e-4)
      expect(lat).toBeGreaterThanOrEqual(south - 1e-4)
      expect(lat).toBeLessThanOrEqual(north + 1e-4)
    }
  })

  test('couriers start and head to points on land, not in the lake', () => {
    const fleet = createFleet(2000, 9, TORONTO)
    for (let step = 0; step < 50; step++) stepFleet(fleet, 60)

    for (let i = 0; i < fleet.count; i++) {
      // Targets are always drawn from `contains`; positions reach them in straight lines.
      expect(TORONTO.contains(fleet.targets[i * 2]!, fleet.targets[i * 2 + 1]!)).toBe(true)
    }
    expect(TORONTO.contains(-79.38, 43.6)).toBe(false) // Lake Ontario, off downtown
    expect(TORONTO.contains(-79.38, 43.65)).toBe(true) // downtown
  })

  test('couriers move at a plausible speed', () => {
    const fleet = createFleet(50, 5, TORONTO)
    const before = fleet.positions.slice()
    stepFleet(fleet, 1)

    for (let i = 0; i < fleet.count; i++) {
      const metersPerLng = METERS_PER_DEGREE * Math.cos((TORONTO.center[1] * Math.PI) / 180)
      const dLat = (fleet.positions[i * 2 + 1]! - before[i * 2 + 1]!) * METERS_PER_DEGREE
      const dLng = (fleet.positions[i * 2]! - before[i * 2]!) * metersPerLng
      // Allow a metre for float32 rounding and latitude spread.
      expect(Math.hypot(dLat, dLng)).toBeLessThan(MAX_SPEED + 1)
    }
  })

  test('each vehicle type keeps to its own speed range', () => {
    const fleet = createFleet(300, 11, TORONTO)
    for (let i = 0; i < fleet.count; i++) {
      const [min, max] = SPEEDS[fleet.vehicles[i] as Vehicle]
      expect(fleet.speeds[i]).toBeGreaterThanOrEqual(min - 1e-4)
      expect(fleet.speeds[i]).toBeLessThanOrEqual(max + 1e-4)
    }
    expect(new Set(fleet.vehicles).size).toBe(3)
  })

  test('the heading points at the target', () => {
    const fleet = createFleet(200, 13, TORONTO)
    for (let step = 0; step < 30; step++) stepFleet(fleet, 60)
    const before = fleet.positions.slice()
    const headings = fleet.headings.slice()
    const statuses = fleet.statuses.slice()
    // Long enough that float32 rounding of the positions doesn't skew the bearing.
    stepFleet(fleet, 20)

    for (let i = 0; i < fleet.count; i++) {
      // A courier that arrived picked a new target and status mid-step.
      if (fleet.statuses[i] !== statuses[i]) continue
      const dLng = fleet.positions[i * 2]! - before[i * 2]!
      const dLat = fleet.positions[i * 2 + 1]! - before[i * 2 + 1]!
      const lat = (before[i * 2 + 1]! * Math.PI) / 180
      const bearing = (Math.atan2(dLng * Math.cos(lat), dLat) * 180) / Math.PI
      expect(fleet.headings[i]).toBe(headings[i])
      expect(Math.abs(((bearing - headings[i]! + 540) % 360) - 180)).toBeLessThan(1)
    }
  })
})
