import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type MessageMode = 'educational' | 'clinical' | 'general' | 'operational';

export interface MessageMetadata {
    mode: MessageMode;
    topic?: string;
    diagnosis_ranked?: { name: string; confidence: number; reasoning: string }[];
    urgency_level?: 'low' | 'moderate' | 'high' | 'critical' | 'emergency';
    recommended_tests?: string[];
    red_flags?: string[];
    explanation?: string;
    ensemble_metadata?: {
        openai_status: 'success' | 'failed' | 'disabled';
        hf_status: 'success' | 'failed' | 'disabled';
        hf_raw_output?: string;
    };
}

export interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    metadata?: MessageMetadata;
}

export interface Chat {
    id: string;
    title: string;
    messages: Message[];
    createdAt: number;
}

interface ChatState {
    chats: Chat[];
    activeChatId: string | null;
    isLoading: boolean;
    username: string | null;
    userTier: 'free' | 'premium';
    dailyMessageCount: number;
    lastResetTimestamp: number | null;
    setUsername: (username: string | null) => void;
    setTier: (tier: 'free' | 'premium') => void;
    incrementUsage: () => boolean; // Returns true if allowed, false if limit exceeded
    addMessage: (chatId: string, message: Omit<Message, 'id' | 'timestamp'>) => void;
    createChat: (title?: string) => string;
    deleteChat: (chatId: string) => void;
    switchChat: (chatId: string) => void;
    setLoading: (loading: boolean) => void;
    renameChat: (chatId: string, title: string) => void;
    clearAllChats: () => void;
}

export const useChatStore = create<ChatState>()(
    persist(
        (set) => ({
            chats: [],
            activeChatId: null,
            isLoading: false,
            username: null,
            userTier: 'free',
            dailyMessageCount: 0,
            lastResetTimestamp: null,
            setUsername: (username) => set({ username }),
            setTier: (tier) => set({ userTier: tier }),

            incrementUsage: () => {
                let allowed = true;
                const SIX_HOURS = 6 * 60 * 60 * 1000;
                
                set((state) => {
                    const now = Date.now();
                    const shouldReset = !state.lastResetTimestamp || (now - state.lastResetTimestamp > SIX_HOURS);
                    
                    const newCount = shouldReset ? 1 : state.dailyMessageCount + 1;
                    const newTimestamp = shouldReset ? now : state.lastResetTimestamp;
                    
                    if (state.userTier === 'free' && newCount > 40) {
                        allowed = false;
                        return state;
                    }
                    
                    return { dailyMessageCount: newCount, lastResetTimestamp: newTimestamp };
                });
                return allowed;
            },

            setLoading: (loading) => set({ isLoading: loading }),

            createChat: (title = 'New Consultation') => {
                const id = crypto.randomUUID();
                const newChat: Chat = {
                    id,
                    title,
                    messages: [{
                        id: 'welcome',
                        role: 'assistant',
                        content: "VetIOS intelligence gateway online. I can answer clinical questions, provide research-depth explanations of any veterinary condition, pathogen, or drug, and assist with differential diagnosis. What would you like to explore?",
                        timestamp: Date.now(),
                        metadata: { mode: 'general' },
                    }],
                    createdAt: Date.now(),
                };
                set((state) => ({ chats: [newChat, ...state.chats], activeChatId: id }));
                return id;
            },

            addMessage: (chatId, message) => {
                const newMessage: Message = {
                    ...message,
                    id: crypto.randomUUID(),
                    timestamp: Date.now(),
                };
                set((state) => ({
                    chats: state.chats.map((chat) =>
                        chat.id === chatId
                            ? {
                                ...chat,
                                messages: [...chat.messages, newMessage],
                                title: chat.messages.length === 1 && message.role === 'user'
                                    ? message.content.slice(0, 38) + (message.content.length > 38 ? '…' : '')
                                    : chat.title,
                            }
                            : chat
                    ),
                }));
            },

            renameChat: (chatId, title) => {
                set((state) => ({
                    chats: state.chats.map((c) => c.id === chatId ? { ...c, title } : c),
                }));
            },

            deleteChat: (chatId) => {
                set((state) => {
                    const remaining = state.chats.filter((c) => c.id !== chatId);
                    return {
                        chats: remaining,
                        activeChatId: state.activeChatId === chatId
                            ? (remaining[0]?.id ?? null)
                            : state.activeChatId,
                    };
                });
            },

            switchChat: (chatId) => set({ activeChatId: chatId }),

            clearAllChats: () => set({ chats: [], activeChatId: null }),
        }),
        { name: 'vetios-chat-v2' }
    )
);
