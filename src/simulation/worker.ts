import { TORONTO } from './city'
import type { FeedMode } from '../settings'
import { createFeed, TICK_MS, type FeedMessage } from './feed'

export interface WorkerCommand {
  type: 'start'
  /** Echoed back with every message, so the page can drop messages from a previous run. */
  run: number
  count: number
  seed: number
  mode: FeedMode
  snapshotIntervalMs: number
}

export interface WorkerMessage {
  run: number
  message: FeedMessage
}

let timer: ReturnType<typeof setInterval> | undefined

self.onmessage = (event: MessageEvent<WorkerCommand>) => {
  clearInterval(timer)
  const command = event.data

  const feed = createFeed({ ...command, city: TORONTO })
  const post = (message: FeedMessage) => {
    // Transfer the buffers instead of structured-cloning them.
    const buffers: ArrayBuffer[] = [message.positions.buffer, message.statuses.buffer]
    if (message.type === 'delta') buffers.push(message.indices.buffer)
    self.postMessage({ run: command.run, message } satisfies WorkerMessage, { transfer: buffers })
  }

  post(feed.initial())
  timer = setInterval(() => {
    const message = feed.tick(TICK_MS)
    if (message) post(message)
  }, TICK_MS)
}
