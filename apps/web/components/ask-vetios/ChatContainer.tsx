'use client';

import { useEffect, useRef, useMemo } from 'react';
import { useChatStore } from '@/store/useChatStore';
import ChatBubble from './ChatBubble';
import { TypingIndicator } from './RecentCases';
import { motion, AnimatePresence } from 'framer-motion';

interface ChatContainerProps {
    onFollowUp: (prompt: string) => void;
}

export default function ChatContainer({ onFollowUp }: ChatContainerProps) {
    const { chats, activeChatId, isLoading } = useChatStore();
    const scrollRef = useRef<HTMLDivElement>(null);

    const activeChat = useMemo(() => chats.find(c => c.id === activeChatId), [chats, activeChatId]);
    const messages = useMemo(() => activeChat?.messages ?? [], [activeChat]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isLoading]);

    if (!activeChatId) {
        return (
            <div className="flex-1 flex items-center justify-center p-12">
                <div className="text-center space-y-4">
                    <div className="w-16 h-16 bg-accent/10 border border-accent/20 flex items-center justify-center mx-auto">
                        <span className="text-accent font-mono text-xl font-bold">V_I</span>
                    </div>
                    <p className="font-mono text-xs text-white/30 uppercase tracking-widest">
                        Intelligence gateway ready
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-smooth">
            <div className="flex flex-col min-h-full">
                <AnimatePresence initial={false}>
                    {messages.map((message) => (
                        <ChatBubble
                            key={message.id}
                            message={message}
                            conversationMessages={messages}
                            onFollowUp={onFollowUp}
                        />
                    ))}
                </AnimatePresence>

                {isLoading && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        <TypingIndicator />
                    </motion.div>
                )}

                <div className="flex-1 min-h-[80px]" />
            </div>
        </div>
    );
}
