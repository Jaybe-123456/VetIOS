'use client';

import { Message } from '@/store/useChatStore';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { TerminalSquare, User } from 'lucide-react';
import SmartActions from './SmartActions';
import VetIOSMarkdown from './VetIOSMarkdown';

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
        isAssistant ? "bg-white/[0.03] border-y border-white/[0.06]" : "bg-transparent"
      )}
    >
      <div className="flex-shrink-0">
        <div className={cn(
          "w-8 h-8 flex items-center justify-center rounded-sm border shrink-0",
          isAssistant
            ? "bg-accent/10 border-accent/40 text-accent shadow-[0_0_10px_hsl(142_76%_46%_/_0.2)]"
            : "bg-white/5 border-white/10 text-white/50"
        )}>
          {isAssistant ? <TerminalSquare className="w-4 h-4" /> : <User className="w-4 h-4" />}
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-hidden">
        <div className="flex items-center gap-2">
          <span className={cn(
            "font-mono text-[10px] uppercase tracking-widest",
            isAssistant ? "text-accent/70" : "text-white/40"
          )}>
            {isAssistant ? "VETIOS_AI // KOS-MOS" : "USER_OPERATOR"}
          </span>
          <span className="w-1 h-1 rounded-full bg-white/20 shrink-0" />
          <span className="text-[10px] text-white/25 font-mono">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        <div className="max-w-3xl">
          {isAssistant ? (
            <VetIOSMarkdown
              content={message.content}
              queryType={message.metadata?.query_type as 'clinical' | 'educational' | 'general' | undefined}
            />
          ) : (
            <p className="font-mono text-sm leading-relaxed tracking-tight text-white/70">
              {message.content}
            </p>
          )}
        </div>

        {isAssistant && message.metadata && (
          <SmartActions metadata={message.metadata} />
        )}
      </div>
    </motion.div>
  );
}
