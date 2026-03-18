import { Effect } from "effect"
import { Hono } from "hono"
import type { AppDeps } from "../app"
import { runEffect, runEffectVoid } from "../effect-helpers"
import { discoverModels } from "../../models"
import { projectConfigSchema, tangerineConfigSchema } from "@tangerine/shared"
import { ProjectNotFoundError, ProjectExistsError, ConfigValidationError } from "../../errors"

export function projectRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  // List all configured projects + available models from OpenCode
  app.get("/", (c) => {
    const discovered = discoverModels()
    const configModels = deps.config.config.models
    // Use discovered models if available, fall back to config
    const models = discovered.length > 0
      ? discovered.map((m) => m.id)
      : configModels

    return c.json({
      projects: deps.config.config.projects,
      model: deps.config.config.model,
      models,
    })
  })

  // Get a single project by name
  app.get("/:name", (c) => {
    const name = c.req.param("name")
    const project = deps.config.config.projects.find((p) => p.name === name)
    if (!project) {
      return c.json({ error: "Project not found" }, 404)
    }
    return c.json(project)
  })

  // Register a new project
  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    return runEffect(c,
      Effect.gen(function* () {
        // Validate the project config shape
        const parsed = projectConfigSchema.safeParse(body)
        if (!parsed.success) {
          return yield* Effect.fail(new ConfigValidationError({ message: parsed.error.message }))
        }
        const project = parsed.data

        // Check for duplicate
        if (deps.config.config.projects.some((p) => p.name === project.name)) {
          return yield* Effect.fail(new ProjectExistsError({ name: project.name }))
        }

        // Read disk config, add project, validate full config, write back
        const raw = deps.configStore.read()
        if (!raw.projects) raw.projects = []
        raw.projects.push(project as unknown as Record<string, unknown>)

        const fullParsed = tangerineConfigSchema.safeParse(raw)
        if (!fullParsed.success) {
          return yield* Effect.fail(new ConfigValidationError({ message: fullParsed.error.message }))
        }

        deps.configStore.write(raw)
        deps.config.config = fullParsed.data

        return project
      }),
      { status: 201 }
    )
  })

  // Update an existing project (name is immutable)
  app.put("/:name", async (c) => {
    const name = c.req.param("name")
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    return runEffect(c,
      Effect.gen(function* () {
        const index = deps.config.config.projects.findIndex((p) => p.name === name)
        if (index === -1) {
          return yield* Effect.fail(new ProjectNotFoundError({ name }))
        }

        // Merge fields — name is immutable
        const existing = deps.config.config.projects[index]!
        const merged = { ...existing, ...body, name }

        const parsed = projectConfigSchema.safeParse(merged)
        if (!parsed.success) {
          return yield* Effect.fail(new ConfigValidationError({ message: parsed.error.message }))
        }

        // Update disk config
        const raw = deps.configStore.read()
        const rawIndex = (raw.projects ?? []).findIndex((p) => p.name === name)
        if (rawIndex !== -1) {
          raw.projects![rawIndex] = merged as unknown as Record<string, unknown>
        }

        const fullParsed = tangerineConfigSchema.safeParse(raw)
        if (!fullParsed.success) {
          return yield* Effect.fail(new ConfigValidationError({ message: fullParsed.error.message }))
        }

        deps.configStore.write(raw)
        deps.config.config = fullParsed.data

        return parsed.data
      })
    )
  })

  // Remove a project
  app.delete("/:name", (c) => {
    const name = c.req.param("name")
    return runEffectVoid(c,
      Effect.gen(function* () {
        const index = deps.config.config.projects.findIndex((p) => p.name === name)
        if (index === -1) {
          return yield* Effect.fail(new ProjectNotFoundError({ name }))
        }

        if (deps.config.config.projects.length <= 1) {
          return yield* Effect.fail(new ConfigValidationError({ message: "Cannot remove the last project" }))
        }

        // Update disk config
        const raw = deps.configStore.read()
        raw.projects = (raw.projects ?? []).filter((p) => p.name !== name)

        const fullParsed = tangerineConfigSchema.safeParse(raw)
        if (!fullParsed.success) {
          return yield* Effect.fail(new ConfigValidationError({ message: fullParsed.error.message }))
        }

        deps.configStore.write(raw)
        deps.config.config = fullParsed.data
      })
    )
  })

  return app
}
