// CLI entrypoint: loads config, initializes subsystems, starts the server.
// Logs startup sequence so boot failures are diagnosable.

import { createLogger } from "../logger"
import { loadConfig } from "../config"
import { getDb } from "../db/index"
import { VMPoolManager } from "../vm/pool"
import { createApp } from "../api/app"
import type { AppDeps } from "../api/app"
import { DEFAULT_API_PORT } from "@tangerine/shared"
import { TANGERINE_HOME } from "../config"

const log = createLogger("cli")

export async function start(): Promise<void> {
  const startSpan = log.startOp("server-start")

  try {
    const config = loadConfig()
    const projectNames = config.config.projects.map((p) => p.name)
    log.info("Config loaded", { projects: projectNames, home: TANGERINE_HOME })

    const db = getDb()
    log.info("Database initialized")

    const pool = new VMPoolManager(db, { slots: [] })

    // TODO: wire real task manager deps
    const deps: AppDeps = {
      db,
      taskManager: {
        createTask: () => { throw new Error("not implemented") },
        cancelTask: () => { throw new Error("not implemented") },
        completeTask: () => { throw new Error("not implemented") },
        sendPrompt: () => { throw new Error("not implemented") },
        abortTask: () => { throw new Error("not implemented") },
        onTaskEvent: () => () => {},
        onStatusChange: () => () => {},
      },
      pool,
      config,
    }

    const { app, websocket } = createApp(deps)
    const port = Number(process.env.PORT ?? DEFAULT_API_PORT)

    log.info("Server starting", { port })

    const hostname = process.env.HOST ?? "0.0.0.0"

    Bun.serve({
      hostname,
      port,
      fetch: app.fetch,
      websocket,
    })

    startSpan.end({ port, projects: projectNames })

    const shutdown = async (signal: string) => {
      log.info("Shutdown signal received", { signal })
      process.exit(0)
    }

    process.on("SIGINT", () => shutdown("SIGINT"))
    process.on("SIGTERM", () => shutdown("SIGTERM"))
  } catch (err) {
    startSpan.fail(err)
    process.exit(1)
  }
}

// Run if invoked directly
if (import.meta.main) {
  start()
}
