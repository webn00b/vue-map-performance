import { nextTick, ref, shallowRef, triggerRef, watch, type WatchStopHandle } from 'vue'
import type { StateMode } from '../settings'
import { unpackHeading, type FeedMessage } from '../simulation/feed'
import type { Status, Vehicle } from '../simulation/fleet'

/** Read access that renderers and the list use, regardless of how the state is stored. */
export interface FleetView {
  count(): number
  lng(i: number): number
  lat(i: number): number
  status(i: number): Status
  vehicle(i: number): Vehicle
  /** Degrees clockwise from north. */
  heading(i: number): number
}

/** `changed` lists the couriers that moved, or is `null` when anything may have changed. */
export type ChangeListener = (changed: Uint32Array | null) => void

export interface CourierStore {
  view: FleetView
  /** Queues a feed message; queued messages are applied once per animation frame. */
  receive(message: FeedMessage): void
  /** Applies queued messages now and resolves after Vue has flushed the resulting updates. */
  flush(): Promise<void>
  onChange(listener: ChangeListener): () => void
  /** Drops queued messages and pending work, e.g. when the store is replaced. */
  dispose(): void
}

interface Backend {
  view: FleetView
  /** Applies a frame's worth of messages. */
  apply(messages: FeedMessage[]): void
  /** Called once Vue has flushed, to tell listeners what changed. */
  notify(): void
  onChange(listener: ChangeListener): () => void
}

/**
 * Two ways to hold the same data, to compare what Vue reactivity costs:
 *
 * - `deep`: an array of plain objects in `ref()`, the way it is usually written.
 *   Every object becomes a reactive proxy and a deep watcher walks all of them.
 * - `shallow`: typed arrays in `shallowRef()`, updated in place and announced
 *   with `triggerRef()`. Vue tracks one reference instead of every field.
 */
export function useCouriers(mode: StateMode, onFlushed?: (ms: number) => void): CourierStore {
  const backend = mode === 'deep' ? createDeepStore() : createShallowStore()
  let queue: FeedMessage[] = []
  let scheduled: (() => void) | undefined

  const flush = async () => {
    scheduled?.()
    scheduled = undefined
    if (queue.length === 0) return

    const started = performance.now()
    const messages = queue
    queue = []
    backend.apply(messages)
    await nextTick()
    backend.notify()
    // Covers applying the data, Vue's updates and the renderers' own work. What
    // MapLibre does after `setData`/`updateData` returns is left out in both modes.
    onFlushed?.(performance.now() - started)
  }

  // Background tabs don't run animation frames, so fall back to a timer there
  // instead of letting the queue grow until the tab is visible again.
  const schedule = () => {
    if (document.hidden) {
      const timer = setTimeout(() => void flush(), 1000)
      return () => clearTimeout(timer)
    }
    const frame = requestAnimationFrame(() => void flush())
    return () => cancelAnimationFrame(frame)
  }

  return {
    view: backend.view,
    onChange: backend.onChange,
    flush,
    receive(message) {
      // A snapshot replaces everything, so whatever is still queued is moot.
      if (message.type === 'snapshot') queue = [message]
      else queue.push(message)
      scheduled ??= schedule()
    },
    dispose() {
      scheduled?.()
      scheduled = undefined
      queue = []
    },
  }
}

interface Courier {
  // Not read by the demo, but this is what such objects usually carry.
  id: number
  lng: number
  lat: number
  status: Status
  vehicle: Vehicle
  heading: number
}

function createDeepStore(): Backend {
  const couriers = ref<Courier[]>([])

  return {
    view: {
      count: () => couriers.value.length,
      lng: (i) => couriers.value[i]!.lng,
      lat: (i) => couriers.value[i]!.lat,
      status: (i) => couriers.value[i]!.status,
      vehicle: (i) => couriers.value[i]!.vehicle,
      heading: (i) => couriers.value[i]!.heading,
    },
    apply(messages) {
      for (const message of messages) {
        if (message.type === 'snapshot') {
          couriers.value = Array.from(message.statuses, (status, i) => ({
            id: i,
            lng: message.positions[i * 2]!,
            lat: message.positions[i * 2 + 1]!,
            status: status as Status,
            vehicle: message.vehicles[i] as Vehicle,
            heading: unpackHeading(message.headings[i]!),
          }))
          continue
        }
        message.indices.forEach((id, k) => {
          const courier = couriers.value[id]!
          courier.lng = message.positions[k * 2]!
          courier.lat = message.positions[k * 2 + 1]!
          courier.status = message.statuses[k] as Status
          courier.heading = unpackHeading(message.headings[k]!)
        })
      }
    },
    // Listeners hang off a deep watcher, which is the cost being demonstrated.
    // It can't tell what changed, so they get `null`.
    notify() {},
    onChange(listener) {
      const stop: WatchStopHandle = watch(couriers, () => listener(null), { deep: true })
      return stop
    },
  }
}

function createShallowStore(): Backend {
  const state = shallowRef({
    positions: new Float32Array(),
    statuses: new Uint8Array(),
    vehicles: new Uint8Array(),
    headings: new Uint8Array(),
  })
  const listeners = new Set<ChangeListener>()
  // Deduplicates couriers that report more than once within a frame without allocating.
  let seen = new Uint8Array()
  let changed = new Uint32Array()
  let moved: Uint32Array | null | undefined

  return {
    view: {
      count: () => state.value.statuses.length,
      lng: (i) => state.value.positions[i * 2]!,
      lat: (i) => state.value.positions[i * 2 + 1]!,
      status: (i) => state.value.statuses[i] as Status,
      vehicle: (i) => state.value.vehicles[i] as Vehicle,
      heading: (i) => unpackHeading(state.value.headings[i]!),
    },
    apply(messages) {
      let last = -1
      messages.forEach((message, i) => {
        if (message.type === 'snapshot') last = i
      })
      if (last !== -1) {
        const snapshot = messages[last] as Extract<FeedMessage, { type: 'snapshot' }>
        const { positions, statuses, vehicles, headings } = snapshot
        state.value = { positions, statuses, vehicles, headings }
        seen = new Uint8Array(snapshot.statuses.length)
        changed = new Uint32Array(snapshot.statuses.length)
      }

      const { positions, statuses, headings } = state.value
      let length = 0
      for (const message of messages.slice(last + 1)) {
        if (message.type !== 'delta') continue
        message.indices.forEach((id, k) => {
          positions[id * 2] = message.positions[k * 2]!
          positions[id * 2 + 1] = message.positions[k * 2 + 1]!
          statuses[id] = message.statuses[k]!
          headings[id] = message.headings[k]!
          if (!seen[id]) {
            seen[id] = 1
            changed[length++] = id
          }
        })
      }

      moved = last === -1 ? changed.subarray(0, length) : null
      triggerRef(state)
    },
    notify() {
      if (moved === undefined) return
      // `moved` is a view into a reused buffer: listeners must not keep it.
      const current = moved
      listeners.forEach((listener) => listener(current))
      if (current) current.forEach((id) => (seen[id] = 0))
      moved = undefined
    },
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
