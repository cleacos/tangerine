import { Hono } from "hono"
import type { AppDeps } from "../app"
import { runEffect } from "../effect-helpers"

export function systemRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  // Health check is pure — no Effect needed
  app.get("/health", (c) => {
    return c.json({ status: "ok", uptime: process.uptime() })
  })

  app.get("/pool", (c) => {
    return runEffect(c, deps.pool.getPoolStats())
  })

  return app
}
