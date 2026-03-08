import { describe, it, expect, beforeEach, mock, afterEach, spyOn } from "bun:test"
import { Effect } from "effect"
import { pollGitHubIssues, type GitHubDeps } from "../integrations/github"
/** Local ProjectConfig type matching github module's interface */
interface ProjectConfig {
  repo: string
  integrations?: {
    github?: {
      trigger: {
        type: "label" | "assignee"
        value: string
      }
    }
  }
}

/**
 * Tracer bullet: GitHub API response -> Task creation -> Deduplication
 *
 * Tests the GitHub polling integration: parsing issues, filtering by
 * trigger, creating tasks, deduplicating by sourceId, and handling
 * API errors. Mocks global fetch to simulate GitHub API responses.
 */

interface MockGitHubIssue {
  number: number
  title: string
  body: string | null
  html_url: string
  labels: Array<{ name: string }>
  assignee: { login: string } | null
}

function makeIssue(num: number, overrides?: Partial<MockGitHubIssue>): MockGitHubIssue {
  return {
    number: num,
    title: `Issue #${num}`,
    body: `Body for issue ${num}`,
    html_url: `https://github.com/test/repo/issues/${num}`,
    labels: [],
    assignee: { login: "bot" },
    ...overrides,
  }
}

function makeConfig(trigger: { type: "label" | "assignee"; value: string }): ProjectConfig {
  return {
    repo: "test/repo",
    integrations: {
      github: {
        trigger,
      },
    },
  }
}

describe("tracer: github polling -> task creation -> dedup", () => {
  let createdTasks: Array<{ sourceId: string; title: string; description: string }>
  let existingSourceIds: Set<string>
  let deps: GitHubDeps
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    createdTasks = []
    existingSourceIds = new Set()

    deps = {
      createTask(params) {
        createdTasks.push({
          sourceId: params.sourceId,
          title: params.title,
          description: params.description,
        })
        existingSourceIds.add(params.sourceId)
      },
      isTaskExists(sourceId: string) {
        return existingSourceIds.has(sourceId)
      },
    }

    // Set token so the poller authenticates
    process.env.GITHUB_TOKEN = "test-token"
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete process.env.GITHUB_TOKEN
  })

  it("creates tasks from matching GitHub issues (assignee trigger)", async () => {
    const issues = [
      makeIssue(1, { assignee: { login: "bot" } }),
      makeIssue(2, { assignee: { login: "bot" } }),
      makeIssue(3, { assignee: { login: "other" } }), // not matching
    ]

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(issues), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
    ) as typeof fetch

    const config = makeConfig({ type: "assignee", value: "bot" })
    await Effect.runPromise(pollGitHubIssues(config, deps))

    expect(createdTasks).toHaveLength(2)
    expect(createdTasks[0]!.title).toBe("Issue #1")
    expect(createdTasks[1]!.title).toBe("Issue #2")
  })

  it("creates tasks from matching GitHub issues (label trigger)", async () => {
    const issues = [
      makeIssue(1, { labels: [{ name: "agent" }] }),
      makeIssue(2, { labels: [{ name: "bug" }] }), // not matching
      makeIssue(3, { labels: [{ name: "agent" }, { name: "priority" }] }),
    ]

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(issues), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
    ) as typeof fetch

    const config = makeConfig({ type: "label", value: "agent" })
    await Effect.runPromise(pollGitHubIssues(config, deps))

    expect(createdTasks).toHaveLength(2)
    expect(createdTasks[0]!.title).toBe("Issue #1")
    expect(createdTasks[1]!.title).toBe("Issue #3")
  })

  it("deduplicates issues on subsequent poll cycles", async () => {
    const issues = [
      makeIssue(1, { assignee: { login: "bot" } }),
      makeIssue(2, { assignee: { login: "bot" } }),
    ]

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(issues), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
    ) as typeof fetch

    const config = makeConfig({ type: "assignee", value: "bot" })

    // First poll — creates 2 tasks
    await Effect.runPromise(pollGitHubIssues(config, deps))
    expect(createdTasks).toHaveLength(2)

    // Second poll with same issues — should not create duplicates
    await Effect.runPromise(pollGitHubIssues(config, deps))
    expect(createdTasks).toHaveLength(2)
  })

  it("creates only new tasks when mix of old and new issues", async () => {
    // Pre-seed issue #1 as already existing
    existingSourceIds.add("github:test/repo#1")

    const issues = [
      makeIssue(1, { assignee: { login: "bot" } }),
      makeIssue(2, { assignee: { login: "bot" } }),
      makeIssue(3, { assignee: { login: "bot" } }),
    ]

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(issues), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
    ) as typeof fetch

    const config = makeConfig({ type: "assignee", value: "bot" })
    await Effect.runPromise(pollGitHubIssues(config, deps))

    expect(createdTasks).toHaveLength(2) // Only #2 and #3
    expect(createdTasks.map((t) => t.sourceId)).toEqual([
      "github:test/repo#2",
      "github:test/repo#3",
    ])
  })

  it("handles API error gracefully (does not throw)", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("internal error", {
        status: 500,
        statusText: "Internal Server Error",
      }))
    ) as typeof fetch

    const config = makeConfig({ type: "assignee", value: "bot" })

    // pollGitHubIssues catches errors internally and logs them
    await expect(Effect.runPromise(pollGitHubIssues(config, deps))).resolves.toBeUndefined()
    expect(createdTasks).toHaveLength(0)
  })

  it("skips polling when no trigger configured", async () => {
    const fetchMock = mock(() => Promise.resolve(new Response("[]")))
    globalThis.fetch = fetchMock as typeof fetch

    const config = { repo: "test/repo" } as ProjectConfig
    await Effect.runPromise(pollGitHubIssues(config, deps))

    // fetch should not have been called
    expect(fetchMock).not.toHaveBeenCalled()
    expect(createdTasks).toHaveLength(0)
  })

  it("handles empty issue list", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
    ) as typeof fetch

    const config = makeConfig({ type: "assignee", value: "bot" })
    await Effect.runPromise(pollGitHubIssues(config, deps))

    expect(createdTasks).toHaveLength(0)
  })

  it("passes issue metadata to created tasks", async () => {
    const issues = [
      makeIssue(42, {
        title: "Fix critical bug",
        body: "The app crashes when...",
        html_url: "https://github.com/test/repo/issues/42",
        assignee: { login: "bot" },
      }),
    ]

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(issues), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
    ) as typeof fetch

    const config = makeConfig({ type: "assignee", value: "bot" })
    await Effect.runPromise(pollGitHubIssues(config, deps))

    expect(createdTasks).toHaveLength(1)
    const task = createdTasks[0]!
    expect(task.title).toBe("Fix critical bug")
    expect(task.description).toBe("The app crashes when...")
    expect(task.sourceId).toBe("github:test/repo#42")
  })
})
