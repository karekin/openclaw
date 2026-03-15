import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveSandboxWorkdir, resolveWorkdir } from "./bash-tools.shared.js";

async function withTempDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "openclaw-bash-workdir-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("resolveSandboxWorkdir", () => {
  it("maps container root workdir to host workspace", async () => {
    await withTempDir(async (workspaceDir) => {
      const warnings: string[] = [];
      const resolved = await resolveSandboxWorkdir({
        workdir: "/workspace",
        sandbox: {
          containerName: "sandbox-1",
          workspaceDir,
          containerWorkdir: "/workspace",
        },
        warnings,
      });

      expect(resolved.hostWorkdir).toBe(workspaceDir);
      expect(resolved.containerWorkdir).toBe("/workspace");
      expect(warnings).toEqual([]);
    });
  });

  it("maps nested container workdir under the container workspace", async () => {
    await withTempDir(async (workspaceDir) => {
      const nested = path.join(workspaceDir, "scripts", "runner");
      await mkdir(nested, { recursive: true });
      const warnings: string[] = [];
      const resolved = await resolveSandboxWorkdir({
        workdir: "/workspace/scripts/runner",
        sandbox: {
          containerName: "sandbox-2",
          workspaceDir,
          containerWorkdir: "/workspace",
        },
        warnings,
      });

      expect(resolved.hostWorkdir).toBe(nested);
      expect(resolved.containerWorkdir).toBe("/workspace/scripts/runner");
      expect(warnings).toEqual([]);
    });
  });

  it("supports custom container workdir prefixes", async () => {
    await withTempDir(async (workspaceDir) => {
      const nested = path.join(workspaceDir, "project");
      await mkdir(nested, { recursive: true });
      const warnings: string[] = [];
      const resolved = await resolveSandboxWorkdir({
        workdir: "/sandbox-root/project",
        sandbox: {
          containerName: "sandbox-3",
          workspaceDir,
          containerWorkdir: "/sandbox-root",
        },
        warnings,
      });

      expect(resolved.hostWorkdir).toBe(nested);
      expect(resolved.containerWorkdir).toBe("/sandbox-root/project");
      expect(warnings).toEqual([]);
    });
  });
});

describe("resolveWorkdir", () => {
  it("expands ~/ paths before checking the filesystem", async () => {
    await withTempDir(async (homeDir) => {
      const nested = path.join(homeDir, "skill-root");
      await mkdir(nested, { recursive: true });
      const originalHome = process.env.HOME;
      process.env.HOME = homeDir;
      try {
        const warnings: string[] = [];
        const resolved = resolveWorkdir("~/skill-root", warnings);
        expect(resolved).toBe(nested);
        expect(warnings).toEqual([]);
      } finally {
        if (originalHome === undefined) {
          delete process.env.HOME;
        } else {
          process.env.HOME = originalHome;
        }
      }
    });
  });
});
