'use client';

import { useState, useRef, useEffect } from 'react';
import { Loader2, Plus, Send, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChatInputProps {
  onSend: (message: string) => void;
  onUploadFile?: (file: File) => void;
  disabled?: boolean;
  uploadDisabled?: boolean;
  voiceDraft?: { id: string; text: string } | null;
}

export default function ChatInput({ onSend, onUploadFile, disabled, uploadDisabled, voiceDraft }: ChatInputProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file && onUploadFile && !disabled && !uploadDisabled) {
      onUploadFile(file);
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'inherit';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input]);

  useEffect(() => {
    if (!voiceDraft?.text) return;
    setInput(voiceDraft.text);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [voiceDraft]);

  return (
    <div
      className="relative z-10 px-3 pt-3"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0.75rem))' }}
    >
      {/* Top accent bar — draws the eye to the input zone */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-accent/60 to-transparent" />

      <form
        onSubmit={handleSubmit}
        className="relative max-w-4xl mx-auto flex items-end gap-2"
      >
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".pdf,.docx,.ppt,.pptx,.txt,.md,.csv,.xlsx,.json"
          onChange={handleFileChange}
        />
        <button
          type="button"
          disabled={disabled || uploadDisabled || !onUploadFile}
          title="Upload clinical file"
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "w-12 h-12 shrink-0 flex items-center justify-center rounded-xl border-2 transition-all duration-300",
            disabled || uploadDisabled || !onUploadFile
              ? "bg-white/[0.02] border-white/8 text-white/20 cursor-not-allowed"
              : "bg-accent/5 border-accent/25 text-accent hover:bg-accent/10 hover:border-accent/60 active:scale-95"
          )}
        >
          {uploadDisabled ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
        </button>

        <div className="relative flex-1 group">
          {/* Ambient glow — larger and brighter at rest so it's always visible */}
          <div className="absolute -inset-1 bg-accent/10 blur-lg rounded-2xl group-focus-within:bg-accent/20 transition-all duration-500 pointer-events-none" />

          <div className={cn(
            "relative backdrop-blur-md border-2 rounded-xl px-4 py-3 transition-all duration-300",
            "bg-[#0d0d0d] border-accent/30 group-focus-within:border-accent/80",
            "shadow-[0_0_0_1px_rgba(0,255,102,0.08),0_4px_24px_rgba(0,255,102,0.08)]",
            "group-focus-within:shadow-[0_0_0_1px_rgba(0,255,102,0.2),0_4px_32px_rgba(0,255,102,0.15)]",
          )}>
            {/* Header row */}
            <div className="flex items-center gap-2 mb-2">
              <Terminal className="w-3.5 h-3.5 text-accent" />
              <span className="text-[10px] uppercase tracking-[0.25em] text-accent font-mono font-bold">
                Command_Input
              </span>
              <span className="ml-auto text-[9px] text-white/25 font-mono hidden sm:block">
                Enter ↵ to send
              </span>
            </div>

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask VetIOS..."
              className="w-full bg-transparent border-none outline-none focus:outline-none focus:ring-0 text-white placeholder:text-white/40 font-mono text-sm resize-none py-0 max-h-48 scrollbar-hide leading-relaxed"
              rows={1}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={!input.trim() || disabled}
          className={cn(
            "w-12 h-12 shrink-0 flex items-center justify-center rounded-xl border-2 transition-all duration-300",
            input.trim() && !disabled
              ? "bg-accent border-accent text-black shadow-[0_0_24px_rgba(0,255,102,0.5)] hover:scale-105 active:scale-95"
              : "bg-accent/5 border-accent/20 text-accent/30 cursor-not-allowed"
          )}
        >
          <Send className="w-5 h-5" />
        </button>
      </form>
    </div>
  );
}
