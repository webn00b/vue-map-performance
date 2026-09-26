# Vue map performance

[![CI](https://github.com/webn00b/vue-map-performance/actions/workflows/ci.yml/badge.svg)](https://github.com/webn00b/vue-map-performance/actions/workflows/ci.yml)

Thousands of couriers moving on a map in Vue 3, with live numbers for what keeps it smooth: how the state is stored, how the markers are drawn and how updates arrive.

**[Open the demo](https://webn00b.github.io/vue-map-performance/)**

![5,000 couriers on the map with the settings and live metrics panels](docs/screenshot.webp)

## What you can switch

| Setting   | Options                                   | What it shows                                                                     |
| --------- | ----------------------------------------- | --------------------------------------------------------------------------------- |
| Couriers  | 100 – 200,000                             | Where each approach stops scaling                                                 |
| Rendering | DOM markers, GeoJSON, clusters, GPU layer | HTML elements vs a GeoJSON source MapLibre re-tiles vs a custom WebGL layer       |
| Updates   | stream, snapshot                          | Per-courier updates once a second (like WebSocket) vs the whole fleet (polling)   |
| Vue state | `shallowRef`, `ref`                       | Typed arrays updated in place vs an array of reactive objects with a deep watcher |

Every combination is a link, for example [50,000 couriers in a GeoJSON layer](https://webn00b.github.io/vue-map-performance/?n=50000&render=webgl), [200,000 on the GPU layer](https://webn00b.github.io/vue-map-performance/?n=200000) or [10,000 with a deep `ref`](https://webn00b.github.io/vue-map-performance/?n=10000&state=deep). DOM markers are capped at 10,000, GeoJSON layers and the deep `ref` at 50,000; above that the demo switches to the GPU layer and `shallowRef`.

## Numbers

`npm run bench` opens every scenario in headless Chromium on the GPU (Apple M3 Pro), waits 5 seconds and then measures for 10 seconds while dragging the map around. 10,000 couriers in stream mode unless noted.

| Scenario                      | FPS (lowest) | Map updates / feed messages, per s | Long tasks, ms per 5 s | Update avg / max, ms |
| ----------------------------- | ------------ | ---------------------------------- | ---------------------- | -------------------- |
| GPU layer, `shallowRef`       | 60 (60)      | 10 / 10                            | 0                      | 0.6 / 0.9            |
| GPU layer, `ref`              | 50 (48)      | 10 / 10                            | 0                      | 35.3 / 38.0          |
| GeoJSON, `shallowRef`         | 61 (59)      | 10 / 10                            | 0                      | 0.3 / 0.5            |
| GeoJSON, `ref`                | 49 (48)      | 10 / 10                            | 0                      | 29.5 / 33.0          |
| Clusters, `shallowRef`        | 60 (59)      | 10 / 10                            | 0                      | 0.4 / 0.5            |
| DOM markers, `shallowRef`     | 14 (14)      | 10 / 10                            | 4103                   | 2.5 / 4.2            |
| DOM markers, `ref`            | 9 (8)        | 9 / 11                             | 4877                   | 47.1 / 55.4          |
| 50k, GPU layer, `shallowRef`  | 60 (60)      | 10 / 10                            | 0                      | 1.0 / 1.4            |
| 50k, GeoJSON, `shallowRef`    | 59 (57)      | **1 / 10**                         | 212                    | 2.5 / 4.6            |
| 50k, GeoJSON, `ref`           | 4 (3)        | 4 / 9                              | 4698                   | 145.8 / 151.1        |
| 200k, GPU layer, `shallowRef` | 60 (60)      | 10 / 10                            | 0                      | 2.3 / 3.0            |

"Map updates" counts how often new courier data actually reached the screen. "Update" is the time from applying a batch of changes until Vue has flushed and the map layer has been updated; what MapLibre does in its own worker afterwards is not included.

What stands out:

- **FPS can look fine while the map lags.** At 50,000 couriers the GeoJSON layer still renders at 59 FPS, but only one update in ten reaches the screen: MapLibre re-tiles the whole source in its worker after each update and can't keep up. Positions on screen are about a second old.
- **A custom WebGL layer removes that step.** Positions go from typed arrays straight into a GPU buffer, so every update is drawn on the next frame: 10 updates a second at 60 FPS with 200,000 couriers, and no long tasks.
- **`ref` vs `shallowRef` is a 50–100× difference per update.** With `ref`, every courier is a reactive proxy and the deep watcher walks all of them on every change. With `shallowRef`, Vue tracks one reference and the renderers get the list of couriers that moved.
- **DOM markers don't scale, whatever the state looks like.** The browser repositions every element on each frame of a map move.

## How it works

- **Simulation** runs in a Web Worker with a seeded PRNG, so the same settings always produce the same movement. Positions live in typed arrays and are transferred to the page without copying.
- **Stream mode** sends only the couriers that reported in the last tick; the page applies everything that arrived once per animation frame. **Snapshot mode** sends the whole fleet every few seconds.
- **State** is held either as an array of objects in `ref()` with a deep watcher, the way it is usually written, or as typed arrays in `shallowRef()` updated in place and announced with `triggerRef()`.
- **Rendering**: DOM mode uses one `maplibregl.Marker` per courier. GeoJSON mode keeps everyone in a single GeoJSON source and sends small stream updates through `updateData` with the changed features only; cluster mode uses the source's built-in clustering. The GPU layer is a MapLibre custom layer: positions are converted to Web Mercator into a `Float32Array`, uploaded with `bufferSubData` and drawn as points by a small shader, with no GeoJSON or worker involved.
- **Metrics** come from `requestAnimationFrame` (FPS), `PerformanceObserver` (long tasks) and `performance.memory` (Chromium only). Map updates are counted when data reaches the screen: after each DOM update, on MapLibre's `sourcedata` event for GeoJSON, and when the GPU layer uploads a new buffer.

## Run it

```sh
npm install
npm run dev
```

```sh
npm test            # unit tests
npm run test:e2e    # Playwright smoke tests
npm run bench       # the table above
```

`npm run bench` passes `--use-angle=metal` to get the GPU in headless Chromium on macOS. Elsewhere, change the flags in `scripts/bench.mjs`, otherwise WebGL falls back to software rendering and the numbers mean little.

## Background

I've dealt with the same problems at work on Yandex Maps. This is a clean-room version on open data: MapLibre GL with [OpenFreeMap](https://openfreemap.org) tiles, no API key needed.

## License

MIT. Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, tiles by OpenFreeMap and OpenMapTiles.
