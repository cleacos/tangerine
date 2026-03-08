import { Effect } from "effect"
import { loadConfig } from "../config.ts"
import { getDb } from "../db/index.ts"
import { createProvider } from "../vm/providers/index.ts"
import { createPoolConfig } from "../vm/pool-config.ts"
import { VMPoolManager } from "../vm/pool.ts"
import { createLogger } from "../logger.ts"
import { printTable } from "./helpers.ts"

const log = createLogger("cli:pool")

export async function runPool(argv: string[]): Promise<void> {
  const subcommand = argv[0]

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(`
Usage: tangerine pool <subcommand>

Subcommands:
  status     Show pool status and VM list
  reconcile  Reconcile pool state with provider
`)
    process.exit(0)
  }

  switch (subcommand) {
    case "status":
      await showStatus()
      break
    case "reconcile":
      await runReconcile()
      break
    default:
      console.error(`Unknown pool subcommand: ${subcommand}`)
      process.exit(1)
  }
}

function createPool(): { pool: VMPoolManager } {
  const config = loadConfig()
  const db = getDb()
  const providerType = process.platform === "darwin" ? "lima" : "incus"
  const provider = createProvider(providerType as "lima" | "incus")
  const poolConfig = createPoolConfig(config, provider, providerType)
  const pool = new VMPoolManager(db, poolConfig)
  return { pool }
}

async function showStatus(): Promise<void> {
  const { pool } = createPool()
  const stats = Effect.runSync(pool.getPoolStats())

  console.log()
  console.log("Pool Status")
  console.log(`  Ready:        ${stats.ready}`)
  console.log(`  Assigned:     ${stats.assigned}`)
  console.log(`  Provisioning: ${stats.provisioning}`)
  console.log(`  Total:        ${stats.total}`)
  console.log()

  const vms = Effect.runSync(pool.listVms())
  const activeVms = vms.filter((vm) => vm.status !== "destroyed" && vm.status !== "error")
  if (activeVms.length === 0) {
    console.log("No active VMs")
    return
  }

  printTable(
    ["ID", "STATUS", "IP", "TASK", "PROVIDER", "CREATED"],
    activeVms.map((vm) => [
      vm.id.slice(0, 12),
      vm.status,
      vm.ip ?? "-",
      vm.task_id?.slice(0, 12) ?? "-",
      vm.provider,
      vm.created_at,
    ])
  )
}

async function runReconcile(): Promise<void> {
  const { pool } = createPool()

  console.log("Reconciling pool state with provider...")
  // Reap idle VMs as a simple reconciliation step
  const destroyed = await Effect.runPromise(pool.reapIdleVms())
  pool.ensureWarm()

  console.log()
  console.log(`Destroyed: ${destroyed}`)

  const stats = Effect.runSync(pool.getPoolStats())
  console.log()
  console.log("Pool after reconcile:")
  console.log(`  Ready:        ${stats.ready}`)
  console.log(`  Assigned:     ${stats.assigned}`)
  console.log(`  Provisioning: ${stats.provisioning}`)
  console.log(`  Total:        ${stats.total}`)

  log.info("Pool reconciled via CLI", { destroyed })
}
