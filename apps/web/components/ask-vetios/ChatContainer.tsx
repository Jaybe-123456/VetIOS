'use client';

import { useEffect, useRef } from 'react';
import { useChatStore } from '@/store/useChatStore';
import ChatBubble from './ChatBubble';
import { TypingIndicator } from './RecentCases';
import { motion, AnimatePresence } from 'framer-motion';

export default function ChatContainer() {
  const { chats, activeChatId, isLoading } = useChatStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeChat = chats.find(c => c.id === activeChatId);
  const messages = activeChat?.messages ?? [];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  if (!activeChatId) {
    return (
      <div className="flex-1 flex items-center justify-center p-12">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 bg-accent/10 border border-accent/20 rounded-full flex items-center justify-center mx-auto animate-pulse">
            <span className="text-accent font-mono text-xl font-bold">V_I</span>
          </div>
          <p className="font-mono text-xs text-muted-foreground uppercase tracking-widest">
            Select a conversation to begin intelligence analysis
          </p>
        </div>
      </div>
    );
  }

  return (
    <div 
      ref={scrollRef}
      className="flex-1 overflow-y-auto scroll-smooth scrollbar-thin scrollbar-thumb-white/10"
    >
      <div className="flex flex-col min-h-full">
        <AnimatePresence initial={false}>
          {messages.map((message) => (
            <ChatBubble key={message.id} message={message} />
          ))}
        </AnimatePresence>

        {isLoading && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
          >
            <TypingIndicator />
          </motion.div>
        )}
        
        {/* Fill space to keep input at bottom if few messages */}
        <div className="flex-1 min-h-[100px]" />
      </div>
    </div>
  );
}
