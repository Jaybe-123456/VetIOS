import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  metadata?: {
    query_type?: 'clinical' | 'educational' | 'general';
    diagnosis_ranked?: { disease: string; probability: number }[];
    urgency_level?: 'low' | 'medium' | 'high' | 'critical' | 'info';
    recommended_tests?: string[];
    explanation?: string;
  };
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
  
  addMessage: (chatId: string, message: Omit<Message, 'id' | 'timestamp'>) => void;
  createChat: (title?: string) => string;
  deleteChat: (chatId: string) => void;
  switchChat: (chatId: string) => void;
  setLoading: (loading: boolean) => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      chats: [],
      activeChatId: null,
      isLoading: false,

      setLoading: (loading) => set({ isLoading: loading }),

      createChat: (title = 'New Consultation') => {
        const id = Math.random().toString(36).substring(7);
        const newChat: Chat = {
          id,
          title,
          messages: [
            {
              id: 'welcome',
              role: 'assistant',
              content: "Hello! I'm VetIOS, your veterinary intelligence assistant. How can I help you today?",
              timestamp: Date.now(),
            }
          ],
          createdAt: Date.now(),
        };
        set((state) => ({
          chats: [newChat, ...state.chats],
          activeChatId: id,
        }));
        return id;
      },

      addMessage: (chatId, message) => {
        const newMessage: Message = {
          ...message,
          id: Math.random().toString(36).substring(7),
          timestamp: Date.now(),
        };

        set((state) => ({
          chats: state.chats.map((chat) =>
            chat.id === chatId
              ? {
                  ...chat,
                  messages: [...chat.messages, newMessage],
                  // Auto-update title from first user message
                  title: chat.messages.length === 1 && message.role === 'user' 
                    ? message.content.slice(0, 30) + (message.content.length > 30 ? '...' : '')
                    : chat.title
                }
              : chat
          ),
        }));
      },

      deleteChat: (chatId) => {
        set((state) => ({
          chats: state.chats.filter((c) => c.id !== chatId),
          activeChatId: state.activeChatId === chatId ? (state.chats.length > 1 ? state.chats[0].id : null) : state.activeChatId,
        }));
      },

      switchChat: (chatId) => {
        set({ activeChatId: chatId });
      },
    }),
    {
      name: 'vetios-chat-storage',
    }
  )
);
