import { z } from "zod"

export const previewConfigSchema = z.object({
  port: z.number().optional(),
  path: z.string().default("/"),
})

export const projectConfigSchema = z.object({
  name: z.string(),
  repo: z.string(),
  defaultBranch: z.string().default("main"),
  image: z.string(),
  setup: z.string(),
  preview: previewConfigSchema.optional(),
  test: z.string().optional(),
  env: z.record(z.string()).optional(),
  model: z.string().optional(),
})

export const githubTriggerSchema = z.object({
  type: z.enum(["label", "assignee"]),
  value: z.string(),
})

export const githubIntegrationSchema = z.object({
  webhookSecret: z.string().optional(),
  pollIntervalMinutes: z.number().default(60),
  trigger: githubTriggerSchema,
})

export const integrationsSchema = z.object({
  github: githubIntegrationSchema.optional(),
})

export const tangerineConfigSchema = z.object({
  // Multi-project: accepts either singular `project` or `projects[]` for backward compat
  project: projectConfigSchema.optional(),
  projects: z.array(projectConfigSchema).optional(),
  model: z.string().default("anthropic/claude-sonnet-4-20250514"),
  integrations: integrationsSchema.optional(),
}).transform((val) => {
  // Normalize: always produce projects[] from either form
  let projects: z.infer<typeof projectConfigSchema>[]
  if (val.projects && val.projects.length > 0) {
    projects = val.projects
  } else if (val.project) {
    projects = [val.project]
  } else {
    throw new Error("Config must have either 'project' or 'projects'")
  }
  return { ...val, projects }
}).pipe(z.object({
  projects: z.array(projectConfigSchema).min(1),
  model: z.string(),
  integrations: integrationsSchema.optional(),
}))

export type PreviewConfig = z.infer<typeof previewConfigSchema>
export type ProjectConfig = z.infer<typeof projectConfigSchema>
export type TangerineConfig = z.infer<typeof tangerineConfigSchema>
