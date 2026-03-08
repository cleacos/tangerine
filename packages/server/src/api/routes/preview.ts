import { Effect } from "effect"
import { Hono } from "hono"
import type { AppDeps } from "../app"
import { getTask } from "../../db/queries"
import { runEffect } from "../effect-helpers"

export function previewRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  // Proxy all methods to the task's preview port
  app.all("/:id/*", async (c) => {
    const id = c.req.param("id")

    return runEffect(c,
      Effect.gen(function* () {
        const task = yield* getTask(deps.db, id)

        if (!task.preview_port) {
          return yield* Effect.fail({
            _tag: "AgentError" as const,
            message: "No preview available for this task",
            taskId: task.id,
          })
        }

        // Strip the /preview/:id prefix to get the downstream path
        const url = new URL(c.req.url)
        const prefix = `/preview/${id}`
        const downstreamPath = url.pathname.slice(prefix.length) || "/"
        const target = `http://localhost:${task.preview_port}${downstreamPath}${url.search}`

        const headers = new Headers(c.req.raw.headers)
        headers.set("Host", `localhost:${task.preview_port}`)
        // Remove hop-by-hop headers that shouldn't be forwarded
        headers.delete("connection")
        headers.delete("keep-alive")

        const response = yield* Effect.tryPromise({
          try: () => fetch(target, {
            method: c.req.method,
            headers,
            body: c.req.method !== "GET" && c.req.method !== "HEAD" ? c.req.raw.body : undefined,
          }),
          catch: () => ({
            _tag: "AgentError" as const,
            message: "Preview service unavailable",
            taskId: id,
          }),
        })

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        })
      }),
      { errorMap: { AgentError: 502 } }
    )
  })

  return app
}
