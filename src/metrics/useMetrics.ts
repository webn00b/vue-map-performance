import { onScopeDispose, reactive } from 'vue'
import { createTimeWindow } from './window'

const WINDOW_MS = 5000
const HISTORY_LENGTH = 60

export interface Metrics {
  /** Frames rendered during the last second. */
  fps: number
  /** Lowest one-second FPS within the window. */
  fpsLow: number
  longTasks: number
  longTaskMs: number
  /** `null` where `performance.memory` isn't available (anything but Chromium). */
  heapMb: number | null
  flushMs: number
  flushMaxMs: number
  history: { fps: number[]; longTaskMs: number[]; flushMs: number[] }
}

interface ChromePerformance extends Performance {
  memory?: { usedJSHeapSize: number }
}

/** Samples page performance once a second. Keep one instance per page. */
export function useMetrics() {
  const metrics = reactive<Metrics>(emptyMetrics())
  const frames = createTimeWindow(1000)
  const secondsOfFps = createTimeWindow(WINDOW_MS)
  const longTasks = createTimeWindow(WINDOW_MS)
  const flushes = createTimeWindow(WINDOW_MS)

  let frame = requestAnimationFrame(function count(time) {
    frames.add(time, 1)
    frame = requestAnimationFrame(count)
  })

  const observer =
    typeof PerformanceObserver !== 'undefined' &&
    PerformanceObserver.supportedEntryTypes?.includes('longtask')
      ? new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longTasks.add(entry.startTime + entry.duration, entry.duration)
          }
        })
      : undefined
  observer?.observe({ type: 'longtask' })

  const timer = setInterval(() => {
    const now = performance.now()
    const fps = frames.stats(now).count
    secondsOfFps.add(now, fps)

    const fpsWindow = secondsOfFps.stats(now)
    const tasks = longTasks.stats(now)
    const flush = flushes.stats(now)
    const memory = (performance as ChromePerformance).memory

    metrics.fps = fps
    metrics.fpsLow = fpsWindow.min
    metrics.longTasks = tasks.count
    metrics.longTaskMs = tasks.sum
    metrics.heapMb = memory ? memory.usedJSHeapSize / 1024 / 1024 : null
    metrics.flushMs = flush.average
    metrics.flushMaxMs = flush.max

    push(metrics.history.fps, fps)
    push(metrics.history.longTaskMs, tasks.sum)
    push(metrics.history.flushMs, flush.average)
  }, 1000)

  onScopeDispose(() => {
    cancelAnimationFrame(frame)
    clearInterval(timer)
    observer?.disconnect()
  })

  return {
    metrics,
    recordFlush(ms: number) {
      flushes.add(performance.now(), ms)
    },
    /** Starts over, e.g. after switching modes, so old numbers don't blur the comparison. */
    reset() {
      for (const window of [secondsOfFps, longTasks, flushes]) window.clear()
      Object.assign(metrics, emptyMetrics())
    },
  }
}

function emptyMetrics(): Metrics {
  return {
    fps: 0,
    fpsLow: 0,
    longTasks: 0,
    longTaskMs: 0,
    heapMb: null,
    flushMs: 0,
    flushMaxMs: 0,
    history: { fps: [], longTaskMs: [], flushMs: [] },
  }
}

function push(values: number[], value: number) {
  values.push(value)
  if (values.length > HISTORY_LENGTH) values.shift()
}
