import type { FeedMode } from './simulation/feed'

export type RenderMode = 'dom' | 'webgl' | 'cluster'
export type StateMode = 'deep' | 'shallow'

export interface Settings {
  count: number
  render: RenderMode
  state: StateMode
  feed: FeedMode
  /** Snapshot interval in seconds, used in `snapshot` feed mode. */
  interval: number
  seed: number
}

export const DEFAULT_SETTINGS: Settings = {
  count: 2000,
  render: 'webgl',
  state: 'shallow',
  feed: 'stream',
  interval: 3,
  seed: 42,
}

export const COUNT_RANGE = { min: 100, max: 50_000 }
export const INTERVAL_RANGE = { min: 1, max: 30 }
/** Above this many DOM markers the tab stops responding for seconds at a time. */
export const DOM_MARKER_LIMIT = 10_000
export const DOM_MARKER_WARNING = 5_000

const RENDER_MODES: readonly RenderMode[] = ['dom', 'webgl', 'cluster']
const STATE_MODES: readonly StateMode[] = ['deep', 'shallow']
const FEED_MODES: readonly FeedMode[] = ['snapshot', 'stream']

/** Reads settings from a query string. Anything missing or invalid falls back to the default. */
export function parseSettings(search: string): Settings {
  const params = new URLSearchParams(search)
  return {
    count: intParam(params.get('n'), COUNT_RANGE, DEFAULT_SETTINGS.count),
    render: oneOf(params.get('render'), RENDER_MODES, DEFAULT_SETTINGS.render),
    state: oneOf(params.get('state'), STATE_MODES, DEFAULT_SETTINGS.state),
    feed: oneOf(params.get('feed'), FEED_MODES, DEFAULT_SETTINGS.feed),
    interval: intParam(params.get('interval'), INTERVAL_RANGE, DEFAULT_SETTINGS.interval),
    seed: intParam(params.get('seed'), { min: 0, max: 2 ** 31 - 1 }, DEFAULT_SETTINGS.seed),
  }
}

/** Query string with only the values that differ from the defaults. */
export function serializeSettings(settings: Settings): string {
  const params = new URLSearchParams()
  const entries: [string, keyof Settings][] = [
    ['n', 'count'],
    ['render', 'render'],
    ['state', 'state'],
    ['feed', 'feed'],
    ['interval', 'interval'],
    ['seed', 'seed'],
  ]
  for (const [param, key] of entries) {
    if (settings[key] !== DEFAULT_SETTINGS[key]) params.set(param, String(settings[key]))
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

/** Falls back to WebGL when there would be too many DOM markers. */
export function enforceLimits(settings: Settings): { settings: Settings; notice?: string } {
  if (settings.render === 'dom' && settings.count > DOM_MARKER_LIMIT) {
    return {
      settings: { ...settings, render: 'webgl' },
      notice: `DOM markers are capped at ${DOM_MARKER_LIMIT.toLocaleString('en-US')}, switched to WebGL.`,
    }
  }
  return { settings }
}

function intParam(value: string | null, range: { min: number; max: number }, fallback: number) {
  if (value === null || !/^\d+$/.test(value)) return fallback
  return Math.min(range.max, Math.max(range.min, Number(value)))
}

function oneOf<T extends string>(value: string | null, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback
}
