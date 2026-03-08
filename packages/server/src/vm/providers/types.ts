import type { Effect } from "effect"
import type { ProviderError } from "../../errors"

export interface Instance {
  id: string;
  label: string;
  ip: string;
  status: "pending" | "active" | "stopped" | "error";
  region: string;
  plan: string;
  snapshotId?: string;
  createdAt: string;
  sshPort?: number;
}

export interface Snapshot {
  id: string;
  description: string;
  status: "pending" | "complete";
  size: number;
  createdAt: string;
}

export interface CreateInstanceOptions {
  region: string;
  plan: string;
  snapshotId?: string;
  osId?: number | string;
  label?: string;
  sshKeyIds?: string[];
  userData?: string;
}

export interface Provider {
  createInstance(opts: CreateInstanceOptions): Effect.Effect<Instance, ProviderError>;
  startInstance(id: string): Effect.Effect<void, ProviderError>;
  stopInstance(id: string): Effect.Effect<void, ProviderError>;
  destroyInstance(id: string): Effect.Effect<void, ProviderError>;
  getInstance(id: string): Effect.Effect<Instance, ProviderError>;
  listInstances(label?: string): Effect.Effect<Instance[], ProviderError>;
  waitForReady(id: string, timeoutMs?: number): Effect.Effect<Instance, ProviderError>;

  createSnapshot(instanceId: string, description: string): Effect.Effect<Snapshot, ProviderError>;
  listSnapshots(): Effect.Effect<Snapshot[], ProviderError>;
  getSnapshot(id: string): Effect.Effect<Snapshot, ProviderError>;
  deleteSnapshot(id: string): Effect.Effect<void, ProviderError>;
  waitForSnapshot(id: string, timeoutMs?: number): Effect.Effect<Snapshot, ProviderError>;
}
