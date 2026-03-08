// Per-task OpenCode client instances. Wraps creation and lookup in Effect
// so callers get typed errors instead of thrown exceptions.

import { Effect } from "effect"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { AgentConnectionError } from "../errors"

type OpencodeClient = ReturnType<typeof createOpencodeClient>

/** Per-task OpenCode client instances, keyed by taskId */
const clients = new Map<string, OpencodeClient>()

/**
 * Returns an existing client for a task or creates a new one
 * connected to the tunneled local port.
 */
export function getOrCreateClient(
  taskId: string,
  localPort: number,
): Effect.Effect<OpencodeClient, AgentConnectionError> {
  return Effect.try({
    try: () => {
      const existing = clients.get(taskId)
      if (existing) return existing

      const client = createOpencodeClient({
        baseUrl: `http://localhost:${localPort}`,
      })

      clients.set(taskId, client)
      return client
    },
    catch: (e) =>
      new AgentConnectionError({
        message: "Failed to create OpenCode client",
        taskId,
        url: `http://localhost:${localPort}`,
        cause: e,
      }),
  })
}

/**
 * Returns the client for a task if one exists, failing with
 * AgentConnectionError when no client has been created yet.
 */
export function getClient(
  taskId: string,
): Effect.Effect<OpencodeClient, AgentConnectionError> {
  return Effect.suspend(() => {
    const existing = clients.get(taskId)
    if (existing) return Effect.succeed(existing)
    return Effect.fail(
      new AgentConnectionError({
        message: `No client exists for task ${taskId}`,
        taskId,
        url: "",
      }),
    )
  })
}

/** Remove and clean up a task's client */
export function removeClient(taskId: string): Effect.Effect<void, never> {
  return Effect.sync(() => {
    clients.delete(taskId)
  })
}

/** Check if a client exists for a task */
export function hasClient(taskId: string): Effect.Effect<boolean, never> {
  return Effect.sync(() => clients.has(taskId))
}
