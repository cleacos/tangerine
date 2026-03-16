import { describe, it, expect, beforeEach } from "bun:test"
import { Effect } from "effect"
import {
  acquireVm,
  releaseVm,
  reapIdleVms,
  reconcilePool,
} from "../vm/pool"
import type { PoolDeps, SimplePoolConfig } from "../vm/pool"

/**
 * Tracer bullet: VM Pool -> Acquire -> Assign -> Release -> Reap
 *
 * Tests pool operations using the standalone function API with
 * mock deps. Validates the full VM lifecycle: provision -> assign ->
 * release back to warm pool -> idle reap -> reconcile.
 */

interface MockVm {
  id: string
  status: string
  taskId: string | null
  idleSince: string | null
}

function createMockPoolDeps(): PoolDeps & { vms: Map<string, MockVm> } {
  const vms = new Map<string, MockVm>()
  let nextId = 1

  return {
    vms,

    provisionVm(_snapshotId: string) {
      const id = `vm-${nextId++}`
      const vm: MockVm = {
        id,
        status: "ready",
        taskId: null,
        idleSince: null,
      }
      vms.set(id, vm)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      return Effect.succeed(vm as ReturnType<PoolDeps["provisionVm"]> extends Effect.Effect<infer T, infer _Err> ? T : never)
    },

    destroyVm(vmId: string) {
      vms.delete(vmId)
      return Effect.succeed(undefined as void)
    },

    getVm(vmId: string) {
      return vms.get(vmId) as ReturnType<PoolDeps["getVm"]>
    },

    listVms(filter?: { status?: string }) {
      const all = [...vms.values()]
      if (filter?.status) {
        return all.filter((v) => v.status === filter.status) as ReturnType<PoolDeps["listVms"]>
      }
      return all as ReturnType<PoolDeps["listVms"]>
    },

    updateVm(vmId: string, updates: Record<string, unknown>) {
      const vm = vms.get(vmId)
      if (vm) {
        Object.assign(vm, updates)
      }
    },
  }
}

const defaultConfig: SimplePoolConfig = {
  minReady: 0,
  idleTimeoutMs: 60_000,
  snapshotId: "snap-test",
}

describe("tracer: pool lifecycle", () => {
  let deps: ReturnType<typeof createMockPoolDeps>

  beforeEach(() => {
    deps = createMockPoolDeps()
  })

  it("acquireVm provisions a new VM when pool is empty", async () => {
    const vm = await Effect.runPromise(acquireVm(deps, defaultConfig, "task-1"))

    expect(vm).toBeDefined()
    expect(vm.id).toBe("vm-1")
    expect(vm.status).toBe("assigned")
    expect(vm.taskId).toBe("task-1")
    expect(deps.vms.size).toBe(1)
  })

  it("acquireVm reuses a warm VM from pool", async () => {
    // Pre-seed a ready VM
    deps.vms.set("vm-warm", {
      id: "vm-warm",
      status: "ready",
      taskId: null,
      idleSince: null,
    })

    const vm = await Effect.runPromise(acquireVm(deps, defaultConfig, "task-2"))

    expect(vm.id).toBe("vm-warm")
    expect(vm.status).toBe("assigned")
    expect(vm.taskId).toBe("task-2")
    // Should not have provisioned a new VM
    expect(deps.vms.size).toBe(1)
  })

  it("releaseVm returns VM to ready with idle_since", async () => {
    const vm = await Effect.runPromise(acquireVm(deps, defaultConfig, "task-3"))
    expect(vm.status).toBe("assigned")

    await Effect.runPromise(releaseVm(deps, vm.id))

    const released = deps.vms.get(vm.id)!
    expect(released.status).toBe("ready")
    expect(released.taskId).toBeNull()
    expect(released.idleSince).toBeDefined()
    expect(released.idleSince).not.toBeNull()
  })

  it("reapIdleVms destroys VMs past their idle timeout", async () => {
    // Create a ready VM with an old idle_since
    const pastTime = new Date(Date.now() - 120_000).toISOString()
    deps.vms.set("vm-idle", {
      id: "vm-idle",
      status: "ready",
      taskId: null,
      idleSince: pastTime,
    })

    const result = await Effect.runPromise(reapIdleVms(deps, {
      ...defaultConfig,
      idleTimeoutMs: 60_000, // 60s timeout, VM idle for 120s
    }))

    expect(result.destroyed).toBe(1)
    expect(deps.vms.has("vm-idle")).toBe(false)
  })

  it("reapIdleVms does not destroy recently released VMs", async () => {
    // VM released just now
    deps.vms.set("vm-recent", {
      id: "vm-recent",
      status: "ready",
      taskId: null,
      idleSince: new Date().toISOString(),
    })

    const result = await Effect.runPromise(reapIdleVms(deps, {
      ...defaultConfig,
      idleTimeoutMs: 60_000,
    }))

    expect(result.destroyed).toBe(0)
    expect(deps.vms.has("vm-recent")).toBe(true)
  })

  it("reconcilePool tops up pool to minReady", async () => {
    const result = await Effect.runPromise(reconcilePool(deps, {
      ...defaultConfig,
      minReady: 2,
    }))

    expect(result.created).toBe(2)
    // Should have 2 ready VMs now
    const readyVms = deps.listVms({ status: "ready" })
    expect(readyVms.length).toBe(2)
  })

  it("reconcilePool reaps idle and tops up in one pass", async () => {
    // One idle VM past timeout
    deps.vms.set("vm-old", {
      id: "vm-old",
      status: "ready",
      taskId: null,
      idleSince: new Date(Date.now() - 120_000).toISOString(),
    })

    const result = await Effect.runPromise(reconcilePool(deps, {
      minReady: 1,
      idleTimeoutMs: 60_000,
      snapshotId: "snap-test",
    }))

    // Should reap the old one and create a new one
    expect(result.destroyed).toBe(1)
    expect(result.created).toBe(1)
    expect(deps.vms.has("vm-old")).toBe(false)
  })

  it("full acquire -> release -> reap cycle", async () => {
    // Acquire
    const vm = await Effect.runPromise(acquireVm(deps, defaultConfig, "task-cycle"))
    expect(vm.status).toBe("assigned")

    // Release
    await Effect.runPromise(releaseVm(deps, vm.id))
    expect(deps.vms.get(vm.id)!.status).toBe("ready")

    // Simulate time passing by backdating idle_since
    const vmEntry = deps.vms.get(vm.id)!
    vmEntry.idleSince = new Date(Date.now() - 120_000).toISOString()

    // Reap
    const result = await Effect.runPromise(reapIdleVms(deps, {
      ...defaultConfig,
      idleTimeoutMs: 60_000,
    }))
    expect(result.destroyed).toBe(1)
    expect(deps.vms.has(vm.id)).toBe(false)
  })

  it("handles provisioning errors gracefully", async () => {
    const failingDeps = createMockPoolDeps()
    failingDeps.provisionVm = () => {
      return Effect.fail(new Error("Provider is down"))
    }

    await expect(
      Effect.runPromise(acquireVm(failingDeps, defaultConfig, "task-fail"))
    ).rejects.toThrow("Provider is down")
  })

  it("acquire -> release -> acquire reuses the same VM", async () => {
    const vm1 = await Effect.runPromise(acquireVm(deps, defaultConfig, "task-a"))
    const vmId = vm1.id
    await Effect.runPromise(releaseVm(deps, vmId))

    const vm2 = await Effect.runPromise(acquireVm(deps, defaultConfig, "task-b"))
    expect(vm2.id).toBe(vmId)
    expect(vm2.taskId).toBe("task-b")
  })
})
