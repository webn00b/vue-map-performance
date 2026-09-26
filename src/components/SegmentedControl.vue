<script setup lang="ts" generic="T extends string">
defineProps<{
  legend: string
  options: readonly T[]
  labels: Record<T, string>
  hints: Record<T, string>
  /** Prefix for the buttons' `data-testid`, e.g. `render` → `render-webgl`. */
  testid: string
}>()
const model = defineModel<T>({ required: true })
</script>

<template>
  <fieldset class="field">
    <legend class="label">{{ legend }}</legend>
    <div class="segmented">
      <button
        v-for="option in options"
        :key="option"
        type="button"
        :class="{ active: model === option }"
        :data-testid="`${testid}-${option}`"
        @click="model = option"
      >
        {{ labels[option] }}
      </button>
    </div>
    <slot />
    <p class="hint">{{ hints[model] }}</p>
  </fieldset>
</template>

<style scoped>
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
  background: var(--surface);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}

.segmented button:first-child {
  border-left: 0;
}

.segmented button.active {
  background: var(--accent);
  color: var(--surface);
}

.hint {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
}
</style>
