import type { FeatureCollection, Point } from 'geojson'
import { COLORS } from '../colors'
import type { RenderMode } from '../settings'
import type { FleetView } from '../state/useCouriers'
import { createGpuRenderer } from './gpuRenderer'
import {
  badgeKey,
  courierKey,
  createSprite,
  drawCourier,
  parseCourierKey,
  pointerKey,
  SPRITE_SIZE,
  spriteUrl,
} from './icons'
import {
  Marker,
  type GeoJSONFeatureDiff,
  type GeoJSONSource,
  type Map as MapLibreMap,
  type MapSourceDataEvent,
} from './maplibre'

/** Draws the current state when created, then follows updates. */
export interface Renderer {
  /** `changed` lists the couriers to update, `null` means all of them. */
  update(changed: Uint32Array | null): void
  destroy(): void
}

/** `onApplied` is called whenever new courier data actually reaches the screen. */
export function createRenderer(
  mode: RenderMode,
  map: MapLibreMap,
  view: FleetView,
  onApplied: () => void,
): Renderer {
  if (mode === 'dom') return createDomRenderer(map, view, onApplied)
  if (mode === 'gpu') return createGpuRenderer(map, view, onApplied)
  return createWebglRenderer(map, view, { cluster: mode === 'cluster', onApplied })
}

/**
 * One HTML element per courier. Simple and flexible, but every marker is
 * repositioned by the browser on each map move, which is what falls apart
 * with thousands of them.
 */
function createDomRenderer(map: MapLibreMap, view: FleetView, onApplied: () => void): Renderer {
  interface DomCourier {
    marker: Marker
    badge: HTMLImageElement
    pointer: HTMLImageElement
    badgeKey?: string
    pointerKey?: string
    heading?: number
  }
  const couriers: DomCourier[] = []

  const resize = () => {
    while (couriers.length > view.count()) couriers.pop()!.marker.remove()
    while (couriers.length < view.count()) {
      const element = document.createElement('div')
      element.className = 'courier-marker'
      element.style.width = element.style.height = `${SPRITE_SIZE}px`
      const pointer = element.appendChild(document.createElement('img'))
      const badge = element.appendChild(document.createElement('img'))
      couriers.push({
        marker: new Marker({ element }).setLngLat([0, 0]).addTo(map),
        badge,
        pointer,
      })
    }
  }

  const place = (i: number) => {
    const courier = couriers[i]!
    courier.marker.setLngLat([view.lng(i), view.lat(i)])
    // Touch the DOM only for what actually changed.
    const status = view.status(i)
    const badge = badgeKey(view.vehicle(i), status)
    if (courier.badgeKey !== badge) {
      courier.badge.src = spriteUrl(badge)
      courier.badgeKey = badge
    }
    const pointer = pointerKey(status)
    if (courier.pointerKey !== pointer) {
      courier.pointer.src = spriteUrl(pointer)
      courier.pointerKey = pointer
    }
    const heading = view.heading(i)
    if (courier.heading !== heading) {
      courier.pointer.style.transform = `rotate(${heading}deg)`
      courier.heading = heading
    }
  }

  const update = (changed: Uint32Array | null) => {
    resize()
    if (changed) changed.forEach(place)
    else for (let i = 0; i < couriers.length; i++) place(i)
    onApplied()
  }
  update(null)

  return {
    update,
    destroy() {
      couriers.forEach(({ marker }) => marker.remove())
      couriers.length = 0
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
  { cluster, onApplied }: { cluster: boolean; onApplied: () => void },
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
        'circle-color': COLORS.accent,
        'circle-opacity': 0.85,
        'circle-radius': ['step', ['get', 'point_count'], 12, 50, 16, 200, 22, 1000, 30],
        'circle-stroke-width': 2,
        'circle-stroke-color': COLORS.surface,
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
        // Otherwise counts disappear wherever they collide with base map labels.
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': COLORS.surface },
    })
  }

  // Sprites are drawn the first time a tile asks for one.
  const onImageMissing = ({ id }: { id: string }) => {
    const courier = parseCourierKey(id)
    if (!courier) return
    const sprite = createSprite((context) => drawCourier(context, ...courier))
    const pixels = sprite.getContext('2d')!.getImageData(0, 0, sprite.width, sprite.height)
    map.addImage(id, pixels, { pixelRatio: sprite.width / SPRITE_SIZE })
  }
  map.on('styleimagemissing', onImageMissing)
  map.addLayer({
    id: 'couriers',
    type: 'symbol',
    source: SOURCE,
    filter: ['!', ['has', 'point_count']],
    layout: {
      'icon-image': ['get', 'icon'],
      // Overlap and placement checks would hide couriers and cost time on every update.
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  })

  const source = map.getSource<GeoJSONSource>(SOURCE)!
  // MapLibre fires this once its worker has taken in a data update.
  const onSourceData = (event: MapSourceDataEvent) => {
    if (event.sourceId === SOURCE && event.sourceDataType === 'content') onApplied()
  }
  map.on('sourcedata', onSourceData)
  // Last icon sent per courier, so diffs only carry it when it changed.
  // Clusters never use diffs, so they skip it.
  let sentIcons = cluster ? [] : iconsOf(view)
  // While MapLibre is still processing a full rebuild, newer ones would be
  // thrown away, so just remember that another one is due.
  let rebuilding = false
  let rebuildAgain = false

  const rebuild = () => {
    if (rebuilding) {
      rebuildAgain = true
      return
    }
    rebuilding = true
    if (!cluster) sentIcons = iconsOf(view)
    void source.setData(toFeatureCollection(view)).finally(() => {
      rebuilding = false
      if (rebuildAgain) {
        rebuildAgain = false
        rebuild()
      }
    })
  }

  return {
    update(changed) {
      // Diffs only pay off for a small share of the fleet, and clustering
      // has to re-run over all points anyway.
      if (!changed || cluster || rebuilding || changed.length >= view.count() / 2) {
        rebuild()
        return
      }
      void source.updateData({
        update: Array.from(changed, (i) => {
          const diff: GeoJSONFeatureDiff = {
            id: i,
            newGeometry: { type: 'Point', coordinates: [view.lng(i), view.lat(i)] },
          }
          const icon = iconOf(view, i)
          if (sentIcons[i] !== icon) {
            sentIcons[i] = icon
            diff.addOrUpdateProperties = [{ key: 'icon', value: icon }]
          }
          return diff
        }),
      })
    },
    destroy() {
      map.off('sourcedata', onSourceData)
      map.off('styleimagemissing', onImageMissing)
      for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource(SOURCE)) map.removeSource(SOURCE)
    },
  }
}

const iconOf = (view: FleetView, i: number) =>
  courierKey(view.vehicle(i), view.status(i), view.heading(i))

function iconsOf(view: FleetView): string[] {
  return Array.from({ length: view.count() }, (_, i) => iconOf(view, i))
}

function toFeatureCollection(view: FleetView): FeatureCollection<Point> {
  const features = new Array(view.count())
  for (let i = 0; i < features.length; i++) {
    features[i] = {
      type: 'Feature',
      id: i,
      geometry: { type: 'Point', coordinates: [view.lng(i), view.lat(i)] },
      properties: { icon: iconOf(view, i) },
    }
  }
  return { type: 'FeatureCollection', features }
}
