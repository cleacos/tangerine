import { describe, test, expect } from "bun:test"
import { discoverModels, discoverClaudeCodeModels, discoverModelsByProvider } from "../models"

describe("discoverModels", () => {
  test("returns models from cache", () => {
    const models = discoverModels()
    // Should return at least some models (opencode provider is always available)
    expect(models.length).toBeGreaterThan(0)
  })

  test("each model has required fields", () => {
    const models = discoverModels()
    for (const model of models) {
      expect(model.id).toBeTruthy()
      expect(model.id).toContain("/")
      expect(model.provider).toBeTruthy()
      expect(model.name).toBeTruthy()
    }
  })

  test("includes opencode provider models", () => {
    const models = discoverModels()
    const opencodeModels = models.filter((m) => m.provider === "opencode")
    expect(opencodeModels.length).toBeGreaterThan(0)
  })

  test("model id format is provider/model", () => {
    const models = discoverModels()
    for (const model of models) {
      const parts = model.id.split("/")
      expect(parts.length).toBeGreaterThanOrEqual(2)
      expect(parts[0]).toBe(model.provider)
    }
  })
})

describe("discoverClaudeCodeModels", () => {
  test("returns claude models when ANTHROPIC_API_KEY is set", () => {
    // ANTHROPIC_API_KEY is set in test env
    const models = discoverClaudeCodeModels()
    if (process.env["ANTHROPIC_API_KEY"] || process.env["CLAUDE_CODE_OAUTH_TOKEN"]) {
      expect(models.length).toBeGreaterThan(0)
      for (const model of models) {
        expect(model.id).toMatch(/^claude-/)
        expect(model.provider).toBe("anthropic")
        expect(model.name).toBeTruthy()
      }
    } else {
      expect(models).toEqual([])
    }
  })

  test("includes known claude models", () => {
    const models = discoverClaudeCodeModels()
    if (models.length === 0) return // no credentials available
    const ids = models.map((m) => m.id)
    expect(ids).toContain("claude-opus-4-6")
    expect(ids).toContain("claude-sonnet-4-6")
    expect(ids).toContain("claude-haiku-4-5")
  })
})

describe("discoverModelsByProvider", () => {
  test("returns models grouped by provider type", () => {
    const result = discoverModelsByProvider()
    expect(result).toHaveProperty("opencode")
    expect(result).toHaveProperty("claude-code")
    expect(Array.isArray(result.opencode)).toBe(true)
    expect(Array.isArray(result["claude-code"])).toBe(true)
  })

  test("opencode models match discoverModels", () => {
    const byProvider = discoverModelsByProvider()
    const direct = discoverModels()
    expect(byProvider.opencode).toEqual(direct)
  })

  test("claude-code models match discoverClaudeCodeModels", () => {
    const byProvider = discoverModelsByProvider()
    const direct = discoverClaudeCodeModels()
    expect(byProvider["claude-code"]).toEqual(direct)
  })
})
