import { describe, it, expect, beforeEach } from "bun:test";
import { Effect } from "effect";
import { Database } from "bun:sqlite";
import { VMPoolManager } from "../pool.ts";
import type { PoolConfig } from "../pool-types.ts";
import type {
  Provider,
  Instance,
  Snapshot,
  CreateInstanceOptions,
} from "../providers/types.ts";

/** Minimal mock provider that tracks calls and returns predictable results */
function createMockProvider(overrides?: Partial<Provider>): Provider {
  let instanceCounter = 0;

  return {
    createInstance(opts: CreateInstanceOptions) {
      instanceCounter++;
      const id = opts.label ?? `mock-${instanceCounter}`;
      return Effect.succeed({
        id,
        label: id,
        ip: `10.0.0.${instanceCounter}`,
        status: "active" as const,
        region: opts.region,
        plan: opts.plan,
        createdAt: new Date().toISOString(),
        sshPort: 22,
      });
    },
    startInstance(_id: string) { return Effect.succeed(undefined as void); },
    stopInstance(_id: string) { return Effect.succeed(undefined as void); },
    destroyInstance(_id: string) { return Effect.succeed(undefined as void); },
    getInstance(id: string) {
      return Effect.succeed({
        id,
        label: id,
        ip: "10.0.0.1",
        status: "active" as const,
        region: "local",
        plan: "2cpu-4gb",
        createdAt: new Date().toISOString(),
        sshPort: 22,
      });
    },
    listInstances(_label?: string) {
      return Effect.succeed([] as Instance[]);
    },
    waitForReady(id: string, _timeoutMs?: number) {
      return Effect.succeed({
        id,
        label: id,
        ip: "10.0.0.1",
        status: "active" as const,
        region: "local",
        plan: "2cpu-4gb",
        createdAt: new Date().toISOString(),
        sshPort: 22,
      });
    },
    createSnapshot(_instanceId: string, description: string) {
      return Effect.succeed({ id: "snap-1", description, status: "complete" as const, size: 0, createdAt: new Date().toISOString() });
    },
    listSnapshots() {
      return Effect.succeed([] as Snapshot[]);
    },
    getSnapshot(id: string) {
      return Effect.succeed({ id, description: id, status: "complete" as const, size: 0, createdAt: new Date().toISOString() });
    },
    deleteSnapshot(_id: string) { return Effect.succeed(undefined as void); },
    waitForSnapshot(id: string, _timeoutMs?: number) {
      return Effect.succeed({ id, description: id, status: "complete" as const, size: 0, createdAt: new Date().toISOString() });
    },
    ...overrides,
  };
}

