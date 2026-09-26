import type { FeatureCollection, Point } from 'geojson'
import { COLORS, STATUS_COLORS } from '../colors'
import type { MarkerStyle, RenderMode } from '../settings'
import { Status } from '../simulation/fleet'
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
  type FilterSpecification,
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

export interface RendererOptions {
  markers: MarkerStyle
  /** Called whenever new courier data actually reaches the screen. */
  onApplied: () => void
}

export function createRenderer(
  mode: RenderMode,
  map: MapLibreMap,
  view: FleetView,
  options: RendererOptions,
): Renderer {
  if (mode === 'dom') return createDomRenderer(map, view, options)
  if (mode === 'gpu') return createGpuRenderer(map, view, options)
  return createWebglRenderer(map, view, { ...options, cluster: mode === 'cluster' })
}

/**
 * One HTML element per courier. Simple and flexible, but every marker is
 * repositioned by the browser on each map move, which is what falls apart
 * with thousands of them.
 */
function createDomRenderer(
  map: MapLibreMap,
  view: FleetView,
  { markers, onApplied }: RendererOptions,
): Renderer {
  const couriers: { marker: Marker; paint: (i: number) => void }[] = []
  const createElement = markers === 'icons' ? iconElement : dotElement

  const resize = () => {
    while (couriers.length > view.count()) couriers.pop()!.marker.remove()
    while (couriers.length < view.count()) {
      const { element, paint } = createElement(view)
      couriers.push({ marker: new Marker({ element }).setLngLat([0, 0]).addTo(map), paint })
    }
  }

  const place = (i: number) => {
    const courier = couriers[i]!
    courier.marker.setLngLat([view.lng(i), view.lat(i)])
    courier.paint(i)
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

/**
 * A marker element and a function that brings it up to date for a courier.
 * Both touch the DOM only for what actually changed.
 */
interface DomMarker {
  element: HTMLElement
  paint: (i: number) => void
}

function iconElement(view: FleetView): DomMarker {
  const element = document.createElement('div')
  element.className = 'courier-marker'
  element.style.width = element.style.height = `${SPRITE_SIZE}px`
  const pointer = element.appendChild(document.createElement('img'))
  const badge = element.appendChild(document.createElement('img'))
  let shownBadge: string | undefined
  let shownPointer: string | undefined
  let shownHeading: number | undefined

  return {
    element,
    paint(i) {
      const status = view.status(i)
      const badgeImage = badgeKey(view.vehicle(i), status)
      if (shownBadge !== badgeImage) {
        badge.src = spriteUrl(badgeImage)
        shownBadge = badgeImage
      }
      const pointerImage = pointerKey(status)
      if (shownPointer !== pointerImage) {
        pointer.src = spriteUrl(pointerImage)
        shownPointer = pointerImage
      }
      const heading = view.heading(i)
      if (shownHeading !== heading) {
        pointer.style.transform = `rotate(${heading}deg)`
        shownHeading = heading
      }
    },
  }
}

function dotElement(view: FleetView): DomMarker {
  const element = document.createElement('div')
  element.className = 'courier-dot'
  let shownStatus: Status | undefined

  return {
    element,
    paint(i) {
      const status = view.status(i)
      if (shownStatus !== status) {
        element.style.background = STATUS_COLORS[status]
        shownStatus = status
      }
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
  { cluster, markers, onApplied }: RendererOptions & { cluster: boolean },
): Renderer {
  // Each style draws from one feature property, so diffs carry only that one.
  const property = PROPERTIES[markers]
  map.addSource(SOURCE, {
    type: 'geojson',
    data: toFeatureCollection(view, property),
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
  const unclustered: FilterSpecification = ['!', ['has', 'point_count']]
  if (markers === 'icons') {
    map.on('styleimagemissing', onImageMissing)
    map.addLayer({
      id: 'couriers',
      type: 'symbol',
      source: SOURCE,
      filter: unclustered,
      layout: {
        'icon-image': ['get', 'icon'],
        // Overlap and placement checks would hide couriers and cost time on every update.
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    })
  } else {
    map.addLayer({
      id: 'couriers',
      type: 'circle',
      source: SOURCE,
      filter: unclustered,
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
        'circle-stroke-color': COLORS.surface,
      },
    })
  }

  const source = map.getSource<GeoJSONSource>(SOURCE)!
  // MapLibre fires this once its worker has taken in a data update.
  const onSourceData = (event: MapSourceDataEvent) => {
    if (event.sourceId === SOURCE && event.sourceDataType === 'content') onApplied()
  }
  map.on('sourcedata', onSourceData)
  // Last property value sent per courier, so diffs only carry it when it
  // changed. Clusters never use diffs, so they skip it.
  let sent = cluster ? [] : valuesOf(view, property)
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
    if (!cluster) sent = valuesOf(view, property)
    void source.setData(toFeatureCollection(view, property)).finally(() => {
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
          const value = property.of(view, i)
          if (sent[i] !== value) {
            sent[i] = value
            diff.addOrUpdateProperties = [{ key: property.key, value }]
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

interface FeatureProperty {
  key: string
  of: (view: FleetView, i: number) => string | number
}

const PROPERTIES: Record<MarkerStyle, FeatureProperty> = {
  icons: {
    key: 'icon',
    of: (view, i) => courierKey(view.vehicle(i), view.status(i), view.heading(i)),
  },
  dots: { key: 'status', of: (view, i) => view.status(i) },
}

function valuesOf(view: FleetView, property: FeatureProperty) {
  return Array.from({ length: view.count() }, (_, i) => property.of(view, i))
}

function toFeatureCollection(view: FleetView, property: FeatureProperty): FeatureCollection<Point> {
  const features = new Array(view.count())
  for (let i = 0; i < features.length; i++) {
    features[i] = {
      type: 'Feature',
      id: i,
      geometry: { type: 'Point', coordinates: [view.lng(i), view.lat(i)] },
      properties: { [property.key]: property.of(view, i) },
    }
  }
  return { type: 'FeatureCollection', features }
}
