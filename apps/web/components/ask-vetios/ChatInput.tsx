'use client';

import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Send, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export default function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (input.trim() && !disabled) {
      onSend(input.trim());
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'inherit';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input]);

  return (
    <div className="p-4 safe-bottom">
      <form 
        onSubmit={handleSubmit}
        className="relative max-w-4xl mx-auto flex items-end gap-2"
      >
        <div className="relative flex-1 group">
          <div className="absolute inset-0 bg-accent/5 rounded-xl blur-xl group-focus-within:bg-accent/10 transition-all duration-500" />
          
          <div className="relative bg-[#0a0a0a]/80 backdrop-blur-md border border-white/10 group-focus-within:border-accent/40 rounded-xl px-4 py-2 transition-all duration-300">
            <div className="flex items-center gap-2 mb-1">
              <Terminal className="w-3 h-3 text-accent/50" />
              <span className="text-[9px] uppercase tracking-[0.2em] text-accent/50 font-mono font-bold">Command_Input</span>
            </div>
            
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask VetIOS..."
              className="w-full bg-transparent border-none focus:ring-0 text-white/90 placeholder:text-white/20 font-mono text-sm resize-none py-1 max-h-48 scrollbar-hide"
              rows={1}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={!input.trim() || disabled}
          className={cn(
            "w-12 h-12 flex items-center justify-center rounded-xl border transition-all duration-300",
            input.trim() && !disabled
              ? "bg-accent border-accent text-black shadow-[0_0_20px_rgba(0,255,102,0.3)] hover:scale-105 active:scale-95"
              : "bg-white/5 border-white/10 text-white/20 cursor-not-allowed"
          )}
        >
          <Send className="w-5 h-5" />
        </button>
      </form>
    </div>
  );
}
