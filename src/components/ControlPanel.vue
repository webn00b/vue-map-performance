<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  DOM_MARKER_LIMIT,
  DOM_MARKER_WARNING,
  FEED_MODES,
  formatCount,
  INTERVAL_RANGE,
  normalizeSettings,
  RENDER_MODES,
  STATE_MODES,
  type FeedMode,
  type RenderMode,
  type Settings,
  type StateMode,
} from '../settings'
import SegmentedControl from './SegmentedControl.vue'

const props = defineProps<{ settings: Settings }>()
const emit = defineEmits<{ change: [patch: Partial<Settings>] }>()

const COUNTS = [100, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000, 200_000]

const render = {
  labels: { dom: 'DOM', webgl: 'GeoJSON', cluster: 'Clusters', gpu: 'GPU' },
  hints: {
    dom: 'One HTML element per courier. Flexible, but the browser repositions every marker on each map move.',
    webgl:
      'All couriers in one GeoJSON source. MapLibre re-tiles it in a worker after each update, which falls behind on large fleets.',
    cluster:
      'Nearby couriers merge into clusters. Clustering re-runs over the whole fleet on every update.',
    gpu: 'A custom WebGL layer: positions go straight into a GPU buffer, with no GeoJSON and no worker round trip.',
  },
} satisfies { labels: Record<RenderMode, string>; hints: Record<RenderMode, string> }

const feed = {
  labels: { stream: 'Stream', snapshot: 'Snapshot' },
  hints: {
    stream:
      'Each courier reports once a second, like a WebSocket feed. Changes are applied once per frame.',
    snapshot: 'The whole fleet arrives at once, like polling an endpoint.',
  },
} satisfies { labels: Record<FeedMode, string>; hints: Record<FeedMode, string> }

const state = {
  labels: { shallow: 'shallowRef', deep: 'ref' },
  hints: {
    shallow: 'Typed arrays in shallowRef, updated in place and announced with triggerRef().',
    deep: 'An array of objects in ref() and a deep watcher, the way it is usually written.',
  },
} satisfies { labels: Record<StateMode, string>; hints: Record<StateMode, string> }

// The slider moves through fixed steps and applies after a short pause, so
// dragging it doesn't rebuild the fleet at every step.
const draftCount = ref<number>()
let countTimer: ReturnType<typeof setTimeout> | undefined
const sliderIndex = computed(() => nearestCountIndex(draftCount.value ?? props.settings.count))
const shownCount = computed(() => formatCount(draftCount.value ?? props.settings.count))

function onSlide(index: number) {
  draftCount.value = COUNTS[index]!
  clearTimeout(countTimer)
  countTimer = setTimeout(() => {
    update({ count: draftCount.value })
    draftCount.value = undefined
  }, 300)
}

function update(patch: Partial<Settings>) {
  const current = props.settings
  // Ask only when DOM markers would really be drawn; above the cap the app
  // switches to WebGL anyway.
  const next = normalizeSettings({ ...current, ...patch }).settings
  const heavy = (s: Settings) => s.render === 'dom' && s.count > DOM_MARKER_WARNING
  if (heavy(next) && !heavy(current)) {
    const confirmed = window.confirm(
      `${formatCount(next.count)} DOM markers can freeze the tab for a few seconds. Continue?`,
    )
    if (!confirmed) return
  }
  emit('change', patch)
}

function nearestCountIndex(count: number) {
  let best = 0
  COUNTS.forEach((value, i) => {
    if (Math.abs(value - count) < Math.abs(COUNTS[best]! - count)) best = i
  })
  return best
}
</script>

<template>
  <section class="controls">
    <label class="field">
      <span class="label">
        Couriers <strong data-testid="count">{{ shownCount }}</strong>
      </span>
      <input
        :value="sliderIndex"
        type="range"
        min="0"
        :max="COUNTS.length - 1"
        step="1"
        data-testid="count-slider"
        @input="onSlide(Number(($event.target as HTMLInputElement).value))"
      />
    </label>

    <SegmentedControl
      legend="Rendering"
      :options="RENDER_MODES"
      v-bind="render"
      testid="render"
      :model-value="settings.render"
      @update:model-value="update({ render: $event })"
    >
      <p v-if="settings.render === 'dom'" class="hint">
        Capped at {{ formatCount(DOM_MARKER_LIMIT) }} markers.
      </p>
    </SegmentedControl>

    <SegmentedControl
      legend="Updates"
      :options="FEED_MODES"
      v-bind="feed"
      testid="feed"
      :model-value="settings.feed"
      @update:model-value="update({ feed: $event })"
    >
      <label v-if="settings.feed === 'snapshot'" class="inline">
        every
        <input
          type="number"
          :min="INTERVAL_RANGE.min"
          :max="INTERVAL_RANGE.max"
          :value="settings.interval"
          @change="update({ interval: Number(($event.target as HTMLInputElement).value) })"
        />
        s
      </label>
    </SegmentedControl>

    <SegmentedControl
      legend="Vue state"
      :options="STATE_MODES"
      v-bind="state"
      testid="state"
      :model-value="settings.state"
      @update:model-value="update({ state: $event })"
    />
  </section>
</template>

<style scoped>
.controls {
  display: grid;
  gap: 14px;
}

.field {
  display: grid;
  gap: 6px;
}

.label {
  font-weight: 600;
}

.label strong {
  float: right;
  font-variant-numeric: tabular-nums;
}

.hint {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
}

.inline {
  display: flex;
  align-items: center;
  gap: 6px;
}

.inline input {
  width: 56px;
  font: inherit;
}

input[type='range'] {
  width: 100%;
}
</style>
