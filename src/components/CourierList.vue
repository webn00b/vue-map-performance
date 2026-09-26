<script setup lang="ts">
import { computed, ref } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { Status } from '../simulation/fleet'
import type { FleetView } from '../state/useCouriers'
import { STATUS_COLORS } from '../map/renderers'

const props = defineProps<{ view: FleetView }>()
const emit = defineEmits<{ select: [index: number] }>()

const STATUS_NAMES: Record<Status, string> = {
  [Status.Idle]: 'idle',
  [Status.Delivering]: 'delivering',
  [Status.Returning]: 'returning',
}

const scroller = ref<HTMLElement>()
const virtualizer = useVirtualizer(
  computed(() => ({
    count: props.view.count(),
    getScrollElement: () => scroller.value ?? null,
    estimateSize: () => 28,
    overscan: 8,
  })),
)
</script>

<template>
  <div ref="scroller" class="list" data-testid="courier-list">
    <div :style="{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }">
      <button
        v-for="row in virtualizer.getVirtualItems()"
        :key="row.index"
        type="button"
        class="row"
        :style="{ transform: `translateY(${row.start}px)` }"
        @click="emit('select', row.index)"
      >
        <span class="dot" :style="{ background: STATUS_COLORS[view.status(row.index)] }" />
        <span class="id">#{{ row.index + 1 }}</span>
        <span class="status">{{ STATUS_NAMES[view.status(row.index)] }}</span>
        <span class="coords">
          {{ view.lat(row.index).toFixed(4) }}, {{ view.lng(row.index).toFixed(4) }}
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.list {
  height: 100%;
  overflow: auto;
}

.row {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 28px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border: 0;
  border-bottom: 1px solid #eaeef2;
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.row:hover {
  background: #f6f8fa;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}

.id {
  width: 48px;
  font-variant-numeric: tabular-nums;
}

.status {
  width: 68px;
  color: var(--muted);
}

.coords {
  margin-left: auto;
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
