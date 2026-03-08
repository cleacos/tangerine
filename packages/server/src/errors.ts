import { Data } from "effect"

export class DbError extends Data.TaggedError("DbError")<{ message: string; cause?: unknown }> {}
export class SshError extends Data.TaggedError("SshError")<{ message: string; host: string; command?: string; exitCode?: number; cause?: unknown }> {}
export class SshTimeoutError extends Data.TaggedError("SshTimeoutError")<{ message: string; host: string; timeoutMs: number }> {}
export class TunnelError extends Data.TaggedError("TunnelError")<{ message: string; vmIp: string; cause?: unknown }> {}
export class ProviderError extends Data.TaggedError("ProviderError")<{ message: string; provider: string; operation: string; cause?: unknown }> {}
export class VmNotFoundError extends Data.TaggedError("VmNotFoundError")<{ vmId: string }> {}
export class TaskNotFoundError extends Data.TaggedError("TaskNotFoundError")<{ taskId: string }> {}
export class PoolExhaustedError extends Data.TaggedError("PoolExhaustedError")<{ message: string; maxPoolSize: number }> {}
export class SessionStartError extends Data.TaggedError("SessionStartError")<{ message: string; taskId: string; phase: string; cause?: unknown }> {}
export class SessionCleanupError extends Data.TaggedError("SessionCleanupError")<{ message: string; taskId: string; cause?: unknown }> {}
export class AgentError extends Data.TaggedError("AgentError")<{ message: string; taskId: string; cause?: unknown }> {}
export class AgentConnectionError extends Data.TaggedError("AgentConnectionError")<{ message: string; taskId: string; url: string; cause?: unknown }> {}
export class PromptError extends Data.TaggedError("PromptError")<{ message: string; taskId: string; cause?: unknown }> {}
export class GitHubPollError extends Data.TaggedError("GitHubPollError")<{ message: string; statusCode?: number; cause?: unknown }> {}
export class HealthCheckError extends Data.TaggedError("HealthCheckError")<{ message: string; taskId: string; reason: "tunnel_dead" | "opencode_dead" | "vm_dead" }> {}
