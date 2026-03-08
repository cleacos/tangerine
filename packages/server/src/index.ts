import { Effect } from "effect"
import { DEFAULT_API_PORT } from "@tangerine/shared"
import { loadConfig } from "./config"
import { getDb } from "./db/index"
import { VMPoolManager } from "./vm/pool"
import { TaskManager } from "./tasks/manager"
import { createApp } from "./api/app"
import { createGitHubPoller } from "./integrations/github"
import { createLogger } from "./logger"

const log = createLogger("main")

// Startup wrapped in Effect to establish the pattern for future async init steps
const program = Effect.sync(() => {
  const config = loadConfig()
  const db = getDb()

  // VM pool with empty slots for now — providers are configured per-project
  const pool = new VMPoolManager(db, { slots: [] })

  const taskManager = new TaskManager(db, pool, config)

  const { app, websocket } = createApp({ db, taskManager, pool, config })

  // Start GitHub poller if configured
  const ghPoller = createGitHubPoller(db, taskManager, config)
  if (ghPoller) {
    ghPoller.start()
    log.info("GitHub issue poller started")
  }

  const server = Bun.serve({
    port: DEFAULT_API_PORT,
    fetch: app.fetch,
    websocket,
  })

  log.info("Server started", { port: server.port, project: config.config.project.name })
})

Effect.runPromise(program).catch((err) => {
  log.error("Startup failed", { error: err instanceof Error ? err.message : String(err) })
  process.exit(1)
})
