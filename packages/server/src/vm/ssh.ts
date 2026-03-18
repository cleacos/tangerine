// SSH execution layer for running commands inside VMs.
// Logs commands (truncated) and connection attempts for debugging VM issues.

import { Effect } from "effect"
import { SshError, SshTimeoutError } from "../errors"
import { createLogger, truncate } from "../logger"

const log = createLogger("ssh")

export interface SshExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

export function sshExec(
  host: string,
  port: number,
  command: string,
): Effect.Effect<string, SshError> {
  return Effect.tryPromise({
    try: async () => {
      log.debug("SSH exec", { host, command: truncate(command) })

      const proc = Bun.spawn(
        ["ssh", "-o", "StrictHostKeyChecking=no", "-p", String(port), `root@${host}`, command],
        { stdout: "pipe", stderr: "pipe" },
      )

      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      const exitCode = await proc.exited

      if (exitCode !== 0) {
        log.error("SSH command failed", {
          host,
          command: truncate(command),
          exitCode,
          stderr: truncate(stderr),
        })
        throw new Error(`SSH command failed (exit ${exitCode}): ${truncate(stderr, 200)}`)
      }

      return stdout
    },
    catch: (e) => new SshError({
      message: `SSH exec failed: ${e}`,
      host,
      command,
    }),
  })
}

export function waitForSsh(
  host: string,
  port: number,
  maxAttempts: number = 30,
  intervalMs: number = 2000,
): Effect.Effect<void, SshTimeoutError> {
  return Effect.tryPromise({
    try: async () => {
      const span = log.startOp("ssh-wait", { host })

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          log.debug("Waiting for SSH", { host, attempt })
          // Run the inner effect to get the promise behavior
          await Effect.runPromise(sshExec(host, port, "echo ok"))
          span.end({ attempts: attempt })
          return
        } catch {
          if (attempt === maxAttempts) {
            const err = new Error(`SSH not available after ${maxAttempts} attempts`)
            span.fail(err)
            throw err
          }
          await new Promise((resolve) => setTimeout(resolve, intervalMs))
        }
      }
    },
    catch: () => new SshTimeoutError({
      message: `SSH not available after ${maxAttempts} attempts`,
      host,
      timeoutMs: maxAttempts * intervalMs,
    }),
  })
}

export function sshExecStreaming(
  host: string,
  port: number,
  command: string,
  onData: (chunk: string) => void,
): Effect.Effect<number, SshError> {
  return Effect.tryPromise({
    try: async () => {
      log.debug("SSH exec streaming", { host, command: truncate(command) })

      const proc = Bun.spawn(
        ["ssh", "-o", "StrictHostKeyChecking=no", "-p", String(port), `root@${host}`, command],
        { stdout: "pipe", stderr: "pipe" },
      )

      const reader = proc.stdout.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        onData(decoder.decode(value))
      }

      const exitCode = await proc.exited
      if (exitCode !== 0) {
        log.error("SSH streaming command failed", {
          host,
          command: truncate(command),
          exitCode,
        })
      }

      return exitCode
    },
    catch: (e) => new SshError({
      message: `SSH streaming exec failed: ${e}`,
      host,
      command,
    }),
  })
}