function createTestDb(): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS vms (
      id          TEXT PRIMARY KEY,
      label       TEXT NOT NULL,
      provider    TEXT NOT NULL DEFAULT 'mock',
      ip          TEXT,
      ssh_port    INTEGER,
      status      TEXT NOT NULL DEFAULT 'provisioning',
      task_id     TEXT,
      snapshot_id TEXT NOT NULL,
      region      TEXT NOT NULL,
      plan        TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      error       TEXT,
      idle_since  TEXT
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL DEFAULT 'test',
      slug          TEXT UNIQUE,
      repo_url      TEXT NOT NULL,
      context       TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      vm_id         TEXT,
      result        TEXT,
      exit_code     INTEGER,
      branch        TEXT,
      pr_url        TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      started_at    TEXT,
      completed_at  TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_vms_status ON vms(status);
    CREATE INDEX IF NOT EXISTS idx_vms_task_id ON vms(task_id);
  `);
  return db;
}

function createTestConfig(provider: Provider, overrides?: Partial<PoolConfig>): PoolConfig {
  return {
    slots: [
      {
        name: "mock",
        provider,
        snapshotId: "clone:golden",
        region: "local",
        plan: "2cpu-4gb",
        maxPoolSize: 5,
        priority: 1,
        idleTimeoutMs: 300_000,
        minReady: 0,
      },
    ],
    labelPrefix: "test",
    ...overrides,
  };
}

describe("VMPoolManager", () => {
  let db: Database;
  let provider: Provider;
  let pool: VMPoolManager;

  beforeEach(() => {
    db = createTestDb();
    provider = createMockProvider();
    pool = new VMPoolManager(db, createTestConfig(provider));
  });

  describe("acquireVm", () => {
    it("provisions and returns a VM when pool is empty", async () => {
      // Insert a task so acquireVm can assign to it
      db.run(
        `INSERT INTO tasks (id, repo_url, context, status) VALUES ('task-1', 'https://github.com/test/repo', 'test', 'pending')`
      );

      const vm = await Effect.runPromise(pool.acquireVm("task-1"));

      expect(vm).toBeDefined();
      expect(vm.status).toBe("assigned");
      expect(vm.task_id).toBe("task-1");
      expect(vm.ip).toBeTruthy();
    });

    it("reuses a warm VM when one is available", async () => {
      // Pre-populate a ready VM in the pool
      const now = new Date().toISOString();
      db.run(
        `INSERT INTO vms (id, label, provider, ip, ssh_port, status, snapshot_id, region, plan, created_at, updated_at)
         VALUES ('warm-1', 'warm-1', 'mock', '10.0.0.99', 22, 'ready', 'snap', 'local', '2cpu-4gb', ?, ?)`,
        [now, now]
      );

      db.run(
        `INSERT INTO tasks (id, repo_url, context, status) VALUES ('task-2', 'https://github.com/test/repo', 'test', 'pending')`
      );

      const vm = await Effect.runPromise(pool.acquireVm("task-2"));

      expect(vm.id).toBe("warm-1");
      expect(vm.status).toBe("assigned");
      expect(vm.task_id).toBe("task-2");
    });
  });

  describe("releaseVm", () => {
    it("marks VM as ready with idle_since when idleTimeout > 0", async () => {
      const now = new Date().toISOString();
      db.run(
        `INSERT INTO vms (id, label, provider, ip, ssh_port, status, task_id, snapshot_id, region, plan, created_at, updated_at)
         VALUES ('vm-1', 'vm-1', 'mock', '10.0.0.1', 22, 'assigned', 'task-1', 'snap', 'local', '2cpu-4gb', ?, ?)`,
        [now, now]
      );

      await Effect.runPromise(pool.releaseVm("vm-1"));

      const vm = Effect.runSync(pool.getVm("vm-1"));
      expect(vm).toBeDefined();
      expect(vm!.status).toBe("ready");
      expect(vm!.task_id).toBeNull();
      expect(vm!.idle_since).toBeTruthy();
    });

    it("destroys VM immediately when idleTimeout is 0", async () => {
      // Create pool with 0 idle timeout
      const noIdleProvider = createMockProvider();
      const noIdlePool = new VMPoolManager(
        db,
        createTestConfig(noIdleProvider, {
          slots: [
            {
              name: "mock",
              provider: noIdleProvider,
              snapshotId: "clone:golden",
              region: "local",
              plan: "2cpu-4gb",
              maxPoolSize: 5,
              priority: 1,
              idleTimeoutMs: 0,
              minReady: 0,
            },
          ],
        })
      );

      const now = new Date().toISOString();
      db.run(
        `INSERT INTO vms (id, label, provider, ip, ssh_port, status, task_id, snapshot_id, region, plan, created_at, updated_at)
         VALUES ('vm-2', 'vm-2', 'mock', '10.0.0.2', 22, 'assigned', 'task-2', 'snap', 'local', '2cpu-4gb', ?, ?)`,
        [now, now]
      );

      await Effect.runPromise(noIdlePool.releaseVm("vm-2"));

      const vm = Effect.runSync(noIdlePool.getVm("vm-2"));
      expect(vm).toBeDefined();
      expect(vm!.status).toBe("destroyed");
    });
  });

  describe("reapIdleVms", () => {
    it("destroys VMs that have been idle past timeout", async () => {
      // Insert a VM with idle_since set far in the past
      const pastTime = new Date(Date.now() - 600_000).toISOString();
      db.run(
        `INSERT INTO vms (id, label, provider, ip, ssh_port, status, snapshot_id, region, plan, created_at, updated_at, idle_since)
         VALUES ('idle-1', 'idle-1', 'mock', '10.0.0.1', 22, 'ready', 'snap', 'local', '2cpu-4gb', ?, ?, ?)`,
        [pastTime, pastTime, pastTime]
      );

      const reaped = await Effect.runPromise(pool.reapIdleVms());

      expect(reaped).toBe(1);
      const vm = Effect.runSync(pool.getVm("idle-1"));
      expect(vm).toBeDefined();
      expect(vm!.status).toBe("destroyed");
    });

    it("does not reap VMs that are still within timeout", async () => {
      // Insert a VM with idle_since set just now
      const now = new Date().toISOString();
      db.run(
        `INSERT INTO vms (id, label, provider, ip, ssh_port, status, snapshot_id, region, plan, created_at, updated_at, idle_since)
         VALUES ('fresh-1', 'fresh-1', 'mock', '10.0.0.1', 22, 'ready', 'snap', 'local', '2cpu-4gb', ?, ?, ?)`,
        [now, now, now]
      );

      const reaped = await Effect.runPromise(pool.reapIdleVms());

      expect(reaped).toBe(0);
      const vm = Effect.runSync(pool.getVm("fresh-1"));
      expect(vm!.status).toBe("ready");
    });
  });

  describe("ensureWarm", () => {
    it("provisions VMs when below minReady", async () => {
      const warmProvider = createMockProvider();
      const warmPool = new VMPoolManager(
        db,
        createTestConfig(warmProvider, {
          slots: [
            {
              name: "mock",
              provider: warmProvider,
              snapshotId: "clone:golden",
              region: "local",
              plan: "2cpu-4gb",
              maxPoolSize: 5,
              priority: 1,
              idleTimeoutMs: 300_000,
              minReady: 2,
            },
          ],
        })
      );

      warmPool.ensureWarm();

      // Wait a tick for fire-and-forget provisioning to complete
      await new Promise((r) => setTimeout(r, 100));

      const vms = Effect.runSync(warmPool.listVms());
      // Should have provisioned VMs to meet minReady target
      const activeVms = vms.filter((v) => v.status !== "destroyed" && v.status !== "error");
      expect(activeVms.length).toBeGreaterThanOrEqual(1);
    });

    it("does not provision when at or above minReady", async () => {
      let provisionCount = 0;
      const countingProvider = createMockProvider({
        createInstance(opts: CreateInstanceOptions) {
          provisionCount++;
          const id = opts.label ?? `mock-${provisionCount}`;
          return Effect.succeed({
            id,
            label: id,
            ip: `10.0.0.${provisionCount}`,
            status: "active" as const,
            region: opts.region,
            plan: opts.plan,
            createdAt: new Date().toISOString(),
            sshPort: 22,
          });
        },
      });

      const warmPool = new VMPoolManager(
        db,
        createTestConfig(countingProvider, {
          slots: [
            {
              name: "mock",
              provider: countingProvider,
              snapshotId: "clone:golden",
              region: "local",
              plan: "2cpu-4gb",
              maxPoolSize: 5,
              priority: 1,
              idleTimeoutMs: 300_000,
              minReady: 1,
            },
          ],
        })
      );

      // Pre-populate one ready VM
      const now = new Date().toISOString();
      db.run(
        `INSERT INTO vms (id, label, provider, ip, ssh_port, status, snapshot_id, region, plan, created_at, updated_at)
         VALUES ('ready-1', 'ready-1', 'mock', '10.0.0.1', 22, 'ready', 'snap', 'local', '2cpu-4gb', ?, ?)`,
        [now, now]
      );

      warmPool.ensureWarm();

      // Wait a tick
      await new Promise((r) => setTimeout(r, 50));

      expect(provisionCount).toBe(0);
    });
  });

  describe("getPoolStats", () => {
    it("returns correct counts", () => {
      const now = new Date().toISOString();

      db.run(
        `INSERT INTO vms (id, label, provider, ip, status, snapshot_id, region, plan, created_at, updated_at)
         VALUES ('p1', 'p1', 'mock', NULL, 'provisioning', 'snap', 'local', '2cpu-4gb', ?, ?)`,
        [now, now]
      );
      db.run(
        `INSERT INTO vms (id, label, provider, ip, status, snapshot_id, region, plan, created_at, updated_at)
         VALUES ('r1', 'r1', 'mock', '10.0.0.1', 'ready', 'snap', 'local', '2cpu-4gb', ?, ?)`,
        [now, now]
      );
      db.run(
        `INSERT INTO vms (id, label, provider, ip, status, task_id, snapshot_id, region, plan, created_at, updated_at)
         VALUES ('a1', 'a1', 'mock', '10.0.0.2', 'assigned', 'task-1', 'snap', 'local', '2cpu-4gb', ?, ?)`,
        [now, now]
      );

      const stats = Effect.runSync(pool.getPoolStats());

      expect(stats.provisioning).toBe(1);
      expect(stats.ready).toBe(1);
      expect(stats.assigned).toBe(1);
      expect(stats.total).toBe(3);
      expect(stats.byProvider.mock).toBe(3);
    });
  });
});
