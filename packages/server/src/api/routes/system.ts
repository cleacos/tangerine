import { Effect } from "effect"
import { Hono } from "hono"
import type { AppDeps } from "../app"
import { runEffect } from "../effect-helpers"
import { listVms, listImages } from "../../db/queries"

export function systemRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  app.get("/health", (c) => {
    return c.json({ status: "ok", uptime: process.uptime() })
  })

  app.get("/pool", (c) => {
    return runEffect(c, deps.pool.getPoolStats())
  })

  app.get("/vms", (c) => {
    return runEffect(c,
      listVms(deps.db).pipe(
        Effect.map((rows) => rows.map((r) => ({
          id: r.id,
          status: r.status,
          ip: r.ip,
          taskId: r.task_id,
          provider: r.provider,
          createdAt: r.created_at,
        })))
      )
    )
  })

  // Returns the latest golden image for a project (or all if no project)
  app.get("/images", (c) => {
    const project = c.req.query("project") || undefined
    return runEffect(c,
      listImages(deps.db).pipe(
        Effect.map((rows) => {
          const mapped = rows.map((r) => ({
            id: r.id,
            name: r.name,
            provider: r.provider,
            snapshotId: r.snapshot_id,
            createdAt: r.created_at,
          }))

          if (!project) return mapped

          // Match by project's configured image name, return only the latest
          const projectConfig = deps.config.config.projects.find((p) => p.name === project)
          if (!projectConfig) return []

          const matching = mapped
            .filter((r) => r.name === projectConfig.image)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

          return matching.slice(0, 1)
        })
      )
    )
  })

  return app
}
