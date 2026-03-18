// Session lifecycle: provision VM, clone repo, start OpenCode, establish tunnels.
// Each step is logged so an AI agent can reconstruct failures from taskId alone.

import { Effect } from "effect"
import { createLogger } from "../logger"
import { SessionStartError } from "../errors"
import type { TaskRow, VmRow } from "../db/types"
import type { SessionTunnel } from "../vm/tunnel"

const log = createLogger("lifecycle")

export interface SessionInfo {
  vmId: string
  opencodeSessionId: string
  opencodePort: number
  previewPort: number
  branch: string
}

export interface LifecycleDeps {
  acquireVm(taskId: string): Effect.Effect<VmRow, import("../errors").PoolExhaustedError | import("../errors").ProviderError | Error>
  sshExec(host: string, port: number, command: string): Effect.Effect<{ stdout: string; stderr: string; exitCode: number }, import("../errors").SshError>
  waitForSsh(host: string, port: number): Effect.Effect<void, import("../errors").SshTimeoutError>
  copyAuthJson(host: string, port: number, authJsonPath: string): Effect.Effect<void, import("../errors").SshError>
  injectCredentials(host: string, port: number, credentials: Record<string, string>): Effect.Effect<void, import("../errors").SshError>
  createTunnel(vmIp: string, sshPort: number, ports: { opencodeVmPort: number; previewVmPort: number }): Effect.Effect<SessionTunnel, import("../errors").TunnelError>
  createOpencodeSession(opencodePort: number, title: string): Effect.Effect<string, import("../errors").AgentError>
  waitForHealth(opencodePort: number): Effect.Effect<void, import("../errors").HealthCheckError>
  updateTask(taskId: string, updates: Partial<TaskRow>): Effect.Effect<void, Error>
  logActivity(taskId: string, type: "lifecycle" | "system", event: string, content: string, metadata?: Record<string, unknown>): Effect.Effect<unknown, Error>
}

export interface ProjectConfig {
  repo: string
  defaultBranch?: string
  setup: string
  preview: { port: number }
}

export interface CredentialConfig {
  opencodeAuthPath: string | null
  anthropicApiKey: string | null
  githubToken: string | null
}

