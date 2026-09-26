export const RENDER_MODES = ['dom', 'webgl', 'cluster', 'gpu'] as const
export const STATE_MODES = ['shallow', 'deep'] as const
export const FEED_MODES = ['stream', 'snapshot'] as const

export type RenderMode = (typeof RENDER_MODES)[number]
export type StateMode = (typeof STATE_MODES)[number]
export type FeedMode = (typeof FEED_MODES)[number]

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
  render: 'gpu',
  state: 'shallow',
  feed: 'stream',
  interval: 3,
  seed: 42,
}

export const COUNT_RANGE = { min: 100, max: 200_000 }
export const INTERVAL_RANGE = { min: 1, max: 30 }
const SEED_RANGE = { min: 0, max: 2 ** 31 - 1 }
/** Above this many DOM markers the tab stops responding for seconds at a time. */
export const DOM_MARKER_LIMIT = 10_000
export const DOM_MARKER_WARNING = 5_000
/** GeoJSON layers and the deep store fall far behind beyond this. */
export const HEAVY_MODE_LIMIT = 50_000

const formatter = new Intl.NumberFormat('en-US')
export const formatCount = (value: number) => formatter.format(value)

/** URL parameter for each setting and how to read it back. */
const PARAMS: {
  [K in keyof Settings]: { name: string; parse: (value: string) => Settings[K] | undefined }
} = {
  count: { name: 'n', parse: parseInteger },
  render: { name: 'render', parse: (value) => oneOf(value, RENDER_MODES) },
  state: { name: 'state', parse: (value) => oneOf(value, STATE_MODES) },
  feed: { name: 'feed', parse: (value) => oneOf(value, FEED_MODES) },
  interval: { name: 'interval', parse: parseInteger },
  seed: { name: 'seed', parse: parseInteger },
}

/** Reads settings from a query string. Anything missing or invalid falls back to the default. */
export function parseSettings(search: string): { settings: Settings; notice?: string } {
  const params = new URLSearchParams(search)
  const settings = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(PARAMS) as (keyof Settings)[]) {
    const raw = params.get(PARAMS[key].name)
    const value = raw === null ? undefined : PARAMS[key].parse(raw)
    if (value !== undefined) Object.assign(settings, { [key]: value })
  }
  return normalizeSettings(settings)
}

/** Query string with only the values that differ from the defaults. */
export function serializeSettings(settings: Settings): string {
  const params = new URLSearchParams()
  for (const key of Object.keys(PARAMS) as (keyof Settings)[]) {
    if (settings[key] !== DEFAULT_SETTINGS[key]) params.set(PARAMS[key].name, String(settings[key]))
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

/**
 * Brings settings into the supported ranges. Every change goes through here,
 * whether it comes from the URL or from the controls.
 */
export function normalizeSettings(input: Settings): { settings: Settings; notice?: string } {
  const settings: Settings = {
    ...input,
    count: clamp(input.count, COUNT_RANGE),
    interval: clamp(input.interval, INTERVAL_RANGE),
    seed: clamp(input.seed, SEED_RANGE),
  }
  const notices: string[] = []
  if (settings.render === 'dom' && settings.count > DOM_MARKER_LIMIT) {
    settings.render = 'gpu'
    notices.push(
      `DOM markers are capped at ${formatCount(DOM_MARKER_LIMIT)}, switched to the GPU layer.`,
    )
  }
  if (
    (settings.render === 'webgl' || settings.render === 'cluster') &&
    settings.count > HEAVY_MODE_LIMIT
  ) {
    settings.render = 'gpu'
    notices.push(
      `GeoJSON layers are capped at ${formatCount(HEAVY_MODE_LIMIT)}, switched to the GPU layer.`,
    )
  }
  if (settings.state === 'deep' && settings.count > HEAVY_MODE_LIMIT) {
    settings.state = 'shallow'
    notices.push(
      `A deep ref is capped at ${formatCount(HEAVY_MODE_LIMIT)}, switched to shallowRef.`,
    )
  }
  return notices.length ? { settings, notice: notices.join(' ') } : { settings }
}

function clamp(value: number, range: { min: number; max: number }) {
  if (!Number.isFinite(value)) return range.min
  return Math.min(range.max, Math.max(range.min, Math.round(value)))
}

function parseInteger(value: string) {
  return /^\d+$/.test(value) ? Number(value) : undefined
}

function oneOf<T extends string>(value: string, options: readonly T[]): T | undefined {
  return options.includes(value as T) ? (value as T) : undefined
}
