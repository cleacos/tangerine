import { Hono } from "hono"
import type { AppDeps } from "../app"

export function projectRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  // List all configured projects
  app.get("/", (c) => {
    return c.json(deps.config.config.projects)
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

  return app
}
