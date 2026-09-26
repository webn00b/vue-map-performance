<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  DOM_MARKER_LIMIT,
  DOM_MARKER_WARNING,
  INTERVAL_RANGE,
  type RenderMode,
  type Settings,
  type StateMode,
} from '../settings'
import type { FeedMode } from '../simulation/feed'

const props = defineProps<{ settings: Settings }>()
const emit = defineEmits<{ change: [patch: Partial<Settings>] }>()

const COUNTS = [100, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000]

const renderOptions: { value: RenderMode; label: string; hint: string }[] = [
  {
    value: 'dom',
    label: 'DOM markers',
    hint: 'One HTML element per courier. Flexible, but the browser repositions every marker on each map move.',
  },
  {
    value: 'webgl',
    label: 'WebGL',
    hint: 'All couriers in one GeoJSON source drawn on the GPU. Small updates are sent as diffs.',
  },
  {
    value: 'cluster',
    label: 'Clusters',
    hint: 'Nearby couriers merge into clusters. Clustering re-runs over the whole fleet on every update.',
  },
]

const feedOptions: { value: FeedMode; label: string; hint: string }[] = [
  {
    value: 'stream',
    label: 'Stream',
    hint: 'Each courier reports once a second, like a WebSocket feed. Changes are applied once per frame.',
  },
  {
    value: 'snapshot',
    label: 'Snapshot',
    hint: 'The whole fleet arrives at once, like polling an endpoint.',
  },
]

const stateOptions: { value: StateMode; label: string; hint: string }[] = [
  {
    value: 'shallow',
    label: 'shallowRef',
    hint: 'Typed arrays in shallowRef, updated in place and announced with triggerRef().',
  },
  {
    value: 'deep',
    label: 'ref',
    hint: 'An array of objects in ref() and a deep watcher, the way it is usually written.',
  },
]

const hint = (options: { value: string; hint: string }[], value: string) =>
  options.find((option) => option.value === value)?.hint

// The slider moves through fixed steps and applies after a short pause, so
// dragging it doesn't rebuild the fleet at every step.
const countIndex = ref(nearestCountIndex(props.settings.count))
let countTimer: ReturnType<typeof setTimeout> | undefined
watch(countIndex, (index) => {
  clearTimeout(countTimer)
  countTimer = setTimeout(() => update({ count: COUNTS[index]! }), 300)
})
watch(
  () => props.settings.count,
  (count) => (countIndex.value = nearestCountIndex(count)),
)
const shownCount = computed(() => COUNTS[countIndex.value]!.toLocaleString('en-US'))

function update(patch: Partial<Settings>) {
  const next = { ...props.settings, ...patch }
  const tooManyMarkers = (s: Settings) => s.render === 'dom' && s.count > DOM_MARKER_WARNING
  if (tooManyMarkers(next) && !tooManyMarkers(props.settings)) {
    const confirmed = window.confirm(
      `${next.count.toLocaleString('en-US')} DOM markers can freeze the tab for a few seconds. Continue?`,
    )
    if (!confirmed) {
      countIndex.value = nearestCountIndex(props.settings.count)
      return
    }
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
        v-model.number="countIndex"
        type="range"
        min="0"
        :max="COUNTS.length - 1"
        step="1"
        data-testid="count-slider"
      />
    </label>

    <fieldset class="field">
      <legend class="label">Rendering</legend>
      <div class="segmented">
        <button
          v-for="option in renderOptions"
          :key="option.value"
          type="button"
          :class="{ active: settings.render === option.value }"
          :data-testid="`render-${option.value}`"
          @click="update({ render: option.value })"
        >
          {{ option.label }}
        </button>
      </div>
      <p class="hint">{{ hint(renderOptions, settings.render) }}</p>
      <p v-if="settings.render === 'dom'" class="hint">
        Capped at {{ DOM_MARKER_LIMIT.toLocaleString('en-US') }} markers.
      </p>
    </fieldset>

    <fieldset class="field">
      <legend class="label">Updates</legend>
      <div class="segmented">
        <button
          v-for="option in feedOptions"
          :key="option.value"
          type="button"
          :class="{ active: settings.feed === option.value }"
          :data-testid="`feed-${option.value}`"
          @click="update({ feed: option.value })"
        >
          {{ option.label }}
        </button>
      </div>
      <label v-if="settings.feed === 'snapshot'" class="inline">
        every
        <input
          type="number"
          :min="INTERVAL_RANGE.min"
          :max="INTERVAL_RANGE.max"
          :value="settings.interval"
          @change="
            update({
              interval: Math.min(
                INTERVAL_RANGE.max,
                Math.max(
                  INTERVAL_RANGE.min,
                  Number(($event.target as HTMLInputElement).value) || 1,
                ),
              ),
            })
          "
        />
        s
      </label>
      <p class="hint">{{ hint(feedOptions, settings.feed) }}</p>
    </fieldset>

    <fieldset class="field">
      <legend class="label">Vue state</legend>
      <div class="segmented">
        <button
          v-for="option in stateOptions"
          :key="option.value"
          type="button"
          :class="{ active: settings.state === option.value }"
          :data-testid="`state-${option.value}`"
          @click="update({ state: option.value })"
        >
          {{ option.label }}
        </button>
      </div>
      <p class="hint">{{ hint(stateOptions, settings.state) }}</p>
    </fieldset>
  </section>
</template>

<style scoped>
.controls {
  display: grid;
  gap: 14px;
}

.field {
  margin: 0;
  padding: 0;
  border: 0;
  display: grid;
  gap: 6px;
}

.label {
  padding: 0;
  font-weight: 600;
}

.label strong {
  float: right;
  font-variant-numeric: tabular-nums;
}

.segmented {
  display: flex;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.segmented button {
  flex: 1;
  padding: 5px 6px;
  border: 0;
  border-left: 1px solid var(--border);
  background: #fff;
  color: var(--text);
  font: inherit;
  cursor: pointer;
}

.segmented button:first-child {
  border-left: 0;
}

.segmented button.active {
  background: var(--accent);
  color: #fff;
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
