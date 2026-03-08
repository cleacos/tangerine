import { Effect } from "effect";
import type {
  Provider,
  Instance,
  Snapshot,
  CreateInstanceOptions,
} from "./types.ts";
import { ProviderError } from "../../errors";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

interface IncusConfig {
  cpus?: number;
  memory?: string;
  remote?: string;
  sshPubKeyPath?: string;
}

interface IncusInstance {
  name: string;
  type: string;
  status: string;
  created_at: string;
  config: Record<string, string>;
  state?: {
    network?: Record<
      string,
      {
        addresses: Array<{
          family: string;
          address: string;
          scope: string;
        }>;
      }
    >;
  };
}

interface IncusImage {
  fingerprint: string;
  aliases: Array<{ name: string }>;
  size: number;
  created_at: string;
  properties?: Record<string, string>;
}

export class IncusProvider implements Provider {
  private cpus: number;
  private memory: string;
  private remote: string;
  private sshPubKey: string;

  constructor(config: IncusConfig = {}) {
    this.cpus = config.cpus ?? 2;
    this.memory = config.memory ?? "4GiB";
    this.remote = config.remote ?? "local";
    this.sshPubKey = this.readSshPubKey(config.sshPubKeyPath);
  }

  private readSshPubKey(overridePath?: string): string {
    const paths = overridePath
      ? [overridePath]
      : [
          join(homedir(), ".ssh", "id_ed25519.pub"),
          join(homedir(), ".ssh", "id_rsa.pub"),
        ];

    for (const p of paths) {
      try {
        return readFileSync(p, "utf-8").trim();
      } catch {
        continue;
      }
    }
    throw new Error(
      `No SSH public key found. Tried: ${paths.join(", ")}. Set TANGERINE_INCUS_SSH_PUB_KEY to override.`
    );
  }

