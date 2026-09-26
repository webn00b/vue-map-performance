import { expect, test } from 'vitest'
import { createTimeWindow } from '../src/metrics/window'

test('aggregates values inside the window', () => {
  const window = createTimeWindow(1000)
  window.add(100, 10)
  window.add(500, 30)
  window.add(900, 20)
  expect(window.stats(1000)).toEqual({ count: 3, sum: 60, min: 10, max: 30, average: 20 })
})

test('drops values older than the span', () => {
  const window = createTimeWindow(1000)
  window.add(0, 50)
  window.add(1500, 5)
  expect(window.stats(1600)).toEqual({ count: 1, sum: 5, min: 5, max: 5, average: 5 })
})

test('an empty window reports zeros', () => {
  expect(createTimeWindow(1000).stats(0)).toEqual({ count: 0, sum: 0, min: 0, max: 0, average: 0 })
})
