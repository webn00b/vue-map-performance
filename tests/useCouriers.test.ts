import { describe, expect, test, vi } from 'vitest'
import type { StateMode } from '../src/settings'
import type { FeedMessage } from '../src/simulation/feed'
import { useCouriers, type FleetView } from '../src/state/useCouriers'

const snapshot = (): FeedMessage => ({
  type: 'snapshot',
  positions: Float32Array.from([37.1, 55.1, 37.2, 55.2, 37.3, 55.3]),
  statuses: Uint8Array.from([0, 1, 2]),
  vehicles: Uint8Array.from([2, 1, 0]),
  headings: Uint8Array.from([0, 64, 128]),
})

const delta = (index: number, lng: number): FeedMessage => ({
  type: 'delta',
  indices: Uint32Array.from([index]),
  positions: Float32Array.from([lng, 56]),
  statuses: Uint8Array.from([1]),
  headings: Uint8Array.from([192]),
})

const read = (view: FleetView) =>
  Array.from({ length: view.count() }, (_, i) => [
    view.lng(i),
    view.lat(i),
    view.status(i),
    view.vehicle(i),
    view.heading(i),
  ])

describe.each<StateMode>(['deep', 'shallow'])('%s store', (mode) => {
  test('applies a snapshot and then deltas', async () => {
    const store = useCouriers(mode)
    store.receive(snapshot())
    await store.flush()
    store.receive(delta(1, 38))
    await store.flush()

    expect(read(store.view)).toEqual([
      [expect.closeTo(37.1), expect.closeTo(55.1), 0, 2, 0],
      [38, 56, 1, 1, 270],
      [expect.closeTo(37.3), expect.closeTo(55.3), 2, 0, 180],
    ])
  })

  test('notifies listeners once per flush', async () => {
    const store = useCouriers(mode)
    const listener = vi.fn()
    store.onChange(listener)

    store.receive(snapshot())
    store.receive(delta(0, 38))
    await store.flush()

    expect(listener).toHaveBeenCalledTimes(1)
  })

  test('reports how long a flush took', async () => {
    const onFlushed = vi.fn()
    const store = useCouriers(mode, onFlushed)
    store.receive(snapshot())
    await store.flush()
    expect(onFlushed).toHaveBeenCalledWith(expect.any(Number))
  })
})

describe.each<StateMode>(['deep', 'shallow'])('%s store queue', (mode) => {
  test('a new snapshot drops deltas that are still queued', async () => {
    const store = useCouriers(mode)
    store.receive(snapshot())
    await store.flush()

    store.receive(delta(0, 99))
    store.receive(snapshot())
    await store.flush()

    expect(store.view.lng(0)).toBeCloseTo(37.1)
  })

  test('dispose drops pending work', async () => {
    const onFlushed = vi.fn()
    const store = useCouriers(mode, onFlushed)
    store.receive(snapshot())
    store.dispose()
    await store.flush()

    expect(store.view.count()).toBe(0)
    expect(onFlushed).not.toHaveBeenCalled()
  })
})

describe('shallow store change tracking', () => {
  test('passes the couriers that moved', async () => {
    const store = useCouriers('shallow')
    const listener = vi.fn()
    store.receive(snapshot())
    await store.flush()
    store.onChange(listener)

    store.receive(delta(0, 38))
    store.receive(delta(2, 39))
    await store.flush()

    expect([...listener.mock.calls[0]![0]]).toEqual([0, 2])
  })

  test('a courier reported twice in a frame is listed once', async () => {
    const store = useCouriers('shallow')
    const listener = vi.fn()
    store.receive(snapshot())
    await store.flush()
    store.onChange(listener)

    store.receive(delta(1, 38))
    store.receive(delta(1, 39))
    await store.flush()

    expect([...listener.mock.calls[0]![0]]).toEqual([1])
    expect(store.view.lng(1)).toBe(39)
  })

  test('every listener sees the same changes', async () => {
    const store = useCouriers('shallow')
    const map = vi.fn()
    const list = vi.fn()
    store.receive(snapshot())
    await store.flush()
    store.onChange(map)
    store.onChange(list)

    store.receive(delta(1, 38))
    await store.flush()

    expect([...map.mock.calls[0]![0]]).toEqual([1])
    expect([...list.mock.calls[0]![0]]).toEqual([1])
  })

  test('a snapshot in the same frame means everything changed', async () => {
    const store = useCouriers('shallow')
    const listener = vi.fn()
    store.receive(snapshot())
    await store.flush()
    store.onChange(listener)

    store.receive(snapshot())
    store.receive(delta(0, 38))
    await store.flush()

    expect(listener).toHaveBeenCalledWith(null)
  })
})
