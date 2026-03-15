import { existsSync, readFileSync, mkdirSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { tangerineConfigSchema } from "@tangerine/shared"
import type { TangerineConfig, ProjectConfig } from "@tangerine/shared"

export const TANGERINE_HOME = join(homedir(), "tangerine")

/** Path to OpenCode's credential store on the host */
export const OPENCODE_AUTH_PATH = join(homedir(), ".local", "share", "opencode", "auth.json")

/** Path where auth.json is placed inside the VM */
export const VM_AUTH_PATH = "/home/agent/.local/share/opencode/auth.json"

export interface AppConfig {
  config: TangerineConfig
  credentials: {
    opencodeAuthPath: string | null
    anthropicApiKey: string | null
    githubToken: string | null
    ghHost: string
  }
}

/** Reads and parses a JSON config file, returning null if it doesn't exist */
function readConfigFile(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null
  const raw = readFileSync(path, "utf-8")
  return JSON.parse(raw) as Record<string, unknown>
}

/** Resolve a project config by name */
export function getProjectConfig(config: TangerineConfig, projectId: string): ProjectConfig | undefined {
  return config.projects.find((p) => p.name === projectId)
}

/**
 * Loads config from ~/tangerine/config.json (primary) with fallback to
 * legacy locations (~/.config/tangerine/config.json, .tangerine/config.json).
 * Validates with Zod and resolves credentials.
 */
export function loadConfig(): AppConfig {
  // Ensure ~/tangerine/ exists
  mkdirSync(TANGERINE_HOME, { recursive: true })

  const centralPath = join(TANGERINE_HOME, "config.json")
  const legacyGlobalPath = join(homedir(), ".config", "tangerine", "config.json")
  const legacyProjectPath = join(process.cwd(), ".tangerine", "config.json")

  // Try central config first, fall back to legacy locations
  let raw: Record<string, unknown> | null = readConfigFile(centralPath)
  if (!raw) {
    const legacyGlobal = readConfigFile(legacyGlobalPath) ?? {}
    const legacyProject = readConfigFile(legacyProjectPath) ?? {}
    raw = { ...legacyGlobal, ...legacyProject }
  }

  const config = tangerineConfigSchema.parse(raw)

  const opencodeAuthPath = existsSync(OPENCODE_AUTH_PATH) ? OPENCODE_AUTH_PATH : null
  const anthropicApiKey = process.env["ANTHROPIC_API_KEY"] ?? null

  if (!opencodeAuthPath && !anthropicApiKey) {
    throw new Error(
      "No LLM credentials found. Either run `opencode auth login` to set up auth, " +
      "or set the ANTHROPIC_API_KEY environment variable.",
    )
  }

  return {
    config,
    credentials: {
      opencodeAuthPath,
      anthropicApiKey,
      githubToken: process.env["GITHUB_TOKEN"] ?? null,
      ghHost: process.env["GH_HOST"] ?? "github.com",
    },
  }
}
