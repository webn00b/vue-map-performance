import { nextTick, ref, shallowRef, triggerRef, watch, type WatchStopHandle } from 'vue'
import type { StateMode } from '../settings'
import type { FeedMessage } from '../simulation/feed'
import type { Status } from '../simulation/fleet'

export interface Courier {
  id: number
  lng: number
  lat: number
  status: Status
}

/** Read access that renderers and the list use, regardless of how the state is stored. */
export interface FleetView {
  count(): number
  lng(i: number): number
  lat(i: number): number
  status(i: number): Status
}

/** `changed` lists the couriers that moved, or is `null` when anything may have changed. */
export type ChangeListener = (changed: Uint32Array | null) => void

export interface CourierStore {
  view: FleetView
  /** Queues a feed message; queued messages are applied once per animation frame. */
  receive(message: FeedMessage): void
  /** Applies queued messages now and resolves after Vue has flushed the resulting updates. */
  flush(): Promise<void>
  onChange(listener: ChangeListener): WatchStopHandle
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
  const store = mode === 'deep' ? createDeepStore() : createShallowStore()
  let queue: FeedMessage[] = []
  let frame: number | undefined

  const flush = async () => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
    if (queue.length === 0) return

    const started = performance.now()
    const messages = queue
    queue = []
    messages.forEach(store.apply)
    await nextTick()
    store.settle()
    onFlushed?.(performance.now() - started)
  }

  return {
    view: store.view,
    onChange: store.onChange,
    flush,
    receive(message) {
      queue.push(message)
      frame ??= requestAnimationFrame(() => void flush())
    },
  }
}

interface Backend {
  view: FleetView
  apply(message: FeedMessage): void
  /** Called after all listeners have seen the changes of a flush. */
  settle(): void
  onChange(listener: ChangeListener): WatchStopHandle
}

function createDeepStore(): Backend {
  const couriers = ref<Courier[]>([])

  return {
    view: {
      count: () => couriers.value.length,
      lng: (i) => couriers.value[i]!.lng,
      lat: (i) => couriers.value[i]!.lat,
      status: (i) => couriers.value[i]!.status,
    },
    apply(message) {
      if (message.type === 'snapshot') {
        couriers.value = Array.from(message.statuses, (status, i) => ({
          id: i,
          lng: message.positions[i * 2]!,
          lat: message.positions[i * 2 + 1]!,
          status: status as Status,
        }))
        return
      }
      message.indices.forEach((id, k) => {
        const courier = couriers.value[id]!
        courier.lng = message.positions[k * 2]!
        courier.lat = message.positions[k * 2 + 1]!
        courier.status = message.statuses[k] as Status
      })
    },
    settle() {},
    // A deep watcher doesn't know what changed, so listeners get `null`.
    onChange: (listener) => watch(couriers, () => listener(null), { deep: true }),
  }
}

interface ShallowState {
  positions: Float32Array
  statuses: Uint8Array
  /** Couriers changed since listeners last ran; `null` means everyone. */
  changed: Uint32Array | null
}

function createShallowStore(): Backend {
  const state = shallowRef<ShallowState>({
    positions: new Float32Array(),
    statuses: new Uint8Array(),
    changed: null,
  })
  // True once a flush has settled, so the next delta starts a fresh list of changes.
  let settled = true

  return {
    view: {
      count: () => state.value.statuses.length,
      lng: (i) => state.value.positions[i * 2]!,
      lat: (i) => state.value.positions[i * 2 + 1]!,
      status: (i) => state.value.statuses[i] as Status,
    },
    apply(message) {
      if (message.type === 'snapshot') {
        state.value = { positions: message.positions, statuses: message.statuses, changed: null }
        settled = false
        return
      }
      const { positions, statuses } = state.value
      message.indices.forEach((id, k) => {
        positions[id * 2] = message.positions[k * 2]!
        positions[id * 2 + 1] = message.positions[k * 2 + 1]!
        statuses[id] = message.statuses[k]!
      })
      // Several messages can land in one frame. Merge deltas; after a snapshot
      // everything has changed anyway, so keep `null`.
      if (settled) {
        state.value.changed = message.indices
        settled = false
      } else if (state.value.changed) {
        state.value.changed = mergeIndices(state.value.changed, message.indices)
      }
      triggerRef(state)
    },
    settle() {
      state.value.changed = null
      settled = true
    },
    onChange: (listener) => watch(state, (value) => listener(value.changed)),
  }
}

function mergeIndices(a: Uint32Array, b: Uint32Array): Uint32Array {
  return Uint32Array.from(new Set([...a, ...b]))
}
