// Bridge between Effect programs and Hono HTTP responses.
// Routes call runEffect/runEffectVoid to unwrap Effect at the HTTP boundary,
// mapping tagged errors to appropriate status codes automatically.

import { Effect, Exit, Cause, Option } from "effect"
import type { Context as HonoContext } from "hono"

const DEFAULT_ERROR_MAP: Record<string, number> = {
  TaskNotFoundError: 404,
  VmNotFoundError: 404,
  PoolExhaustedError: 503,
  AgentError: 502,
  AgentConnectionError: 502,
}

/**
 * Runs an Effect and returns a JSON response, mapping tagged errors to HTTP status codes.
 * Use for GET routes and POST routes that return data.
 */
export function runEffect<A, E extends { _tag: string; message?: string }>(
  c: HonoContext,
  effect: Effect.Effect<A, E>,
  options?: {
    status?: number
    errorMap?: Record<string, number>
  }
): Promise<Response> {
  const errorMap = { ...DEFAULT_ERROR_MAP, ...options?.errorMap }

  return Effect.runPromiseExit(effect).then((exit) => {
    if (Exit.isSuccess(exit)) {
      return c.json(exit.value as object, options?.status ?? 200)
    }

    const failure = Cause.failureOption(exit.cause)
    if (Option.isSome(failure)) {
      const error = failure.value
      const status = errorMap[error._tag] ?? 500
      return c.json({ error: error.message ?? error._tag }, status)
    }

    // Defect (unexpected throw or die) — don't leak internals
    return c.json({ error: "Internal server error" }, 500)
  })
}

/**
 * Runs a void Effect and returns { ok: true } on success.
 * Use for POST action routes (cancel, abort, etc.) that don't return data.
 */
export function runEffectVoid<E extends { _tag: string; message?: string }>(
  c: HonoContext,
  effect: Effect.Effect<void, E>,
  options?: {
    status?: number
    errorMap?: Record<string, number>
  }
): Promise<Response> {
  return runEffect(
    c,
    Effect.map(effect, () => ({ ok: true as const })),
    options
  )
}
