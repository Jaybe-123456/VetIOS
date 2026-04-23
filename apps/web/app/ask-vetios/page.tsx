'use client';

import { useEffect, useState } from 'react';
import { useChatStore } from '@/store/useChatStore';
import ChatContainer from '@/components/ask-vetios/ChatContainer';
import ChatInput from '@/components/ask-vetios/ChatInput';
import { DashboardMetrics, AnalyticsChart } from '@/components/ask-vetios/DashboardMetrics';
import { RecentCases } from '@/components/ask-vetios/RecentCases';
import { Plus, MessageSquare, History, Search, Bell, Moon, ChevronRight, Share2, Download } from 'lucide-react';
import { motion } from 'framer-motion';

export default function AskVetIOSPage() {
  const { createChat, activeChatId, addMessage, setLoading, isLoading, switchChat, chats } = useChatStore();
  const [searchQuery, setSearchQuery] = useState('');

  // Auto-create first chat if none exists
  useEffect(() => {
    if (chats.length === 0) {
      createChat();
    } else if (!activeChatId) {
      switchChat(chats[0].id);
    }
  }, [chats, activeChatId, createChat, switchChat]);

  const handleSendMessage = async (content: string) => {
    if (!activeChatId) return;

    // Add user message
    addMessage(activeChatId, { role: 'user', content });
    setLoading(true);

    try {
      const response = await fetch('/api/ask-vetios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: content }),
      });

      const data = await response.json();

      if (data.error) throw new Error(data.error);

      // Add assistant message
      addMessage(activeChatId, {
        role: 'assistant',
        content: data.content,
        metadata: data.metadata
      });
    } catch (error) {
      addMessage(activeChatId, {
        role: 'assistant',
        content: "I apologize, but I encountered an error while processing your request. Please ensure the intelligence gateway is operational."
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#050505] text-white selection:bg-accent/30">
      
      {/* ── Page Header ── */}
      <header className="px-6 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-white/5">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-2xl font-bold tracking-tighter uppercase flex items-center gap-2">
              Ask VetIOS <span className="text-accent animate-pulse">●</span>
            </h1>
            <div className="px-2 py-0.5 rounded-sm bg-accent/10 border border-accent/20 text-accent font-mono text-[9px] tracking-widest uppercase">
              V1.0 Intelligence
            </div>
          </div>
          <p className="text-[10px] sm:text-xs text-muted-foreground font-mono uppercase tracking-[0.2em]">
            Your AI Veterinary Intelligence Assistant
          </p>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
           <button 
            onClick={() => createChat()}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-accent text-black font-mono text-xs font-bold uppercase tracking-widest hover:bg-accent/90 transition-all shadow-[0_0_15px_rgba(0,255,102,0.2)]"
           >
             <Plus className="w-4 h-4" />
             New Chat
           </button>
           <button className="p-2 border border-white/10 hover:border-white/20 transition-all text-white/50 hover:text-white">
             <Share2 className="w-4 h-4" />
           </button>
           <button className="p-2 border border-white/10 hover:border-white/20 transition-all text-white/50 hover:text-white">
             <Download className="w-4 h-4" />
           </button>
        </div>
      </header>

      {/* ── Main Content Area (Scrollable) ── */}
      <div className="flex-1 overflow-y-auto">
        
        {/* ── Chat Section ── */}
        <section className="max-w-6xl mx-auto px-4 py-8 flex flex-col h-[70vh] min-h-[600px]">
          <div className="flex-1 bg-[#0a0a0a] border border-white/10 flex flex-col overflow-hidden relative shadow-2xl">
            {/* Subtle Grid Background */}
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('https://grainy-gradients.vercel.app/noise.svg')] bg-repeat" />
            
            <div className="px-4 py-3 border-b border-white/5 bg-white/[0.02] flex items-center justify-between shrink-0">
               <div className="flex items-center gap-3">
                 <History className="w-3.5 h-3.5 text-accent" />
                 <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">
                   Active_Intelligence_Session
                 </span>
               </div>
               <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 px-2 py-1 bg-black border border-white/10 rounded-sm">
                    <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                    <span className="font-mono text-[9px] text-accent/70 uppercase">Connected</span>
                  </div>
               </div>
            </div>

            <ChatContainer />
            
            <div className="shrink-0 border-t border-white/5 bg-[#0a0a0a]">
              <ChatInput onSend={handleSendMessage} disabled={isLoading} />
            </div>
          </div>
        </section>

        {/* ── Analytics Section ── */}
        <section className="max-w-6xl mx-auto px-4 py-12 space-y-12">
          
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-white/5" />
              <h2 className="font-mono text-[11px] uppercase tracking-[0.4em] text-white/30 font-bold whitespace-nowrap">
                Systems Intelligence Overview
              </h2>
              <div className="h-px flex-1 bg-white/5" />
            </div>

            <DashboardMetrics />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2">
               <AnalyticsChart />
            </div>
            <div>
               <RecentCases />
            </div>
          </div>

          {/* ── Institutional Footer ── */}
          <div className="pt-12 pb-8 flex flex-col sm:flex-row items-center justify-between border-t border-white/5 gap-4">
            <span className="font-mono text-[9px] text-white/20 tracking-[0.25em] uppercase">
              VETIOS SECURE INTELLIGENCE NETWORK // OMEGA_TERMINAL
            </span>
            <div className="flex items-center gap-6">
              <span className="font-mono text-[9px] text-accent/40 uppercase tracking-widest">Protocol: 0x82A1</span>
              <span className="font-mono text-[9px] text-accent/40 uppercase tracking-widest">Shard: Cluster_09</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
