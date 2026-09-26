import { describe, expect, test } from 'vitest'
import {
  DEFAULT_SETTINGS,
  DOM_MARKER_LIMIT,
  enforceLimits,
  parseSettings,
  serializeSettings,
} from '../src/settings'

describe('parseSettings', () => {
  test('empty query gives defaults', () => {
    expect(parseSettings('')).toEqual(DEFAULT_SETTINGS)
  })

  test('reads every parameter', () => {
    expect(
      parseSettings('?n=10000&render=dom&state=deep&feed=snapshot&interval=30&seed=7'),
    ).toEqual({
      count: 10000,
      render: 'dom',
      state: 'deep',
      feed: 'snapshot',
      interval: 30,
      seed: 7,
    })
  })

  test('clamps numbers into range', () => {
    const settings = parseSettings('?n=999999&interval=0')
    expect(settings.count).toBe(50_000)
    expect(settings.interval).toBe(1)
  })

  test('ignores garbage instead of breaking the page', () => {
    expect(parseSettings('?n=lots&render=canvas&state=&feed=ws&seed=-1')).toEqual(DEFAULT_SETTINGS)
  })
})

describe('serializeSettings', () => {
  test('defaults give a clean URL', () => {
    expect(serializeSettings(DEFAULT_SETTINGS)).toBe('')
  })

  test('only changed values end up in the query and round-trip', () => {
    const settings = { ...DEFAULT_SETTINGS, count: 10000, render: 'dom' as const }
    const query = serializeSettings(settings)
    expect(query).toBe('?n=10000&render=dom')
    expect(parseSettings(query)).toEqual(settings)
  })
})

describe('enforceLimits', () => {
  test('keeps DOM markers under the limit', () => {
    const settings = { ...DEFAULT_SETTINGS, render: 'dom' as const, count: DOM_MARKER_LIMIT }
    expect(enforceLimits(settings)).toEqual({ settings })
  })

  test('switches to WebGL above the limit and explains why', () => {
    const result = enforceLimits({
      ...DEFAULT_SETTINGS,
      render: 'dom',
      count: DOM_MARKER_LIMIT + 1,
    })
    expect(result.settings.render).toBe('webgl')
    expect(result.notice).toMatch(/capped at 10,000/)
  })
})
