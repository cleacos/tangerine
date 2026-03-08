export { getOrCreateClient, getClient, removeClient, hasClient } from "./client"
export { subscribeToEvents } from "./events"
export type { EventHandler, SseSubscription } from "./events"
export {
  enqueue,
  setAgentState,
  drainNext,
  getQueueLength,
  getAgentState,
  clearQueue,
} from "./prompt-queue"
export type { SendPromptFn } from "./prompt-queue"
export type {
  AgentState,
  EventListener,
  OpenCodeEvent,
  EventSubscription,
  QueuedPrompt,
} from "./types"
