// Periodic orphan cleanup: finds terminal tasks with worktree_path still set
// and cleans them up. Safety net for crashes, SSH failures, or bugs in
// transition hooks. Modeled after Orange's cleanupOrphans().

import { Effect, Schedule } from "effect"
import { createLogger } from "../logger"
import type { TaskRow } from "../db/types"
import type { CleanupDeps } from "./cleanup"
import { cleanupSession } from "./cleanup"

const log = createLogger("orphan-cleanup")

const CLEANUP_INTERVAL_MS = 30_000

export interface OrphanCleanupDeps {
  listTasks(filter?: { status?: string }): Effect.Effect<TaskRow[], Error>
  cleanupDeps: CleanupDeps
}

/** Find terminal tasks that still have a worktree_path — these are orphans. */
export function findOrphans(
  deps: OrphanCleanupDeps,
): Effect.Effect<TaskRow[], Error> {
  return Effect.gen(function* () {
    const terminal = ["done", "failed", "cancelled"]
    const allTerminal: TaskRow[] = []
    for (const status of terminal) {
      const tasks = yield* deps.listTasks({ status })
      allTerminal.push(...tasks)
    }
    return allTerminal.filter((t) => t.worktree_path)
  })
}

/** Clean up orphaned worktrees for terminal tasks. Returns count cleaned. */
export function cleanupOrphans(
  deps: OrphanCleanupDeps,
): Effect.Effect<number, never> {
  return Effect.gen(function* () {
    const orphans = yield* findOrphans(deps).pipe(
      Effect.catchAll(() => Effect.succeed([] as TaskRow[]))
    )

    if (orphans.length === 0) return 0

    log.info("Found orphaned worktrees", { count: orphans.length })

    let cleaned = 0
    for (const task of orphans) {
      const taskLog = log.child({ taskId: task.id, worktree: task.worktree_path })

      // cleanupSession clears worktree_path in the DB after cleanup
      yield* cleanupSession(task.id, deps.cleanupDeps).pipe(
        Effect.tap(() => Effect.sync(() => {
          taskLog.info("Orphaned worktree cleaned")
        })),
        Effect.ignoreLogged,
      )

      cleaned++
    }

    log.info("Orphan cleanup complete", { cleaned })
    return cleaned
  })
}

/** Start a repeating orphan cleanup loop as a background fiber. */
export function startOrphanCleanup(
  deps: OrphanCleanupDeps,
): Effect.Effect<void, never> {
  return cleanupOrphans(deps).pipe(
    Effect.repeat(Schedule.fixed(`${CLEANUP_INTERVAL_MS} millis`)),
    Effect.catchAll(() => Effect.void),
    Effect.asVoid,
    Effect.fork,
    Effect.asVoid,
  )
}
