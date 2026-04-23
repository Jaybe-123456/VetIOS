'use client';

import { Message } from '@/store/useChatStore';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { TerminalSquare, User } from 'lucide-react';
import SmartActions from './SmartActions';

interface ChatBubbleProps {
  message: Message;
}

export default function ChatBubble({ message }: ChatBubbleProps) {
  const isAssistant = message.role === 'assistant';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex w-full gap-4 p-6 transition-colors",
        isAssistant ? "bg-panel/40 border-y border-white/5" : "bg-transparent"
      )}
    >
      <div className="flex-shrink-0">
        <div className={cn(
          "w-8 h-8 flex items-center justify-center rounded-sm border",
          isAssistant 
            ? "bg-accent/10 border-accent/30 text-accent" 
            : "bg-white/5 border-white/10 text-muted-foreground"
        )}>
          {isAssistant ? <TerminalSquare className="w-4 h-4" /> : <User className="w-4 h-4" />}
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-hidden">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {isAssistant ? "VETIOS_AI // KOS-MOS" : "USER_OPERATOR"}
          </span>
          <span className="text-[10px] text-white/20 font-mono tracking-tighter">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        <div className={cn(
          "font-mono text-sm leading-relaxed tracking-tight max-w-3xl",
          isAssistant ? "text-white/90" : "text-white/70"
        )}>
          {message.content}
        </div>

        {isAssistant && message.metadata && (
          <SmartActions metadata={message.metadata} />
        )}
      </div>
    </motion.div>
  );
}
