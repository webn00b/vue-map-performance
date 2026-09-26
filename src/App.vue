<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import ControlPanel from './components/ControlPanel.vue'
import CourierList from './components/CourierList.vue'
import MetricsPanel from './components/MetricsPanel.vue'
import { Map as MapLibreMap } from './map/maplibre'
import { createRenderer, type Renderer } from './map/renderers'
import { useMetrics } from './metrics/useMetrics'
import { normalizeSettings, parseSettings, serializeSettings, type Settings } from './settings'
import { TORONTO } from './simulation/city'
import type { WorkerCommand, WorkerMessage } from './simulation/worker'
import { useCouriers } from './state/useCouriers'

/** Keep in sync with the media query in the styles below. */
const NARROW_SCREEN = '(max-width: 720px)'

const initial = parseSettings(location.search)
const settings = ref(initial.settings)
const notice = ref(initial.notice)
const error = ref<string>()
const listOpen = ref(!window.matchMedia(NARROW_SCREEN).matches)

function applyChange(patch: Partial<Settings>) {
  const next = normalizeSettings({ ...settings.value, ...patch })
  settings.value = next.settings
  if (next.notice) notice.value = next.notice
}

const syncUrl = (value: Settings) =>
  history.replaceState(null, '', serializeSettings(value) || location.pathname)
syncUrl(settings.value)
watch(settings, syncUrl)

const {
  metrics,
  recordFlush,
  recordMapUpdate,
  recordFeedMessage,
  reset: resetMetrics,
} = useMetrics()

const store = shallowRef(useCouriers(settings.value.state, recordFlush))

// --- Simulation -------------------------------------------------------------

const worker = new Worker(new URL('./simulation/worker.ts', import.meta.url), { type: 'module' })
let run = 0

worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
  if (event.data.run !== run) return
  recordFeedMessage()
  store.value.receive(event.data.message)
}
worker.onerror = () => {
  error.value = 'The simulation worker failed to start. Try reloading the page.'
}

// Only these settings need a new fleet; switching the renderer keeps it running.
watch(
  [
    () => settings.value.count,
    () => settings.value.seed,
    () => settings.value.feed,
    () => settings.value.interval,
    () => settings.value.state,
  ],
  ([count, seed, feed, interval, state], previous) => {
    if (state !== previous?.[4]) {
      store.value.dispose()
      store.value = useCouriers(state, recordFlush)
    }
    run++
    worker.postMessage({
      type: 'start',
      run,
      count,
      seed,
      mode: feed,
      snapshotIntervalMs: interval * 1000,
    } satisfies WorkerCommand)
    resetMetrics()
  },
  { immediate: true },
)

// --- Map ----------------------------------------------------------------------

const MAP_ERROR = 'The map failed to load. Check the connection and reload.'
const container = ref<HTMLElement>()
const mapReady = ref(false)
let map: MapLibreMap | undefined
let renderer: Renderer | undefined
let stopListening: (() => void) | undefined

onMounted(() => {
  map = new MapLibreMap({
    container: container.value!,
    style: 'https://tiles.openfreemap.org/styles/positron',
    center: TORONTO.center,
    zoom: 10.5,
    // Headings are drawn relative to screen north, so the map stays north-up.
    dragRotate: false,
    pitchWithRotate: false,
    maxPitch: 0,
  })
  map.touchZoomRotate.disableRotation()
  map.keyboard.disableRotation()
  map.on('load', () => {
    mapReady.value = true
    // A tile that failed while loading doesn't matter once the map is up.
    if (error.value === MAP_ERROR) error.value = undefined
  })
  map.on('error', (event) => {
    console.error(event.error)
    if (!mapReady.value) error.value = MAP_ERROR
  })
})

watch(
  [mapReady, store, () => settings.value.render, () => settings.value.markers],
  ([ready, current, mode, markers]) => {
    stopListening?.()
    renderer?.destroy()
    if (!ready || !map) return

    renderer = createRenderer(mode, map, current.view, { markers, onApplied: recordMapUpdate })
    stopListening = current.onChange((changed) => renderer!.update(changed))
    resetMetrics()
  },
)

function focusCourier(index: number) {
  const { view } = store.value
  map?.flyTo({ center: [view.lng(index), view.lat(index)], zoom: 15 })
}

onBeforeUnmount(() => {
  stopListening?.()
  renderer?.destroy()
  worker.terminate()
  map?.remove()
})
</script>

<template>
  <div ref="container" class="map" data-testid="map" />

  <aside class="panel settings">
    <header>
      <h1>Vue map performance</h1>
      <p class="muted">Thousands of moving couriers, and what it takes to keep the map smooth.</p>
    </header>
    <p v-if="notice" class="notice" role="status">
      {{ notice }} <button type="button" @click="notice = undefined">×</button>
    </p>
    <ControlPanel :settings="settings" @change="applyChange" />
    <MetricsPanel :metrics="metrics" />
    <footer class="muted">
      <a href="https://github.com/webn00b/vue-map-performance">Source on GitHub</a>
    </footer>
  </aside>

  <aside class="panel couriers" :class="{ collapsed: !listOpen }">
    <button type="button" class="toggle" @click="listOpen = !listOpen">
      {{ listOpen ? 'Hide list' : 'Show couriers' }}
    </button>
    <CourierList v-if="listOpen" :view="store.view" @select="focusCourier" />
  </aside>

  <div v-if="error" class="error" role="alert">{{ error }}</div>
</template>

<style scoped>
.map {
  position: absolute;
  inset: 0;
}

.panel {
  position: absolute;
  top: 12px;
  z-index: 1;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 4px 16px var(--shadow);
}

.settings {
  left: 12px;
  width: 300px;
  max-height: calc(100% - 24px);
  overflow: auto;
  padding: 14px;
  display: grid;
  gap: 16px;
}

h1 {
  margin: 0 0 4px;
  font-size: 16px;
}

p {
  margin: 0;
}

.muted {
  color: var(--muted);
}

.notice {
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--warn-bg);
  color: var(--warn);
}

.notice button {
  float: right;
  border: 0;
  background: none;
  cursor: pointer;
}

.couriers {
  right: 12px;
  width: 300px;
  height: min(480px, calc(100% - 60px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.couriers.collapsed {
  height: auto;
}

.toggle {
  padding: 8px 10px;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: none;
  font: inherit;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.error {
  position: absolute;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2;
  padding: 10px 14px;
  border-radius: 6px;
  background: var(--bad);
  color: var(--surface);
}

/* Keep in sync with NARROW_SCREEN. The map only covers the area above the
   settings sheet, so its controls and flyTo() stay in the visible part. */
@media (max-width: 720px) {
  .map {
    bottom: 45%;
  }

  .settings {
    top: auto;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 45%;
    max-height: none;
    border-radius: 0;
  }

  .couriers {
    right: 12px;
    width: calc(100% - 24px);
    height: auto;
  }

  .couriers:not(.collapsed) {
    height: 35%;
  }
}
</style>
