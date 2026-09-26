<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Map as MapLibreMap } from './map/maplibre'

const container = ref<HTMLElement>()
let map: MapLibreMap | undefined

onMounted(() => {
  map = new MapLibreMap({
    container: container.value!,
    style: 'https://tiles.openfreemap.org/styles/positron',
    center: [37.6176, 55.7558],
    zoom: 10,
  })
  map.on('error', (event) => console.error(event.error))
})

onBeforeUnmount(() => map?.remove())
</script>

<template>
  <div ref="container" class="map" />
</template>

<style scoped>
.map {
  position: absolute;
  inset: 0;
}
</style>
