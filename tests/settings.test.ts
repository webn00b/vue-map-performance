import { describe, expect, test } from 'vitest'
import {
  DEFAULT_SETTINGS,
  DOM_MARKER_LIMIT,
  normalizeSettings,
  parseSettings,
  serializeSettings,
  type Settings,
} from '../src/settings'

describe('parseSettings', () => {
  test('empty query gives defaults', () => {
    expect(parseSettings('')).toEqual({ settings: DEFAULT_SETTINGS })
  })

  test('reads every parameter', () => {
    const { settings } = parseSettings(
      '?n=10000&render=dom&state=deep&feed=snapshot&interval=30&seed=7',
    )
    expect(settings).toEqual({
      count: 10000,
      render: 'dom',
      state: 'deep',
      feed: 'snapshot',
      interval: 30,
      seed: 7,
    })
  })

  test('clamps numbers into range', () => {
    const { settings } = parseSettings('?n=999999&interval=0')
    expect(settings.count).toBe(200_000)
    expect(settings.interval).toBe(1)
  })

  test('ignores garbage instead of breaking the page', () => {
    expect(parseSettings('?n=lots&render=canvas&state=&feed=ws&seed=-1')).toEqual({
      settings: DEFAULT_SETTINGS,
    })
  })

  test('applies the DOM marker cap to links too', () => {
    const { settings, notice } = parseSettings('?render=dom&n=20000')
    expect(settings.render).toBe('gpu')
    expect(notice).toMatch(/capped at 10,000/)
  })
})

describe('serializeSettings', () => {
  test('defaults give a clean URL', () => {
    expect(serializeSettings(DEFAULT_SETTINGS)).toBe('')
  })

  test('every setting round-trips through the URL', () => {
    const settings: Settings = {
      count: 5000,
      render: 'cluster',
      state: 'deep',
      feed: 'snapshot',
      interval: 7,
      seed: 99,
    }
    expect(parseSettings(serializeSettings(settings)).settings).toEqual(settings)
  })

  test('only changed values end up in the query', () => {
    expect(serializeSettings({ ...DEFAULT_SETTINGS, count: 10000, render: 'dom' })).toBe(
      '?n=10000&render=dom',
    )
  })
})

describe('normalizeSettings', () => {
  test('keeps DOM markers under the limit', () => {
    const settings = { ...DEFAULT_SETTINGS, render: 'dom' as const, count: DOM_MARKER_LIMIT }
    expect(normalizeSettings(settings)).toEqual({ settings })
  })

  test('switches DOM markers to the GPU layer above the limit and explains why', () => {
    const result = normalizeSettings({
      ...DEFAULT_SETTINGS,
      render: 'dom',
      count: DOM_MARKER_LIMIT + 1,
    })
    expect(result.settings.render).toBe('gpu')
    expect(result.notice).toMatch(/capped at 10,000/)
  })

  test.each(['webgl', 'cluster'] as const)('moves %s to the GPU layer above 50k', (render) => {
    const result = normalizeSettings({ ...DEFAULT_SETTINGS, render, count: 100_000 })
    expect(result.settings.render).toBe('gpu')
    expect(result.notice).toMatch(/GeoJSON layers are capped at 50,000/)
  })

  test('moves a deep ref to shallowRef above 50k', () => {
    const result = normalizeSettings({ ...DEFAULT_SETTINGS, state: 'deep', count: 200_000 })
    expect(result.settings.state).toBe('shallow')
    expect(result.notice).toMatch(/deep ref is capped at 50,000/)
  })

  test('leaves the GPU layer alone at 200k', () => {
    const settings = { ...DEFAULT_SETTINGS, render: 'gpu' as const, count: 200_000 }
    expect(normalizeSettings(settings)).toEqual({ settings })
  })

  test('clamps values coming from the controls', () => {
    const { settings } = normalizeSettings({ ...DEFAULT_SETTINGS, interval: 99, count: 3.7 })
    expect(settings.interval).toBe(30)
    expect(settings.count).toBe(100)
  })
})