  private exec(
    args: string[],
    timeoutMs = 60_000
  ): Effect.Effect<{ exitCode: number; stdout: string; stderr: string }, ProviderError> {
    return Effect.tryPromise({
      try: async () => {
        const proc = Bun.spawn(["incus", ...args], {
          stdout: "pipe",
          stderr: "pipe",
        });

        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          proc.kill();
        }, timeoutMs);

        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);

        const exitCode = await proc.exited;
        clearTimeout(timer);

        if (timedOut) {
          throw new Error(`incus ${args[0]} timed out after ${timeoutMs}ms`);
        }

        return { exitCode, stdout, stderr };
      },
      catch: (e) => new ProviderError({
        message: `incus ${args[0]} failed: ${e}`,
        provider: "incus",
        operation: args[0] ?? "unknown",
        cause: e,
      }),
    });
  }

  private execOrThrow(args: string[], timeoutMs?: number): Effect.Effect<string, ProviderError> {
    return Effect.gen(this, function* () {
      const result = yield* this.exec(args, timeoutMs);
      if (result.exitCode !== 0) {
        return yield* Effect.fail(new ProviderError({
          message: `incus ${args[0]} failed (exit ${result.exitCode}): ${result.stderr}`,
          provider: "incus",
          operation: args[0] ?? "unknown",
        }));
      }
      return result.stdout;
    });
  }

  /** Run incus with inherited stdio (output goes straight to terminal) */
  private execInherit(args: string[], timeoutMs = 60_000): Effect.Effect<void, ProviderError> {
    return Effect.tryPromise({
      try: async () => {
        const proc = Bun.spawn(["incus", ...args], {
          stdin: "ignore",
          stdout: "inherit",
          stderr: "inherit",
        });

        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          proc.kill();
        }, timeoutMs);

        const exitCode = await proc.exited;
        clearTimeout(timer);

        if (timedOut) {
          throw new Error(`incus ${args[0]} timed out after ${timeoutMs}ms`);
        }
        if (exitCode !== 0) {
          throw new Error(`incus ${args[0]} failed (exit ${exitCode})`);
        }
      },
      catch: (e) => new ProviderError({
        message: `incus ${args[0]} failed: ${e}`,
        provider: "incus",
        operation: args[0] ?? "unknown",
        cause: e,
      }),
    });
  }

  private extractIp(raw: IncusInstance): string {
    if (!raw.state?.network) return "";
    for (const [iface, net] of Object.entries(raw.state.network)) {
      if (iface === "lo") continue;
      for (const addr of net.addresses) {
        if (
          addr.family === "inet" &&
          addr.scope === "global" &&
          !addr.address.startsWith("127.")
        ) {
          return addr.address;
        }
      }
    }
    return "";
  }

  private mapInstance(raw: IncusInstance): Instance {
    const cpus = raw.config["limits.cpu"] ?? String(this.cpus);
    const mem = raw.config["limits.memory"] ?? this.memory;
    return {
      id: raw.name,
      label: raw.name,
      ip: this.extractIp(raw),
      status: mapIncusStatus(raw.status),
      region: this.remote,
      plan: `${cpus}cpu-${mem}`,
      createdAt: raw.created_at,
    };
  }

  createInstance(opts: CreateInstanceOptions): Effect.Effect<Instance, ProviderError> {
    return Effect.gen(this, function* () {
      const name = opts.label ?? `tangerine-${Date.now()}`;
      const image = opts.snapshotId || "images:debian/13";
      const verbose = process.env.TANGERINE_VERBOSE === "1";

      if (verbose) {
        yield* this.execInherit(
          [
            "launch",
            image,
            name,
            "--vm",
            `--config=limits.cpu=${this.cpus}`,
            `--config=limits.memory=${this.memory}`,
          ],
          300_000
        );
      } else {
        yield* this.execOrThrow(
          [
            "launch",
            image,
            name,
            "--vm",
            `--config=limits.cpu=${this.cpus}`,
            `--config=limits.memory=${this.memory}`,
          ],
          300_000
        );
      }

      // Wait for incus agent to be ready before injecting SSH key
      yield* this.waitForAgent(name);

      // Inject SSH public key for the agent user
      yield* this.execOrThrow(
        [
          "exec",
          name,
          "--",
          "bash",
          "-c",
          `mkdir -p /home/agent/.ssh && echo '${this.sshPubKey}' >> /home/agent/.ssh/authorized_keys && chown -R agent:agent /home/agent/.ssh && chmod 700 /home/agent/.ssh && chmod 600 /home/agent/.ssh/authorized_keys`,
        ],
        30_000
      );

      return yield* this.getInstance(name);
    });
  }

  /** Wait for the incus agent inside the VM to respond */
  private waitForAgent(name: string, timeoutMs = 120_000): Effect.Effect<void, ProviderError> {
    return Effect.tryPromise({
      try: async () => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          const result = await Effect.runPromise(
            this.exec(["exec", name, "--", "echo", "ready"], 10_000)
          );
          if (result.exitCode === 0 && result.stdout.trim() === "ready") return;
          await sleep(3_000);
        }
        throw new Error(
          `Incus agent in ${name} not ready after ${timeoutMs / 1000}s`
        );
      },
      catch: (e) => new ProviderError({
        message: `waitForAgent failed: ${e}`,
        provider: "incus",
        operation: "waitForAgent",
        cause: e,
      }),
    });
  }

  startInstance(id: string): Effect.Effect<void, ProviderError> {
    return Effect.gen(this, function* () {
      yield* this.execOrThrow(["start", id], 120_000);
    });
  }

  stopInstance(id: string): Effect.Effect<void, ProviderError> {
    return Effect.gen(this, function* () {
      yield* this.execOrThrow(["stop", id], 60_000);
    });
  }

  destroyInstance(id: string): Effect.Effect<void, ProviderError> {
    return Effect.gen(this, function* () {
      const result = yield* this.exec([
        "list",
        "--format=json",
        `--project=${this.remote}`,
      ]);
      if (result.exitCode !== 0) return;
      try {
        const instances = JSON.parse(result.stdout) as IncusInstance[];
        if (!instances.some((i) => i.name === id)) return;
      } catch {
        return;
      }

      // Stop first (ignore errors — may already be stopped)
      yield* this.exec(["stop", id, "--force"]);
      yield* this.execOrThrow(["delete", id, "--force"]);
    });
  }

  getInstance(id: string): Effect.Effect<Instance, ProviderError> {
    return Effect.gen(this, function* () {
      const stdout = yield* this.execOrThrow([
        "list",
        id,
        "--format=json",
      ]);
      const instances = JSON.parse(stdout) as IncusInstance[];
      const raw = instances.find((i) => i.name === id);
      if (!raw) {
        return yield* Effect.fail(new ProviderError({
          message: `Incus instance ${id} not found`,
          provider: "incus",
          operation: "getInstance",
        }));
      }
      return this.mapInstance(raw);
    });
  }

  listInstances(label?: string): Effect.Effect<Instance[], ProviderError> {
    return Effect.gen(this, function* () {
      const result = yield* this.exec(["list", "--format=json"]);
      if (result.exitCode !== 0) return [];

      let instances: IncusInstance[];
      try {
        instances = JSON.parse(result.stdout) as IncusInstance[];
      } catch {
        return [];
      }

      return instances
        .filter((raw) => {
          if (raw.type !== "virtual-machine") return false;
          if (label) return raw.name.includes(label);
          return raw.name.startsWith("tangerine-");
        })
        .map((raw) => this.mapInstance(raw));
    });
  }

  waitForReady(id: string, timeoutMs = 300_000): Effect.Effect<Instance, ProviderError> {
    return Effect.tryPromise({
      try: async () => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          const instance = await Effect.runPromise(this.getInstance(id));
          // Must have both active status AND a valid IP (DHCP lease may lag)
          if (instance.status === "active" && instance.ip) {
            return instance;
          }
          if (instance.status === "error") {
            throw new Error(`Incus instance ${id} entered error state`);
          }
          const elapsed = Math.round((Date.now() - start) / 1000);
          console.log(
            `Incus ${id}: ${instance.status}${instance.ip ? "" : " (waiting for IP)"} (${elapsed}s elapsed)`
          );
          await sleep(3_000);
        }
        throw new Error(
          `Incus instance ${id} did not become ready within ${timeoutMs / 1000}s`
        );
      },
      catch: (e) => new ProviderError({
        message: `waitForReady failed: ${e}`,
        provider: "incus",
        operation: "waitForReady",
        cause: e,
      }),
    });
  }

  // Snapshot methods — published images

  createSnapshot(instanceId: string, description: string): Effect.Effect<Snapshot, ProviderError> {
    return Effect.gen(this, function* () {
      const alias = description.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();

      // Instance must be stopped to publish
      yield* this.exec(["stop", instanceId, "--force"]);
      yield* this.execOrThrow(
        ["publish", instanceId, "--alias", alias],
        300_000
      );

      return {
        id: alias,
        description,
        status: "complete" as const,
        size: 0,
        createdAt: new Date().toISOString(),
      };
    });
  }

  listSnapshots(): Effect.Effect<Snapshot[], ProviderError> {
    return Effect.gen(this, function* () {
      const stdout = yield* this.execOrThrow(["image", "list", "--format=json"]);
      let images: IncusImage[];
      try {
        images = JSON.parse(stdout) as IncusImage[];
      } catch {
        return [];
      }

      return images
        .filter((img) => img.aliases.some((a) => a.name.startsWith("tangerine-")))
        .map((img) => ({
          id: img.aliases[0]?.name ?? img.fingerprint,
          description:
            img.aliases[0]?.name ??
            img.properties?.description ??
            img.fingerprint,
          status: "complete" as const,
          size: img.size,
          createdAt: img.created_at,
        }));
    });
  }

  getSnapshot(id: string): Effect.Effect<Snapshot, ProviderError> {
    return Effect.gen(this, function* () {
      const stdout = yield* this.execOrThrow([
        "image",
        "list",
        id,
        "--format=json",
      ]);
      const images = JSON.parse(stdout) as IncusImage[];
      const img = images[0];
      if (!img) {
        return yield* Effect.fail(new ProviderError({
          message: `Incus image ${id} not found`,
          provider: "incus",
          operation: "getSnapshot",
        }));
      }

      return {
        id: img.aliases[0]?.name ?? img.fingerprint,
        description:
          img.aliases[0]?.name ??
          img.properties?.description ??
          img.fingerprint,
        status: "complete" as const,
        size: img.size,
        createdAt: img.created_at,
      };
    });
  }

  deleteSnapshot(id: string): Effect.Effect<void, ProviderError> {
    return Effect.gen(this, function* () {
      yield* this.execOrThrow(["image", "delete", id]);
    });
  }

  waitForSnapshot(_id: string, _timeoutMs?: number): Effect.Effect<Snapshot, ProviderError> {
    // incus publish blocks until complete
    return this.getSnapshot(_id);
  }
}

function mapIncusStatus(status: string): Instance["status"] {
  switch (status) {
    case "Running":
      return "active";
    case "Stopped":
      return "stopped";
    case "Starting":
      return "pending";
    default:
      return "error";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
