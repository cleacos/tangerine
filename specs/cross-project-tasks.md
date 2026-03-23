# Cross-Project Task Creation

Agents inside VMs can create tasks in other projects. Preserves context that would be lost with manual creation.

## Problem

Agent working on Project A discovers issue in Project B. Agent has full context (code, errors, reasoning). Switching to manually create the task loses that context.

## Design

### Communication Path

```
Agent (VM-A) → reverse SSH tunnel → Tangerine server (host) → provisions task → VM-B
```

Agent never talks to VM-B directly. Server is the coordinator — same as web dashboard or API.

### Reverse Tunnel

New reverse tunnel during session setup. Forwards the Tangerine API port into the VM:

```
-R 3456:127.0.0.1:3456
```

Uses the configured server port (`DEFAULT_API_PORT = 3456`). Added alongside existing forward tunnels (agent port, preview port) and proxy tunnel (GHE).

Lifecycle: created in `startSession` / `reconnectSession`, killed on `cleanupSession`. Reuses existing `createProxyTunnel` pattern — same SSH `-R` flag, same process management.

### CLI: `tangerine-task`

Lightweight shell script or binary installed in the golden base image. Talks to `http://127.0.0.1:3456` (reverse tunnel).

#### Commands

```bash
# List available projects
tangerine-task projects
# → wordpress-develop
# → tangerine
# → gutenberg

# Create task in another project
tangerine-task create \
  --project "wordpress-develop" \
  --title "Fix N+1 query in post loader" \
  --description "Found while working on tangerine task abc123. The post loader at src/loaders/post.ts:42 fires a separate query per author. Should batch with IN clause."

# Create with provider/model override
tangerine-task create \
  --project "gutenberg" \
  --title "Update block editor API" \
  --provider claude-code \
  --model "claude-sonnet-4-5-20250514"
```

#### Auto-Attached Metadata

Every task created via CLI auto-attaches:
- `source: "cross-project"` — new source type (alongside github, linear, manual)
- `source_id: "<origin-task-id>"` — the task that spawned it (read from `$TANGERINE_TASK_ID` env var)
- Description footer: `\n\n---\nCreated from task <origin-task-id> in project <origin-project>`

`TANGERINE_TASK_ID` is injected as an env var during session setup (alongside credentials).

#### Output

```bash
# Success
✓ Task created: <task-id> in project wordpress-develop

# Error
✗ Project "foo" not found. Available: wordpress-develop, tangerine, gutenberg
✗ Server unreachable (is the tunnel up?)
```

### Server Changes

#### New API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects` | List all configured projects (name, repo) |

`POST /api/tasks` already exists. Add `source: "cross-project"` as valid source.

#### Task Source

Add `"cross-project"` to the `source` enum:

```
github | linear | manual | cross-project
```

No schema migration needed — `source` is TEXT. Just update validation.

### Session Setup Changes

In `startSession` and `reconnectSession`:

1. Create reverse tunnel: `-R 3456:127.0.0.1:3456`
2. Inject `TANGERINE_TASK_ID=<task.id>` and `TANGERINE_SERVER_PORT=3456` as env vars

Reverse tunnel stored in `SessionInfo` alongside existing `proxyTunnel`. Killed on cleanup.

### Golden Image Changes

Install `tangerine-task` script in base image build. Simple shell script (~30 lines):
- `projects`: `curl -s http://127.0.0.1:$TANGERINE_SERVER_PORT/api/projects | jq -r '.[].name'`
- `create`: builds JSON payload, `curl -X POST http://127.0.0.1:$TANGERINE_SERVER_PORT/api/tasks`

No auth — reverse tunnel is localhost-only, VM is single-tenant.

## Implementation Order

1. Add `GET /api/projects` endpoint
2. Add `"cross-project"` as valid task source
3. Add reverse tunnel in `startSession` / `reconnectSession`
4. Inject `TANGERINE_TASK_ID` + `TANGERINE_SERVER_PORT` env vars
5. Write `tangerine-task` shell script
6. Add script to base image build
7. Tests: API route test for `/api/projects`, lifecycle test for reverse tunnel setup

## Not In Scope (future)

- Task linking (blocked-by, related-to relationships)
- Auth token for reverse tunnel
- Web dashboard UI for cross-project task lineage
- Bidirectional context sharing (attaching files/diffs from origin task)
