<script setup lang="ts">
import { ref, watchEffect } from 'vue'

const props = defineProps<{ values: number[]; color: string; max?: number }>()
const canvas = ref<HTMLCanvasElement>()

const WIDTH = 120
const HEIGHT = 24

function draw() {
  const context = canvas.value?.getContext('2d')
  if (!context) return
  const ratio = window.devicePixelRatio || 1
  canvas.value!.width = WIDTH * ratio
  canvas.value!.height = HEIGHT * ratio
  context.scale(ratio, ratio)
  context.clearRect(0, 0, WIDTH, HEIGHT)

  const { values } = props
  if (values.length < 2) return
  const top = props.max ?? Math.max(...values, 1)
  const step = WIDTH / (values.length - 1)

  context.beginPath()
  values.forEach((value, i) => {
    const y = HEIGHT - 2 - (Math.min(value, top) / top) * (HEIGHT - 4)
    if (i === 0) context.moveTo(0, y)
    else context.lineTo(i * step, y)
  })
  context.strokeStyle = props.color
  context.lineWidth = 1.5
  context.stroke()
}

// Reads every value, so it re-runs when the history changes; `post` waits for the canvas.
watchEffect(draw, { flush: 'post' })
</script>

<template>
  <canvas ref="canvas" class="sparkline" :style="{ width: `${WIDTH}px`, height: `${HEIGHT}px` }" />
</template>
