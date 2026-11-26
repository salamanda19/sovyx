/**
 * Chat session must keep updating the store after the Chat page would
 * have unmounted — i.e. abort is only explicit, never implicit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useDashboardStore } from "@/stores/dashboard";
import { abortActiveChat, sendChatMessage } from "./chat-session";

vi.mock("@/lib/api", () => {
  class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = "ApiError";
    }
  }
  return {
    api: {
      post: vi.fn(),
      get: vi.fn(),
    },
    apiFetch: vi.fn().mockRejectedValue(new Error("SSE not available in test")),
    ApiError,
    isAbortError: (err: unknown) =>
      err instanceof DOMException && (err as DOMException).name === "AbortError",
    clearToken: vi.fn(),
  };
});

import { api } from "@/lib/api";

const mockApi = api as unknown as { post: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  abortActiveChat();
  useDashboardStore.getState().clearChat();
});

afterEach(() => {
  abortActiveChat();
});

describe("sendChatMessage", () => {
  it("persists assistant reply into the store via batch fallback", async () => {
    mockApi.post.mockResolvedValueOnce({
      response: "Kyoto answer",
      conversation_id: "conv-1",
      mind_id: "my-mind",
      timestamp: new Date().toISOString(),
      tags: ["brain"],
    });

    await sendChatMessage("Tell me about Kyoto");

    const state = useDashboardStore.getState();
    expect(state.chatLoading).toBe(false);
    expect(state.chatMessages).toHaveLength(2);
    expect(state.chatMessages[0]?.content).toBe("Tell me about Kyoto");
    expect(state.chatMessages[1]?.content).toBe("Kyoto answer");
    expect(state.chatConversationId).toBe("conv-1");
  });

  it("abortActiveChat cancels without leaving loading stuck", async () => {
    let resolvePost: ((v: unknown) => void) | undefined;
    mockApi.post.mockReturnValue(
      new Promise((resolve) => {
        resolvePost = resolve;
      }),
    );

    const pending = sendChatMessage("slow question");
    expect(useDashboardStore.getState().chatLoading).toBe(true);

    abortActiveChat();
    resolvePost?.({
      response: "late",
      conversation_id: "c",
      mind_id: "m",
      timestamp: new Date().toISOString(),
    });
    await pending;

    // AbortError path returns early; loading cleared in finally.
    expect(useDashboardStore.getState().chatLoading).toBe(false);
  });
});
