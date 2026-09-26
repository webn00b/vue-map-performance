import { MOSCOW } from './city'
import { createFeed, TICK_MS, type FeedMessage, type FeedMode } from './feed'

export type WorkerCommand =
  | {
      type: 'start'
      /** Echoed back with every message, so the page can drop messages from a previous run. */
      run: number
      count: number
      seed: number
      mode: FeedMode
      snapshotIntervalMs: number
    }
  | { type: 'stop' }

export interface WorkerMessage {
  run: number
  message: FeedMessage
}

let timer: ReturnType<typeof setInterval> | undefined

self.onmessage = (event: MessageEvent<WorkerCommand>) => {
  clearInterval(timer)
  const command = event.data
  if (command.type === 'stop') return

  const feed = createFeed({ ...command, bounds: MOSCOW })
  const post = (message: FeedMessage) => {
    // Transfer the buffers instead of structured-cloning them.
    const buffers: ArrayBuffer[] = [message.positions.buffer, message.statuses.buffer]
    if (message.type === 'delta') buffers.push(message.indices.buffer)
    self.postMessage({ run: command.run, message } satisfies WorkerMessage, { transfer: buffers })
  }

  post(feed.initial())
  timer = setInterval(() => feed.tick(TICK_MS).forEach(post), TICK_MS)
}
