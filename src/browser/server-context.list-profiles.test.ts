import { describe, expect, it, vi } from "vitest";
import "./server-context.chrome-test-harness.js";
import * as chromeModule from "./chrome.js";
import type { BrowserServerState } from "./server-context.js";
import { createBrowserRouteContext } from "./server-context.js";

function makeBrowserState(): BrowserServerState {
  return {
    // oxlint-disable-next-line typescript/no-explicit-any
    server: null as any,
    port: 0,
    resolved: {
      enabled: true,
      controlPort: 18791,
      cdpProtocol: "http",
      cdpHost: "127.0.0.1",
      cdpIsLoopback: true,
      cdpPortRangeStart: 18800,
      cdpPortRangeEnd: 18810,
      evaluateEnabled: false,
      remoteCdpTimeoutMs: 1500,
      remoteCdpHandshakeTimeoutMs: 3000,
      extraArgs: [],
      color: "#FF4500",
      headless: true,
      noSandbox: false,
      attachOnly: false,
      ssrfPolicy: { allowPrivateNetwork: true },
      defaultProfile: "openclaw",
      profiles: {
        openclaw: { cdpPort: 18800, color: "#FF4500" },
      },
    },
    profiles: new Map(),
  };
}

describe("browser server-context listProfiles", () => {
  it("does not report running from stale runtime state when CDP is not ready", async () => {
    const isChromeReachable = vi.mocked(chromeModule.isChromeReachable);
    const isChromeCdpReady = vi.mocked(chromeModule.isChromeCdpReady);
    isChromeReachable.mockResolvedValue(true);
    isChromeCdpReady.mockResolvedValue(false);

    const state = makeBrowserState();
    state.profiles.set("openclaw", {
      profile: {
        ...state.resolved.profiles.openclaw,
        name: "openclaw",
        cdpUrl: "http://127.0.0.1:18800",
        cdpIsLoopback: true,
        attachOnly: false,
        driver: "openclaw",
      },
      running: { pid: 1234, proc: { on: vi.fn() } } as never,
      lastTargetId: null,
    });

    const profiles = await createBrowserRouteContext({ getState: () => state }).listProfiles();

    expect(profiles).toEqual([
      expect.objectContaining({
        name: "openclaw",
        driver: "openclaw",
        running: false,
        tabCount: 0,
      }),
    ]);
  });

  it("does not report http-only local profiles as running when CDP is not ready", async () => {
    const isChromeReachable = vi.mocked(chromeModule.isChromeReachable);
    const isChromeCdpReady = vi.mocked(chromeModule.isChromeCdpReady);
    isChromeReachable.mockResolvedValue(true);
    isChromeCdpReady.mockResolvedValue(false);

    const state = makeBrowserState();
    state.resolved.defaultProfile = "chrome";
    state.resolved.profiles.chrome = {
      driver: "extension",
      cdpUrl: "http://127.0.0.1:18792",
      color: "#00AA00",
    };

    const profiles = await createBrowserRouteContext({ getState: () => state }).listProfiles();

    expect(profiles).toEqual([
      expect.objectContaining({
        name: "openclaw",
        driver: "openclaw",
        running: false,
        tabCount: 0,
      }),
      expect.objectContaining({
        name: "chrome",
        driver: "extension",
        extensionConnected: null,
        running: false,
        tabCount: 0,
      }),
    ]);
  });
});
