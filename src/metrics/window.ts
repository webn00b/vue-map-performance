/** Values from the last `span` milliseconds. */
export function createTimeWindow(span: number) {
  let samples: { time: number; value: number }[] = []

  const prune = (now: number) => {
    const cutoff = now - span
    let start = 0
    while (start < samples.length && samples[start]!.time < cutoff) start++
    if (start > 0) samples = samples.slice(start)
  }

  return {
    add(time: number, value: number) {
      samples.push({ time, value })
    },
    stats(now: number) {
      prune(now)
      let sum = 0
      let max = 0
      let min = samples.length ? Infinity : 0
      for (const { value } of samples) {
        sum += value
        max = Math.max(max, value)
        min = Math.min(min, value)
      }
      const average = samples.length ? sum / samples.length : 0
      return { count: samples.length, sum, min, max, average }
    },
    clear() {
      samples = []
    },
  }
}
