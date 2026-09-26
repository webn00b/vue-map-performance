# Vue map performance

[![CI](https://github.com/webn00b/vue-map-performance/actions/workflows/ci.yml/badge.svg)](https://github.com/webn00b/vue-map-performance/actions/workflows/ci.yml)

Thousands of couriers moving on a map in Vue 3, with live numbers for what keeps it smooth: how the state is stored, how the markers are drawn and how updates arrive.

**[Open the demo](https://webn00b.github.io/vue-map-performance/)**

![5,000 couriers on the map with the settings and live metrics panels](docs/screenshot.jpg)

## What you can switch

| Setting   | Options                      | What it shows                                                                     |
| --------- | ---------------------------- | --------------------------------------------------------------------------------- |
| Couriers  | 100 – 50,000                 | Where each approach stops scaling                                                 |
| Rendering | DOM markers, WebGL, clusters | One HTML element per courier vs one GeoJSON layer drawn on the GPU                |
| Updates   | stream, snapshot             | Per-courier updates once a second (like WebSocket) vs the whole fleet (polling)   |
| Vue state | `shallowRef`, `ref`          | Typed arrays updated in place vs an array of reactive objects with a deep watcher |

Every combination is a link, for example [10,000 couriers with a deep `ref`](https://webn00b.github.io/vue-map-performance/?n=10000&state=deep) or [with DOM markers](https://webn00b.github.io/vue-map-performance/?n=10000&render=dom).

## Numbers

`npm run bench` opens every scenario in headless Chromium on the GPU (Apple M3 Pro), waits 5 seconds and then measures for 10 seconds while dragging the map around. 10,000 couriers in stream mode unless noted.

| Scenario                  | FPS (lowest) | Long tasks, ms per 5 s | Update avg / max, ms |
| ------------------------- | ------------ | ---------------------- | -------------------- |
| WebGL, `shallowRef`       | 60 (60)      | 0                      | 0.2 / 0.4            |
| WebGL, `ref`              | 40 (40)      | 2754                   | 38.4 / 43.9          |
| Clusters, `shallowRef`    | 60 (60)      | 0                      | 0.5 / 4.8            |
| Clusters, `ref`           | 36 (35)      | 3062                   | 49.8 / 66.5          |
| DOM markers, `shallowRef` | 4 (3)        | 4519                   | 15.8 / 58.4          |
| DOM markers, `ref`        | 5 (3)        | 4926                   | 105.9 / 160.6        |
| 50k, WebGL, `shallowRef`  | 48 (39)      | 563                    | 10.4 / 35.7          |
| 50k, WebGL, `ref`         | 2 (2)        | 4747                   | 298.8 / 359.3        |

"Update" is the time from applying a batch of changes until Vue has flushed everything it triggered, the map update included.

What stands out:

- **The same WebGL layer updates about 190 times faster with `shallowRef`.** With `ref`, every courier is a reactive proxy, the deep watcher walks all 10,000 of them on every change and the GeoJSON is rebuilt by reading through proxies. With `shallowRef`, Vue tracks one reference and the layer gets a diff of the couriers that moved.
- **DOM markers don't scale, whatever the state looks like.** The browser repositions 10,000 elements on every frame of a map move.
- **Clusters are cheap per update** but re-run over the whole fleet, so they suffer from the deep watcher just as much.

## How it works

- **Simulation** runs in a Web Worker with a seeded PRNG, so the same settings always produce the same movement. Positions live in typed arrays and are transferred to the page without copying.
- **Stream mode** sends only the couriers that reported in the last tick; the page applies everything that arrived once per animation frame. **Snapshot mode** sends the whole fleet every few seconds.
- **State** is held either as an array of objects in `ref()` with a deep watcher, the way it is usually written, or as typed arrays in `shallowRef()` updated in place and announced with `triggerRef()`.
- **Rendering**: DOM mode uses one `maplibregl.Marker` per courier. WebGL mode keeps everyone in a single GeoJSON source and sends small stream updates through `updateData` with the changed features only. Cluster mode uses the source's built-in clustering.
- **Metrics** come from `requestAnimationFrame` (FPS), `PerformanceObserver` (long tasks) and `performance.memory` (Chromium only).

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
