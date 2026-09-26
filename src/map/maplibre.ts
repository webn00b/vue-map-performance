import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

// MapLibre resolves its worker relative to its own module, which breaks once
// Vite pre-bundles the dependency. Bundle the worker ourselves and point to it.
setWorkerUrl(workerUrl)

export * from 'maplibre-gl'
