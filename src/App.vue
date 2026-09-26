<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch, type WatchStopHandle } from 'vue'
import ControlPanel from './components/ControlPanel.vue'
import CourierList from './components/CourierList.vue'
import MetricsPanel from './components/MetricsPanel.vue'
import { AttributionControl, Map as MapLibreMap } from './map/maplibre'
import { createRenderer, type Renderer } from './map/renderers'
import { useMetrics } from './metrics/useMetrics'
import { enforceLimits, parseSettings, serializeSettings } from './settings'
import { MOSCOW_CENTER } from './simulation/city'
import type { WorkerCommand, WorkerMessage } from './simulation/worker'
import { useCouriers } from './state/useCouriers'

const initial = enforceLimits(parseSettings(location.search))
const settings = ref(initial.settings)
const notice = ref(initial.notice)
const error = ref<string>()
const listOpen = ref(window.innerWidth > 720)

watch(
  settings,
  (value) => {
    const limited = enforceLimits(value)
    if (limited.settings !== value) {
      settings.value = limited.settings
      notice.value = limited.notice
      return
    }
    history.replaceState(null, '', serializeSettings(value) || location.pathname)
  },
  { deep: true, immediate: true },
)

const { metrics, recordFlush, reset: resetMetrics } = useMetrics()

const store = shallowRef(useCouriers(settings.value.state, recordFlush))

// --- Simulation -------------------------------------------------------------

const worker = new Worker(new URL('./simulation/worker.ts', import.meta.url), { type: 'module' })
let run = 0

worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
  if (event.data.run === run) store.value.receive(event.data.message)
}
worker.onerror = () => {
  error.value = 'The simulation worker failed to start. Try reloading the page.'
}

watch(
  () => {
    const { count, seed, feed, interval, state } = settings.value
    return { count, seed, feed, interval, state }
  },
  (current, previous) => {
    if (current.state !== previous?.state) {
      store.value = useCouriers(current.state, recordFlush)
    }
    run++
    worker.postMessage({
      type: 'start',
      run,
      count: current.count,
      seed: current.seed,
      mode: current.feed,
      snapshotIntervalMs: current.interval * 1000,
    } satisfies WorkerCommand)
    resetMetrics()
  },
  { immediate: true },
)

// --- Map ----------------------------------------------------------------------

const container = ref<HTMLElement>()
const mapReady = ref(false)
let map: MapLibreMap | undefined
let renderer: Renderer | undefined
let stopListening: WatchStopHandle | undefined

onMounted(() => {
  map = new MapLibreMap({
    container: container.value!,
    style: 'https://tiles.openfreemap.org/styles/positron',
    center: MOSCOW_CENTER,
    zoom: 10,
    attributionControl: false,
  })
  // On narrow screens the settings sheet covers the bottom edge, and the
  // OpenStreetMap attribution has to stay visible.
  const narrow = window.matchMedia('(max-width: 720px)').matches
  map.addControl(new AttributionControl({ compact: true }), narrow ? 'top-left' : 'bottom-right')
  map.on('load', () => (mapReady.value = true))
  map.on('error', (event) => {
    console.error(event.error)
    if (!mapReady.value) error.value = 'The map failed to load. Check the connection and reload.'
  })
})

watch([mapReady, store, () => settings.value.render], ([ready, current, mode]) => {
  stopListening?.()
  renderer?.destroy()
  if (!ready || !map) return

  renderer = createRenderer(mode, map, current.view)
  renderer.update(null)
  stopListening = current.onChange((changed) => renderer!.update(changed))
  resetMetrics()
})

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
    <ControlPanel
      :settings="settings"
      @change="(patch) => (settings = { ...settings, ...patch })"
    />
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
  box-shadow: 0 4px 16px rgb(0 0 0 / 0.08);
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
  background: #fff8c5;
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
  color: #fff;
}

@media (max-width: 720px) {
  .settings {
    top: auto;
    bottom: 0;
    left: 0;
    width: 100%;
    max-height: 45%;
    border-radius: 8px 8px 0 0;
  }

  /* Leaves room for the attribution, which MapLibre shows expanded on load. */
  .couriers {
    top: 48px;
    right: 12px;
    width: calc(100% - 24px);
    height: auto;
  }

  .couriers:not(.collapsed) {
    height: 35%;
  }
}
</style>
