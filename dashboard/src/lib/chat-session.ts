/**
 * Chat session runner that outlives the Chat page.
 *
 * Navigating to another dashboard route unmounts ChatPage. The old page
 * aborted its in-flight SSE on unmount, which cancelled the server saga
 * and skipped conversation persistence. This module owns the AbortController
 * and writes all progress into the Zustand store so the request keeps
 * running across route changes.
 */
import { api, apiFetch, ApiError, clearToken, isAbortError } from "@/lib/api";
import { ChatResponseSchema } from "@/types/schemas";
import type { ChatMessage, ChatResponse } from "@/types/api";
import { useDashboardStore } from "@/stores/dashboard";

function localId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

let activeAbort: AbortController | null = null;

/** Cancel the in-flight chat request (New Chat / superseding send). */
export function abortActiveChat(): void {
  activeAbort?.abort();
  activeAbort = null;
}

export function isChatRequestActive(): boolean {
  return activeAbort !== null;
}

/**
 * Send a chat message via SSE (batch fallback). Safe to call while the
 * Chat page is unmounted — results land in the dashboard store.
 */
export async function sendChatMessage(
  text: string,
  options?: { loadFailedMessage?: string },
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  const store = useDashboardStore.getState();
  if (store.chatLoading) return;

  const conversationId = store.chatConversationId;
  const loadFailedMessage = options?.loadFailedMessage ?? "Failed to send message";

  store.setChatError(null);
  store.setChatLastOutbound(trimmed);
  store.setChatStreamingText("");
  store.setChatCogPhase(null);
  store.addChatMessage({
    id: localId(),
    role: "user",
    content: trimmed,
    timestamp: new Date().toISOString(),
  });
  store.setChatLoading(true);

  abortActiveChat();
  const controller = new AbortController();
  activeAbort = controller;

  const patch = () => useDashboardStore.getState();

  try {
    const resp = await apiFetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: trimmed,
        user_name: "Dashboard",
        conversation_id: conversationId,
      }),
      signal: controller.signal,
    });

    if (resp.status === 401) {
      clearToken();
      patch().setAuthenticated(false);
      patch().setShowTokenModal(true);
      throw new ApiError(401, "Unauthorized");
    }

    if (!resp.ok || !resp.body) {
      throw new Error("SSE not available");
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let accumulated = "";
    let doneData: Record<string, unknown> | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      let currentEventType = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEventType = line.slice(7).trim();
        } else if (line.startsWith("data: ") && currentEventType) {
          const data = line.slice(6);
          try {
            const parsed = JSON.parse(data) as Record<string, unknown>;
            if (currentEventType === "token") {
              const chunk = String(parsed.text ?? "");
              accumulated += chunk;
              patch().setChatStreamingText(accumulated);
            } else if (currentEventType === "phase") {
              patch().setChatCogPhase({
                phase: String(parsed.phase ?? ""),
                detail: String(parsed.detail ?? ""),
              });
            } else if (currentEventType === "done") {
              doneData = parsed;
            } else if (currentEventType === "error") {
              throw new Error(String(parsed.error ?? "Stream error"));
            }
          } catch (e) {
            if (e instanceof Error && e.message !== "Stream error") {
              // JSON parse error — skip malformed event
            } else {
              throw e;
            }
          }
          currentEventType = "";
        } else if (line === "") {
          currentEventType = "";
        }
      }
    }

    patch().setChatCogPhase(null);
    patch().setChatStreamingText("");

    const finalResponse = String(doneData?.response ?? accumulated);
    const finalConvId = String(
      doneData?.conversation_id ?? conversationId ?? "",
    );
    const finalTags = (doneData?.tags as string[] | undefined) ?? ["brain"];
    if (finalConvId && finalConvId !== patch().chatConversationId) {
      patch().setChatConversationId(finalConvId);
    }

    const aiMsg: ChatMessage = {
      id: localId(),
      role: "assistant",
      content: finalResponse,
      timestamp: (doneData?.timestamp as string) ?? new Date().toISOString(),
      tags: finalTags,
      mind_id: doneData?.mind_id as string | undefined,
      model: doneData?.model as string | undefined,
      tokens_in: doneData?.tokens_in as number | undefined,
      tokens_out: doneData?.tokens_out as number | undefined,
      cost_usd: doneData?.cost_usd as number | undefined,
      latency_ms: doneData?.latency_ms as number | undefined,
      provider: doneData?.provider as string | undefined,
    };
    patch().addChatMessage(aiMsg);
  } catch (err) {
    if (isAbortError(err)) return;

    if (err instanceof ApiError && err.status === 401) {
      return;
    }

    try {
      const resp = await api.post<ChatResponse>(
        "/api/chat",
        {
          message: trimmed,
          user_name: "Dashboard",
          conversation_id: conversationId,
        },
        { signal: controller.signal, schema: ChatResponseSchema },
      );
      if (
        resp.conversation_id &&
        resp.conversation_id !== patch().chatConversationId
      ) {
        patch().setChatConversationId(resp.conversation_id);
      }
      patch().addChatMessage({
        id: localId(),
        role: "assistant",
        content: resp.response,
        timestamp: resp.timestamp ?? new Date().toISOString(),
        mind_id: resp.mind_id,
        tags: resp.tags,
        model: resp.model,
        tokens_in: resp.tokens_in,
        tokens_out: resp.tokens_out,
        cost_usd: resp.cost_usd,
        latency_ms: resp.latency_ms,
        provider: resp.provider,
      });
    } catch (fallbackErr) {
      if (isAbortError(fallbackErr)) return;
      patch().setChatError(loadFailedMessage);
    }
  } finally {
    if (activeAbort === controller) {
      activeAbort = null;
    }
    const s = patch();
    s.setChatLoading(false);
    s.setChatStreamingText("");
    s.setChatCogPhase(null);
  }
}
