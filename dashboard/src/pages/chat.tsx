/**
 * Chat page — streaming conversation with cognitive transparency.
 *
 * Uses SSE (POST /api/chat/stream) for token-by-token rendering with
 * cognitive phase indicators. Falls back to batch POST /api/chat on
 * SSE failure.
 *
 * The request itself lives in ``lib/chat-session`` so navigating to
 * another dashboard page does not abort an in-flight reply.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  MessageSquareIcon,
  SendIcon,
  PlusIcon,
  Loader2Icon,
  AlertTriangleIcon,
  ArrowDownIcon,
  PanelLeftIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDashboardStore } from "@/stores/dashboard";
import { api } from "@/lib/api";
import { abortActiveChat, sendChatMessage } from "@/lib/chat-session";
import { cn } from "@/lib/utils";
import { MarkdownContent, MessageTags, MessageMeta, CognitiveProgress, StreamingMessage } from "@/components/chat";
import { ConversationSidebar } from "@/components/chat/conversation-sidebar";
import { EmptyState } from "@/components/empty-state";
import { formatTimeShort } from "@/lib/format";
import { LetterAvatar, MindAvatar } from "@/components/dashboard/letter-avatar";
import { ErrorBoundary } from "@/components/error-boundary";

export default function ChatPage() {
  const { t } = useTranslation(["chat", "common"]);

  const messages = useDashboardStore((s) => s.chatMessages);
  const loading = useDashboardStore((s) => s.chatLoading);
  const conversationId = useDashboardStore((s) => s.chatConversationId);
  const error = useDashboardStore((s) => s.chatError);
  const streamingText = useDashboardStore((s) => s.chatStreamingText);
  const cogPhase = useDashboardStore((s) => s.chatCogPhase);
  const lastMessage = useDashboardStore((s) => s.chatLastOutbound);
  const setMessages = useDashboardStore((s) => s.setChatMessages);
  const setConversationId = useDashboardStore((s) => s.setChatConversationId);
  const setError = useDashboardStore((s) => s.setChatError);
  const clearChat = useDashboardStore((s) => s.clearChat);

  const [input, setInput] = useState("");
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mood, setMood] = useState<{ label: string; quadrant: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const userScrolledRef = useRef(false);

  // ── Smart auto-scroll ──
  useEffect(() => {
    if (!userScrolledRef.current && bottomRef.current && typeof bottomRef.current.scrollIntoView === "function") {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, loading, streamingText]);

  useEffect(() => {
    const el = scrollAreaRef.current?.querySelector("[data-radix-scroll-area-viewport]");
    if (!el) return;
    const handleScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      userScrolledRef.current = !near;
      setShowScrollBtn(!near);
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToBottom = useCallback(() => {
    userScrolledRef.current = false;
    setShowScrollBtn(false);
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { inputRef.current?.focus(); }, []);
  // Intentionally do NOT abort on unmount — switching dashboard tabs must
  // leave the SSE request running so the reply can finish and persist.

  useEffect(() => {
    api
      .get<{ label: string; quadrant: string; episode_count: number }>("/api/emotions/current")
      .then((r) => { if (r.episode_count > 0) setMood({ label: r.label, quadrant: r.quadrant }); })
      .catch(() => {});
  }, []);

  // After a mid-stream disconnect the store may miss the assistant turn.
  // When Chat remounts (or loading settles) with a known id, reload from DB.
  useEffect(() => {
    if (loading || !conversationId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.get<{
          conversation_id: string;
          messages: Array<{
            id: string;
            role: string;
            content: string;
            timestamp: string;
            tags?: string[];
          }>;
        }>(`/api/conversations/${conversationId}`);
        if (cancelled) return;
        const s = useDashboardStore.getState();
        if (s.chatLoading || s.chatConversationId !== conversationId) return;
        const serverMsgs = (res.messages ?? []).map((msg) => ({
          id: msg.id,
          role: msg.role as "user" | "assistant",
          content: msg.content,
          timestamp: msg.timestamp,
          tags: msg.tags,
        }));
        // Prefer server when it has the later assistant turn we missed.
        if (serverMsgs.length >= s.chatMessages.length) {
          setMessages(serverMsgs);
        }
      } catch {
        // Keep in-memory turns if reload fails.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, conversationId, setMessages]);

  const sendMessageText = useCallback(async (text: string) => {
    if (!text || useDashboardStore.getState().chatLoading) return;
    setInput("");
    userScrolledRef.current = false;
    await sendChatMessage(text, { loadFailedMessage: t("error.loadFailed") });
    inputRef.current?.focus();
  }, [t]);

  const sendMessage = useCallback(() => {
    void sendMessageText(input.trim());
  }, [input, sendMessageText]);

  const retryLastMessage = useCallback(() => {
    if (lastMessage) {
      setError(null);
      void sendMessageText(lastMessage);
    }
  }, [lastMessage, sendMessageText, setError]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);
      const el = e.target;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    },
    [],
  );

  const handleNewChat = useCallback(() => {
    abortActiveChat();
    clearChat();
    setInput("");
    inputRef.current?.focus();
  }, [clearChat]);

  const handleSelectConversation = useCallback(
    async (id: string) => {
      abortActiveChat();
      try {
        const res = await api.get<{ messages: Array<{ id: string; role: string; content: string; timestamp: string; tags?: string[] }> }>(
          `/api/conversations/${id}`,
        );
        clearChat();
        setConversationId(id);
        setMessages(
          (res.messages ?? []).map((msg) => ({
            id: msg.id,
            role: msg.role as "user" | "assistant",
            content: msg.content,
            timestamp: msg.timestamp,
            tags: msg.tags,
          })),
        );
      } catch {
        // Graceful
      }
      setSidebarOpen(false);
    },
    [clearChat, setConversationId, setMessages],
  );

  return (
    <div className="flex h-full" data-testid="chat-page">
      {/* Conversation Sidebar */}
      {sidebarOpen && (
        <ConversationSidebar
          activeId={conversationId}
          onSelect={(id) => void handleSelectConversation(id)}
          onNew={() => {
            handleNewChat();
            setSidebarOpen(false);
          }}
          className="w-64 shrink-0"
        />
      )}

      <div className="flex flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--svx-color-border-subtle)] px-6 py-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="rounded-[var(--svx-radius-md)] p-1.5 text-[var(--svx-color-text-tertiary)] transition-colors hover:bg-[var(--svx-color-bg-hover)] hover:text-[var(--svx-color-text-secondary)]"
              aria-label="Toggle conversations"
            >
              <PanelLeftIcon className="size-4" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold text-[var(--svx-color-text-primary)]">{t("title")}</h1>
                {mood && (
                  <span className="flex items-center gap-1.5 rounded-full bg-[var(--svx-color-bg-elevated)] px-2 py-0.5 text-[10px] text-[var(--svx-color-text-tertiary)]">
                    <span
                      className="size-1.5 rounded-full"
                      style={{
                        backgroundColor:
                          mood.quadrant === "positive_active" ? "#f59e0b"
                            : mood.quadrant === "positive_passive" ? "#14b8a6"
                            : mood.quadrant === "negative_active" ? "#f87171"
                            : mood.quadrant === "negative_passive" ? "#818cf8"
                            : "#94a3b8",
                      }}
                    />
                    {mood.label}
                  </span>
                )}
              </div>
              <p className="text-sm text-[var(--svx-color-text-secondary)]">{t("subtitle")}</p>
            </div>
          </div>
          {messages.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleNewChat} className="gap-2">
              <PlusIcon className="size-4" />
              {t("newChat")}
            </Button>
          )}
        </div>

      {/* Message Thread */}
      <ErrorBoundary name="section.chat.thread" variant="section">
        <div className="relative flex-1" ref={scrollAreaRef}>
          <ScrollArea className="h-full">
            <div className="mx-auto max-w-3xl">
              {messages.length === 0 && !loading ? (
                <EmptyState
                  icon={<MessageSquareIcon className="size-8" />}
                  title={t("empty.title")}
                  description={t("empty.description")}
                  className="h-[60vh]"
                />
              ) : (
                <div className="space-y-1 py-4">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn(
                        "flex gap-3 px-4 py-2",
                        msg.role === "user" ? "flex-row-reverse" : "flex-row",
                      )}
                    >
                      <div className="shrink-0 pt-1">
                        {msg.role === "user" ? <LetterAvatar name={t("you")} /> : <MindAvatar />}
                      </div>
                      <div className={cn("max-w-[75%] space-y-1", msg.role === "user" ? "items-end" : "items-start")}>
                        {msg.role === "assistant" && msg.tags && msg.tags.length > 0 && (
                          <MessageTags tags={msg.tags} />
                        )}
                        <div
                          className={cn(
                            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                            msg.role === "user"
                              ? "rounded-tr-sm bg-[var(--svx-color-brand-subtle)] text-[var(--svx-color-text-primary)]"
                              : "rounded-tl-sm bg-[var(--svx-color-bg-elevated)] text-[var(--svx-color-text-primary)]",
                          )}
                        >
                          {msg.role === "user" ? (
                            <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                          ) : (
                            <MarkdownContent content={msg.content} />
                          )}
                        </div>
                        <div className="flex items-center gap-2 px-1">
                          <span className="text-[10px] text-[var(--svx-color-text-secondary)]">
                            {formatTimeShort(msg.timestamp)}
                          </span>
                          {msg.role === "assistant" && (
                            <MessageMeta
                              model={msg.model}
                              tokensIn={msg.tokens_in}
                              tokensOut={msg.tokens_out}
                              costUsd={msg.cost_usd}
                              latencyMs={msg.latency_ms}
                              provider={msg.provider}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Streaming: cognitive progress + live text */}
                  {loading && (
                    <div className="flex gap-3 px-4 py-2" data-testid="chat-loading">
                      <div className="shrink-0 pt-1">
                        <MindAvatar />
                      </div>
                      <div className="max-w-[75%] space-y-1">
                        {cogPhase && !streamingText && (
                          <CognitiveProgress phase={cogPhase.phase} detail={cogPhase.detail} />
                        )}
                        {streamingText ? (
                          <div className="rounded-2xl rounded-tl-sm bg-[var(--svx-color-bg-elevated)] px-4 py-2.5 text-sm leading-relaxed text-[var(--svx-color-text-primary)]">
                            <StreamingMessage text={streamingText} complete={false} />
                          </div>
                        ) : !cogPhase ? (
                          <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm bg-[var(--svx-color-bg-elevated)] px-4 py-2.5">
                            <Loader2Icon className="size-4 animate-spin text-[var(--svx-color-brand-primary)]" />
                            <span className="text-sm text-[var(--svx-color-text-secondary)]">{t("thinking")}</span>
                          </div>
                        ) : null}
                        {cogPhase && streamingText && (
                          <div className="px-1 text-[10px] text-[var(--svx-color-text-disabled)]">
                            {cogPhase.phase}
                            {cogPhase.detail && ` — ${cogPhase.detail}`}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div ref={bottomRef} />
                </div>
              )}
            </div>
          </ScrollArea>

          {showScrollBtn && (
            <button
              type="button"
              onClick={scrollToBottom}
              className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-[var(--svx-color-border-default)] bg-[var(--svx-color-bg-surface)] p-2 shadow-lg transition-opacity hover:bg-[var(--svx-color-bg-elevated)]"
              aria-label="Scroll to bottom"
            >
              <ArrowDownIcon className="size-4 text-[var(--svx-color-text-secondary)]" />
            </button>
          )}
        </div>
      </ErrorBoundary>

      {/* Error Banner with Retry */}
      {error && (
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-6 py-2 text-sm text-red-400">
          <AlertTriangleIcon className="size-4 shrink-0" />
          <span>{error}</span>
          {lastMessage && (
            <Button variant="ghost" size="sm" onClick={retryLastMessage} className="ml-2 text-xs">
              {t("common:actions.retry")}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setError(null)} className="ml-auto text-xs">
            {t("common:actions.dismiss")}
          </Button>
        </div>
      )}

      {/* Input Area */}
      <ErrorBoundary name="section.chat.input" variant="section">
        <div className="border-t border-[var(--svx-color-border-subtle)] px-6 py-4">
          <div className="mx-auto flex max-w-3xl items-end gap-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={t("placeholder")}
              disabled={loading}
              rows={1}
              className={cn(
                "flex-1 resize-none rounded-xl border border-[var(--svx-color-border-default)]",
                "bg-[var(--svx-color-bg-elevated)] px-4 py-3 text-sm",
                "text-[var(--svx-color-text-primary)] placeholder:text-[var(--svx-color-text-disabled)]",
                "focus:border-[var(--svx-color-brand-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--svx-color-brand-primary)]",
                "disabled:opacity-50 transition-colors",
              )}
              data-testid="chat-input"
            />
            <Button
              onClick={sendMessage}
              disabled={!input.trim() || loading}
              size="icon"
              className={cn(
                "size-11 shrink-0 rounded-xl",
                "bg-[var(--svx-color-brand-primary)] hover:bg-[var(--svx-color-brand-hover)]",
                "text-[var(--svx-color-text-inverse)] disabled:opacity-50",
              )}
              data-testid="chat-send"
            >
              {loading ? <Loader2Icon className="size-5 animate-spin" /> : <SendIcon className="size-5" />}
            </Button>
          </div>
        </div>
      </ErrorBoundary>
      </div>
    </div>
  );
}