export function startSession(
  task: TaskRow,
  config: ProjectConfig,
  creds: CredentialConfig,
  deps: LifecycleDeps,
): Effect.Effect<SessionInfo, SessionStartError> {
  // Log activity for a task, swallowing errors so logging never breaks the lifecycle
  const activity = (event: string, content: string, metadata?: Record<string, unknown>) =>
    deps.logActivity(task.id, "lifecycle", event, content, metadata).pipe(Effect.catchAll(() => Effect.void))

  return Effect.gen(function* () {
    const taskLog = log.child({ taskId: task.id })
    const sessionSpan = taskLog.startOp("session-start")

    // Acquire a VM from the warm pool (or provision a new one)
    taskLog.info("Acquiring VM")
    yield* activity("vm.acquiring", "Acquiring VM from pool")
    const vm = yield* deps.acquireVm(task.id).pipe(
      Effect.tapError((e) => activity("vm.acquire_failed", `VM acquisition failed: ${e.message}`)),
      Effect.mapError((e) => new SessionStartError({
        message: `VM acquisition failed: ${e.message}`,
        taskId: task.id,
        phase: "vm-acquire",
        cause: e,
      }))
    )
    const vmLog = taskLog.child({ vmId: vm.id })
    yield* activity("vm.acquired", `VM acquired: ${vm.id}`, { vmId: vm.id, ip: vm.ip, sshPort: vm.ssh_port })

    yield* deps.updateTask(task.id, { vm_id: vm.id, status: "provisioning" }).pipe(
      Effect.mapError((e) => new SessionStartError({
        message: e.message,
        taskId: task.id,
        phase: "db-update",
        cause: e,
      }))
    )

    // Wait for SSH to become available
    const sshSpan = vmLog.startOp("ssh-connect")
    yield* activity("ssh.waiting", `Waiting for SSH on ${vm.ip}:${vm.ssh_port}`, { vmId: vm.id })
    yield* deps.waitForSsh(vm.ip!, vm.ssh_port!).pipe(
      Effect.tap(() => Effect.sync(() => sshSpan.end())),
      Effect.tap(() => activity("ssh.ready", "SSH connection established", { vmId: vm.id })),
      Effect.tapError((e) => activity("ssh.failed", `SSH connection failed: ${e.message}`, { vmId: vm.id, error: e.message })),
      Effect.tapError((e) => Effect.sync(() => sshSpan.fail(e))),
      Effect.mapError((e) => new SessionStartError({
        message: e.message,
        taskId: task.id,
        phase: "ssh-wait",
        cause: e,
      }))
    )

    // Copy OpenCode auth.json to VM (inherits host's LLM credentials — API keys or OAuth)
    if (creds.opencodeAuthPath) {
      vmLog.debug("Copying OpenCode auth.json to VM")
      yield* deps.copyAuthJson(vm.ip!, vm.ssh_port!, creds.opencodeAuthPath).pipe(
        Effect.mapError((e) => new SessionStartError({
          message: `auth.json copy failed: ${e.message}`,
          taskId: task.id,
          phase: "inject-creds",
          cause: e,
        }))
      )
    }

    // Inject environment credentials (GitHub token, fallback API key if no auth.json)
    vmLog.debug("Injecting credentials")
    const envCreds: Record<string, string> = {}
    if (creds.githubToken) {
      envCreds.GITHUB_TOKEN = creds.githubToken
      envCreds.GH_TOKEN = creds.githubToken
    }
    if (!creds.opencodeAuthPath && creds.anthropicApiKey) {
      envCreds.ANTHROPIC_API_KEY = creds.anthropicApiKey
    }
    if (Object.keys(envCreds).length > 0) {
      yield* deps.injectCredentials(vm.ip!, vm.ssh_port!, envCreds).pipe(
        Effect.mapError((e) => new SessionStartError({
          message: `Credential injection failed: ${e.message}`,
          taskId: task.id,
          phase: "inject-creds",
          cause: e,
        }))
      )
    }
    vmLog.debug("Credentials injected")

    // Ensure /workspace exists (may be missing if golden image provisioning partially failed)
    yield* deps.sshExec(
      vm.ip!,
      vm.ssh_port!,
      `mkdir -p /workspace`,
    ).pipe(Effect.catchAll(() => Effect.void))

    // Clone or update the repository
    const defaultBranch = config.defaultBranch ?? "main"
    const cloneSpan = vmLog.startOp("clone-repo", { repo: task.repo_url })
    yield* activity("repo.cloning", `Cloning ${task.repo_url}`, { repo: task.repo_url, defaultBranch })
    yield* deps.sshExec(
      vm.ip!,
      vm.ssh_port!,
      `if [ -d /workspace/repo/.git ]; then
        cd /workspace/repo && git fetch origin && git reset --hard origin/${defaultBranch}
      else
        git clone ${task.repo_url} /workspace/repo
      fi`,
    ).pipe(
      Effect.tap(() => activity("repo.cloned", "Repository ready", { repo: task.repo_url })),
      Effect.tap(() => Effect.sync(() => cloneSpan.end({ repo: task.repo_url }))),
      Effect.tapError((e) => activity("repo.clone_failed", `Clone failed: ${e.message}`, { repo: task.repo_url, error: e.message })),
      Effect.tapError((e) => Effect.sync(() => cloneSpan.fail(e, { repo: task.repo_url }))),
      Effect.mapError((e) => new SessionStartError({
        message: `Clone failed: ${e.message}`,
        taskId: task.id,
        phase: "clone-repo",
        cause: e,
      }))
    )

    // Create a working branch for this task
    const branch = `tangerine/${task.id.slice(0, 8)}`
    yield* deps.sshExec(
      vm.ip!,
      vm.ssh_port!,
      `cd /workspace/repo && git checkout -b ${branch}`,
    ).pipe(
      Effect.mapError((e) => new SessionStartError({
        message: `Branch creation failed: ${e.message}`,
        taskId: task.id,
        phase: "create-branch",
        cause: e,
      }))
    )
    vmLog.debug("Branch created", { branch })

    yield* deps.updateTask(task.id, { branch }).pipe(
      Effect.mapError((e) => new SessionStartError({
        message: e.message,
        taskId: task.id,
        phase: "db-update",
        cause: e,
      }))
    )

    // Run project-specific setup
    const setupSpan = vmLog.startOp("setup")
    yield* activity("setup.started", `Running setup: ${config.setup}`, { command: config.setup })
    yield* deps.sshExec(vm.ip!, vm.ssh_port!, `cd /workspace/repo && ${config.setup}`).pipe(
      Effect.tap(() => activity("setup.completed", "Setup completed")),
      Effect.tap(() => Effect.sync(() => setupSpan.end())),
      Effect.tapError((e) => activity("setup.failed", `Setup failed: ${e.message}`, { error: e.message, command: config.setup })),
      Effect.tapError((e) => Effect.sync(() => setupSpan.fail(e))),
      Effect.mapError((e) => new SessionStartError({
        message: `Setup failed: ${e.message}`,
        taskId: task.id,
        phase: "setup",
        cause: e,
      }))
    )

    // Start OpenCode server inside the VM (fire-and-forget — SSH hangs if we wait for a backgrounded process)
    yield* Effect.tryPromise({
      try: async () => {
        Bun.spawn(
          ["ssh", "-o", "StrictHostKeyChecking=no", "-p", String(vm.ssh_port!), `root@${vm.ip!}`,
           "cd /workspace/repo && opencode serve --port 4096 --hostname 0.0.0.0 > /tmp/opencode.log 2>&1"],
          { stdout: "ignore", stderr: "ignore", stdin: "ignore" },
        )
        // Give it a moment to start
        await new Promise((r) => setTimeout(r, 1000))
      },
      catch: (e) => new SessionStartError({
        message: `OpenCode start failed: ${e}`,
        taskId: task.id,
        phase: "start-opencode",
        cause: e instanceof Error ? e : new Error(String(e)),
      }),
    })
    vmLog.info("OpenCode started")
    yield* activity("opencode.started", "OpenCode server started on VM")

    // Establish SSH tunnels for OpenCode API and preview
    const tunnel = yield* deps.createTunnel(vm.ip!, vm.ssh_port!, {
      opencodeVmPort: 4096,
      previewVmPort: config.preview.port,
    }).pipe(
      Effect.mapError((e) => new SessionStartError({
        message: `Tunnel creation failed: ${e.message}`,
        taskId: task.id,
        phase: "create-tunnel",
        cause: e,
      }))
    )
    vmLog.info("Tunnel established", {
      opencodePort: tunnel.opencodePort,
      previewPort: tunnel.previewPort,
    })

    yield* deps.updateTask(task.id, {
      opencode_port: tunnel.opencodePort,
      preview_port: tunnel.previewPort,
    }).pipe(
      Effect.mapError((e) => new SessionStartError({
        message: e.message,
        taskId: task.id,
        phase: "db-update",
        cause: e,
      }))
    )

    // Wait for OpenCode to become healthy before creating a session
    const healthSpan = vmLog.startOp("opencode-health-wait")
    yield* deps.waitForHealth(tunnel.opencodePort).pipe(
      Effect.tap(() => Effect.sync(() => healthSpan.end())),
      Effect.tapError((e) => Effect.sync(() => healthSpan.fail(e))),
      Effect.mapError((e) => new SessionStartError({
        message: `Health check failed: ${e.message}`,
        taskId: task.id,
        phase: "health-check",
        cause: e,
      }))
    )

    // Create an OpenCode session for this task
    const opencodeSessionId = yield* deps.createOpencodeSession(
      tunnel.opencodePort,
      task.title,
    ).pipe(
      Effect.mapError((e) => new SessionStartError({
        message: `Session creation failed: ${e.message}`,
        taskId: task.id,
        phase: "create-session",
        cause: e,
      }))
    )

    yield* deps.updateTask(task.id, {
      opencode_session_id: opencodeSessionId,
      status: "running",
      started_at: new Date().toISOString(),
    }).pipe(
      Effect.mapError((e) => new SessionStartError({
        message: e.message,
        taskId: task.id,
        phase: "db-update",
        cause: e,
      }))
    )

    yield* activity("session.ready", `Session ready: ${opencodeSessionId}`, {
      vmId: vm.id, opencodeSessionId,
      opencodePort: tunnel.opencodePort, previewPort: tunnel.previewPort, branch,
    })
    vmLog.info("Session ready", { opencodeSessionId })
    sessionSpan.end({ vmId: vm.id, opencodeSessionId })

    return {
      vmId: vm.id,
      opencodeSessionId,
      opencodePort: tunnel.opencodePort,
      previewPort: tunnel.previewPort,
      branch,
    }
  })
}
