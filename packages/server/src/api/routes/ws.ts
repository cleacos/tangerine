import { Effect } from "effect"
import { Hono } from "hono"
import { createBunWebSocket } from "hono/bun"
import type { AppDeps } from "../app"
import { getTask } from "../../db/queries"
import type { WsClientMessage, WsServerMessage, TaskStatus } from "@tangerine/shared"

export interface WsSetup {
  routes: Hono
  websocket: ReturnType<typeof createBunWebSocket>["websocket"]
}

/**
 * Creates WebSocket routes and returns both the Hono routes and the
 * Bun websocket handler (needed by Bun.serve).
 */
export function wsRoutes(deps: AppDeps): WsSetup {
  const app = new Hono()
  const { upgradeWebSocket, websocket } = createBunWebSocket()

  app.get(
    "/:id/ws",
    upgradeWebSocket((c) => {
      const taskId = c.req.param("id")!

      // Store unsubscribe functions so we can clean up on close
      let unsubEvent: (() => void) | null = null
      let unsubStatus: (() => void) | null = null

      return {
        onOpen(_event, ws) {
          // Run Effect-based getTask inside callback via runPromise
          Effect.runPromise(getTask(deps.db, taskId)).then(
            (_task) => {
              // Confirm connection
              const connected: WsServerMessage = { type: "connected" }
              ws.send(JSON.stringify(connected))

              // Relay agent events to this client
              unsubEvent = deps.taskManager.onTaskEvent(taskId, (data: unknown) => {
                const msg: WsServerMessage = { type: "event", data }
                try {
                  ws.send(JSON.stringify(msg))
                } catch {
                  // Client disconnected
                }
              })

              // Relay status changes to this client
              unsubStatus = deps.taskManager.onStatusChange(taskId, (status) => {
                const msg: WsServerMessage = { type: "status", status: status as TaskStatus }
                try {
                  ws.send(JSON.stringify(msg))
                } catch {
                  // Client disconnected
                }
              })
            },
            () => {
              const msg: WsServerMessage = { type: "error", message: "Task not found" }
              ws.send(JSON.stringify(msg))
              ws.close(1008, "Task not found")
            }
          )
        },

        onMessage(event, ws) {
          let parsed: WsClientMessage
          try {
            const raw = typeof event.data === "string" ? event.data : event.data.toString()
            parsed = JSON.parse(raw) as WsClientMessage
          } catch {
            const msg: WsServerMessage = { type: "error", message: "Invalid JSON" }
            ws.send(JSON.stringify(msg))
            return
          }

          if (parsed.type === "prompt" && parsed.text) {
            Effect.runPromise(
              deps.taskManager.sendPrompt(taskId, parsed.text)
            ).catch((err: unknown) => {
              const message = err instanceof Error ? err.message : String(err)
              const msg: WsServerMessage = { type: "error", message }
              try {
                ws.send(JSON.stringify(msg))
              } catch {
                // Client disconnected
              }
            })
          } else if (parsed.type === "abort") {
            Effect.runPromise(
              deps.taskManager.abortTask(taskId)
            ).catch((err: unknown) => {
              const message = err instanceof Error ? err.message : String(err)
              const msg: WsServerMessage = { type: "error", message }
              try {
                ws.send(JSON.stringify(msg))
              } catch {
                // Client disconnected
              }
            })
          }
        },

        onClose() {
          unsubEvent?.()
          unsubStatus?.()
        },
      }
    })
  )

  return { routes: app, websocket }
}
