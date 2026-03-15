import type { AppConfig } from "../config.ts"
import type { PoolConfig } from "./pool-types.ts"
import type { Provider } from "./providers/types.ts"
import { goldenVmName } from "../image/build.ts"
import {
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_MIN_READY,
  DEFAULT_MAX_POOL_SIZE,
} from "@tangerine/shared"

/**
 * Creates pool config from app config and a provider instance.
 * Generates one pool slot per project, each using its own golden image.
 */
export function createPoolConfig(config: AppConfig, provider: Provider, providerName: string): PoolConfig {
  const slots = config.config.projects.map((project) => ({
    name: `${providerName}-${project.name}`,
    provider,
    snapshotId: `clone:${goldenVmName(project.image)}`,
    region: "local",
    plan: "4cpu-8gb-20gb",
    maxPoolSize: DEFAULT_MAX_POOL_SIZE,
    priority: 1,
    idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
    minReady: DEFAULT_MIN_READY,
  }))

  return {
    slots,
    labelPrefix: "tangerine",
  }
}
