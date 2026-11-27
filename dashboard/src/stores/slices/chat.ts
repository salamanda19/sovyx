/**
 * Chat slice — state for the /chat direct conversation page.
 *
 * Streaming progress lives here (not in ChatPage local state) so an
 * in-flight request survives route changes away from /chat.
 *
 * Ref: DASH-03, DASH-04
 */
import type { StateCreator } from "zustand";
import type { ChatMessage } from "@/types/api";
import type { DashboardState } from "../dashboard";

export interface ChatCogPhase {
  phase: string;
  detail: string;
}

export interface ChatSlice {
  chatMessages: ChatMessage[];
  chatLoading: boolean;
  chatConversationId: string | null;
  chatError: string | null;
  chatStreamingText: string;
  chatCogPhase: ChatCogPhase | null;
  chatLastOutbound: string;
  addChatMessage: (msg: ChatMessage) => void;
  setChatMessages: (msgs: ChatMessage[]) => void;
  setChatLoading: (loading: boolean) => void;
  setChatConversationId: (id: string | null) => void;
  setChatError: (error: string | null) => void;
  setChatStreamingText: (text: string) => void;
  setChatCogPhase: (phase: ChatCogPhase | null) => void;
  setChatLastOutbound: (text: string) => void;
  clearChat: () => void;
}

export const createChatSlice: StateCreator<
  DashboardState,
  [],
  [],
  ChatSlice
> = (set) => ({
  chatMessages: [],
  chatLoading: false,
  chatConversationId: null,
  chatError: null,
  chatStreamingText: "",
  chatCogPhase: null,
  chatLastOutbound: "",
  addChatMessage: (msg) =>
    set((state) => ({ chatMessages: [...state.chatMessages, msg] })),
  setChatMessages: (msgs) => set({ chatMessages: msgs }),
  setChatLoading: (loading) => set({ chatLoading: loading }),
  setChatConversationId: (id) => set({ chatConversationId: id }),
  setChatError: (error) => set({ chatError: error }),
  setChatStreamingText: (text) => set({ chatStreamingText: text }),
  setChatCogPhase: (phase) => set({ chatCogPhase: phase }),
  setChatLastOutbound: (text) => set({ chatLastOutbound: text }),
  clearChat: () =>
    set({
      chatMessages: [],
      chatConversationId: null,
      chatLoading: false,
      chatError: null,
      chatStreamingText: "",
      chatCogPhase: null,
      chatLastOutbound: "",
    }),
});
