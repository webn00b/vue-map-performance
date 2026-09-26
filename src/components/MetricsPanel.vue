<script setup lang="ts">
import { computed } from 'vue'
import type { Metrics } from '../metrics/useMetrics'
import { COLORS } from '../colors'
import Sparkline from './Sparkline.vue'

const props = defineProps<{ metrics: Metrics }>()

const format = (value: number, digits = 0) => value.toFixed(digits)

const fpsLevel = computed(() => level(props.metrics.fpsLow, 50, 30, true))
const longTaskLevel = computed(() => level(props.metrics.longTaskMs, 50, 300))
const flushLevel = computed(() => level(props.metrics.flushMaxMs, 8, 16))

/** good / warn / bad against two thresholds; `higherIsBetter` flips the comparison. */
function level(value: number, good: number, bad: number, higherIsBetter = false) {
  if (higherIsBetter) return value >= good ? 'good' : value >= bad ? 'warn' : 'bad'
  return value <= good ? 'good' : value <= bad ? 'warn' : 'bad'
}
</script>

<template>
  <section
    class="metrics"
    data-testid="metrics"
    :data-fps="metrics.fps"
    :data-fps-low="metrics.fpsLow"
    :data-long-task-ms="metrics.longTaskMs"
    :data-flush-ms="metrics.flushMs"
    :data-flush-max-ms="metrics.flushMaxMs"
  >
    <div class="metric">
      <div class="name">FPS <span class="muted">now / lowest</span></div>
      <div class="value" :class="fpsLevel">
        {{ metrics.fps }} <span class="muted">/ {{ metrics.fpsLow }}</span>
      </div>
      <Sparkline :values="metrics.history.fps" :color="COLORS.accent" :max="60" />
    </div>

    <div class="metric">
      <div class="name">Long tasks <span class="muted">last 5 s</span></div>
      <div class="value" :class="longTaskLevel">
        {{ metrics.longTasks }} <span class="muted">· {{ format(metrics.longTaskMs) }} ms</span>
      </div>
      <Sparkline :values="metrics.history.longTaskMs" :color="COLORS.bad" />
    </div>

    <div class="metric">
      <div class="name">Update <span class="muted">avg / max, apply + render</span></div>
      <div class="value" :class="flushLevel">
        {{ format(metrics.flushMs, 1) }}
        <span class="muted">/ {{ format(metrics.flushMaxMs, 1) }} ms</span>
      </div>
      <Sparkline :values="metrics.history.flushMs" :color="COLORS.warn" />
    </div>

    <div class="metric">
      <div class="name">JS heap</div>
      <div class="value">
        <template v-if="metrics.heapMb !== null">{{ format(metrics.heapMb) }} MB</template>
        <span v-else class="muted" title="performance.memory is only available in Chromium"
          >n/a</span
        >
      </div>
    </div>
  </section>
</template>

<style scoped>
.metrics {
  display: grid;
  gap: 10px;
}

.metric {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 2px 8px;
}

.name {
  grid-column: 1 / -1;
  font-weight: 600;
}

.value {
  font-size: 18px;
  font-variant-numeric: tabular-nums;
}

.muted {
  color: var(--muted);
  font-size: 12px;
  font-weight: 400;
}

.good {
  color: var(--good);
}

.warn {
  color: var(--warn);
}

.bad {
  color: var(--bad);
}
</style>
