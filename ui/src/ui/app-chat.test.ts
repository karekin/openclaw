/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { handleSendChat, refreshChatAvatar, type ChatHost } from "./app-chat.ts";

function makeHost(overrides?: Partial<ChatHost>): ChatHost {
  return {
    client: null,
    chatMessages: [],
    chatStream: null,
    connected: true,
    chatMessage: "",
    chatAttachments: [],
    chatQueue: [],
    chatRunId: null,
    chatSending: false,
    chatToolMessages: [],
    chatStreamSegments: [],
    toolStreamSyncTimer: null,
    toolStreamById: new Map(),
    toolStreamOrder: [],
    lastError: null,
    sessionKey: "agent:main",
    basePath: "",
    hello: null,
    chatAvatarUrl: null,
    chatScrollFrame: null,
    chatHasAutoScrolled: false,
    updateComplete: Promise.resolve(),
    requestUpdate() {},
    scrollToBottom() {},
    settings: {
      lastActiveSessionKey: "agent:main",
    },
    applySettings(next: { lastActiveSessionKey?: string }) {
      this.settings = { ...this.settings, ...next };
    },
    refreshSessionsAfterChat: new Set<string>(),
    sessionsResult: null,
    ...overrides,
  };
}

describe("refreshChatAvatar", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses a route-relative avatar endpoint before basePath bootstrap finishes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ avatarUrl: "/avatar/main" }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const host = makeHost({ basePath: "", sessionKey: "agent:main" });
    await refreshChatAvatar(host);

    expect(fetchMock).toHaveBeenCalledWith(
      "avatar/main?meta=1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(host.chatAvatarUrl).toBe("/avatar/main");
  });

  it("keeps mounted dashboard avatar endpoints under the normalized base path", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const host = makeHost({ basePath: "/openclaw/", sessionKey: "agent:ops:main" });
    await refreshChatAvatar(host);

    expect(fetchMock).toHaveBeenCalledWith(
      "/openclaw/avatar/ops?meta=1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(host.chatAvatarUrl).toBeNull();
  });
});

describe("handleSendChat image guard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("blocks image send when the current model does not support image input", async () => {
    const request = vi.fn().mockImplementation(async (method: string) => {
      if (method === "models.list") {
        return {
          models: [{ id: "kimi-k2.5", name: "Kimi K2.5", provider: "moonshot", input: ["text"] }],
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const host = makeHost({
      client: { request } as never,
      chatMessage: "describe this image",
      chatAttachments: [{ id: "a1", mimeType: "image/png", dataUrl: "data:image/png;base64,AAAA" }],
      sessionsResult: {
        ts: Date.now(),
        path: "sessions.json",
        count: 1,
        defaults: { model: "moonshot/kimi-k2.5", contextTokens: null },
        sessions: [
          {
            key: "agent:main",
            kind: "direct",
            updatedAt: Date.now(),
            model: "kimi-k2.5",
            modelProvider: "moonshot",
          },
        ],
      },
    });

    await handleSendChat(host);

    expect(host.lastError).toContain("does not support image understanding");
    expect(host.chatMessage).toBe("describe this image");
    expect(host.chatAttachments).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("models.list", {});
  });

  it("allows image send when the current model supports image input", async () => {
    const request = vi.fn().mockImplementation(async (method: string) => {
      if (method === "models.list") {
        return {
          models: [
            { id: "kimi-k2.5", name: "Kimi K2.5", provider: "moonshot", input: ["text", "image"] },
          ],
        };
      }
      if (method === "chat.send") {
        return {};
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const host = makeHost({
      client: { request } as never,
      chatMessage: "describe this image",
      chatAttachments: [{ id: "a1", mimeType: "image/png", dataUrl: "data:image/png;base64,AAAA" }],
      sessionsResult: {
        ts: Date.now(),
        path: "sessions.json",
        count: 1,
        defaults: { model: "moonshot/kimi-k2.5", contextTokens: null },
        sessions: [
          {
            key: "agent:main",
            kind: "direct",
            updatedAt: Date.now(),
            model: "kimi-k2.5",
            modelProvider: "moonshot",
          },
        ],
      },
    });

    await handleSendChat(host);

    expect(host.lastError).toBeNull();
    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({ attachments: expect.any(Array) }),
    );
  });
});
