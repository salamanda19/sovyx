/**
 * Chat session must keep updating the store after the Chat page would
 * have unmounted — i.e. abort is only explicit, never implicit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useDashboardStore } from "@/stores/dashboard";
import {
  abortActiveChat,
  EMPTY_ASSISTANT_FALLBACK,
  pickFinalAssistantText,
  sendChatMessage,
} from "./chat-session";

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

import { api, apiFetch } from "@/lib/api";

const mockApi = api as unknown as { post: ReturnType<typeof vi.fn> };
const mockApiFetch = apiFetch as unknown as ReturnType<typeof vi.fn>;

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i]));
      i += 1;
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

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

  it("sets conversation_id from early SSE conversation event", async () => {
    mockApiFetch.mockResolvedValueOnce(
      sseResponse([
        'event: conversation\ndata: {"conversation_id":"conv-early"}\n\n',
        'event: token\ndata: {"text":"Hi"}\n\n',
        'event: done\ndata: {"response":"Hi","conversation_id":"conv-early","tags":["brain"]}\n\n',
      ]),
    );

    await sendChatMessage("hello");

    const state = useDashboardStore.getState();
    expect(state.chatConversationId).toBe("conv-early");
    expect(state.chatMessages).toHaveLength(2);
    expect(state.chatMessages[1]?.content).toBe("Hi");
    expect(state.chatLoading).toBe(false);
  });

  it("uses streamed tokens when done.response is an empty string", async () => {
    mockApiFetch.mockResolvedValueOnce(
      sseResponse([
        'event: token\ndata: {"text":"streamed body"}\n\n',
        'event: done\ndata: {"response":"","conversation_id":"conv-empty","tags":["web-intelligence","brain"]}\n\n',
      ]),
    );

    await sendChatMessage("weather again");

    const assistant = useDashboardStore.getState().chatMessages[1];
    expect(assistant?.content).toBe("streamed body");
    expect(assistant?.tags).toEqual(["web-intelligence", "brain"]);
  });

  it("uses fixed note when done.response and stream are both empty", async () => {
    mockApiFetch.mockResolvedValueOnce(
      sseResponse([
        'event: done\ndata: {"response":"","conversation_id":"conv-blank","tags":["brain"]}\n\n',
      ]),
    );

    await sendChatMessage("blank turn");

    const assistant = useDashboardStore.getState().chatMessages[1];
    expect(assistant?.content).toBe(EMPTY_ASSISTANT_FALLBACK);
  });
});

describe("pickFinalAssistantText", () => {
  it("ignores empty-string response for nullish-style fallback", () => {
    expect(pickFinalAssistantText("", "from stream")).toBe("from stream");
    expect(pickFinalAssistantText("   ", "")).toBe(EMPTY_ASSISTANT_FALLBACK);
    expect(pickFinalAssistantText("kept", "ignored")).toBe("kept");
  });
});
