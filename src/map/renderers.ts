import type { FeatureCollection, Point } from 'geojson'
import type { RenderMode } from '../settings'
import { Status } from '../simulation/fleet'
import type { FleetView } from '../state/useCouriers'
import { Marker, type GeoJSONSource, type Map as MapLibreMap } from './maplibre'

export interface Renderer {
  /** `changed` lists the couriers to update, `null` means all of them. */
  update(changed: Uint32Array | null): void
  destroy(): void
}

export const STATUS_COLORS: Record<Status, string> = {
  [Status.Idle]: '#8c959f',
  [Status.Delivering]: '#0969da',
  [Status.Returning]: '#1a7f37',
}

export function createRenderer(mode: RenderMode, map: MapLibreMap, view: FleetView): Renderer {
  if (mode === 'dom') return createDomRenderer(map, view)
  return createWebglRenderer(map, view, { cluster: mode === 'cluster' })
}

/**
 * One HTML element per courier. Simple and flexible, but every marker is
 * repositioned by the browser on each map move, which is what falls apart
 * with thousands of them.
 */
function createDomRenderer(map: MapLibreMap, view: FleetView): Renderer {
  const markers: Marker[] = []
  const statuses: number[] = []

  const resize = () => {
    while (markers.length > view.count()) markers.pop()!.remove()
    while (markers.length < view.count()) {
      const element = document.createElement('div')
      element.className = 'courier-marker'
      markers.push(new Marker({ element }).setLngLat([0, 0]).addTo(map))
      statuses.push(-1)
    }
  }

  const place = (i: number) => {
    const marker = markers[i]!
    marker.setLngLat([view.lng(i), view.lat(i)])
    const status = view.status(i)
    if (statuses[i] !== status) {
      marker.getElement().style.background = STATUS_COLORS[status]
      statuses[i] = status
    }
  }

  return {
    update(changed) {
      resize()
      if (changed) changed.forEach(place)
      else for (let i = 0; i < markers.length; i++) place(i)
    },
    destroy() {
      markers.forEach((marker) => marker.remove())
      markers.length = 0
    },
  }
}

const SOURCE = 'couriers'
const LAYERS = ['couriers', 'clusters', 'cluster-count'] as const

/**
 * All couriers in one GeoJSON source drawn by WebGL. Small updates go through
 * `updateData` with only the couriers that moved; `setData` rebuilds everything.
 */
function createWebglRenderer(
  map: MapLibreMap,
  view: FleetView,
  { cluster }: { cluster: boolean },
): Renderer {
  map.addSource(SOURCE, {
    type: 'geojson',
    data: toFeatureCollection(view),
    cluster,
    clusterRadius: 50,
    clusterMaxZoom: 14,
  })

  if (cluster) {
    map.addLayer({
      id: 'clusters',
      type: 'circle',
      source: SOURCE,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#0969da',
        'circle-opacity': 0.85,
        'circle-radius': ['step', ['get', 'point_count'], 12, 50, 16, 200, 22, 1000, 30],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#fff',
      },
    })
    map.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: SOURCE,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 12,
      },
      paint: { 'text-color': '#fff' },
    })
  }

  map.addLayer({
    id: 'couriers',
    type: 'circle',
    source: SOURCE,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-radius': 4,
      'circle-color': [
        'match',
        ['get', 'status'],
        Status.Delivering,
        STATUS_COLORS[Status.Delivering],
        Status.Returning,
        STATUS_COLORS[Status.Returning],
        STATUS_COLORS[Status.Idle],
      ],
      'circle-stroke-width': 1,
      'circle-stroke-color': '#fff',
    },
  })

  const source = () => map.getSource<GeoJSONSource>(SOURCE)!

  return {
    update(changed) {
      // Diffs only pay off for a small share of the fleet, and clustering
      // has to re-run over all points anyway.
      if (changed && !cluster && changed.length < view.count() / 2) {
        void source().updateData({
          update: Array.from(changed, (i) => ({
            id: i,
            newGeometry: { type: 'Point', coordinates: [view.lng(i), view.lat(i)] },
            addOrUpdateProperties: [{ key: 'status', value: view.status(i) }],
          })),
        })
      } else {
        void source().setData(toFeatureCollection(view))
      }
    },
    destroy() {
      for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource(SOURCE)) map.removeSource(SOURCE)
    },
  }
}

function toFeatureCollection(view: FleetView): FeatureCollection<Point> {
  const features = new Array(view.count())
  for (let i = 0; i < features.length; i++) {
    features[i] = {
      type: 'Feature',
      id: i,
      geometry: { type: 'Point', coordinates: [view.lng(i), view.lat(i)] },
      properties: { status: view.status(i) },
    }
  }
  return { type: 'FeatureCollection', features }
}
