'use client';

import React, { useEffect, useRef } from 'react';

export interface LogEntry {
    id: string;
    timestamp: string;
    level: 'info' | 'warn' | 'error' | 'success';
    message: string;
}

export function SystemLogConsole({ logs, className = '' }: { logs: LogEntry[], className?: string }) {
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs]);

    return (
        <div className={`border border-grid bg-black/40 font-mono text-[11px] leading-relaxed flex flex-col ${className}`}>
            <div className="border-b border-grid px-3 py-2 flex items-center justify-between bg-dim/30">
                <span className="uppercase tracking-[0.2em] text-[hsl(0_0%_88%)] text-[10px] font-bold">System Logs</span>
                <div className="flex gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-red-500/50" />
                    <div className="w-2 h-2 rounded-full bg-yellow-500/50" />
                    <div className="w-2 h-2 rounded-full bg-green-500/50" />
                </div>
            </div>
            
            <div 
                ref={scrollRef}
                className="p-3 overflow-y-auto max-h-[200px] sm:max-h-[300px] min-h-[120px] sm:min-h-[150px] scrollbar-thin scrollbar-thumb-grid transition-all scroll-touch"
            >
                {logs.length === 0 ? (
                    <div className="text-[hsl(0_0%_72%)] font-medium italic">Awaiting system initialization...</div>
                ) : (
                    <div className="space-y-1">
                        {logs.map((log) => (
                            <div key={log.id} className="flex gap-2 sm:gap-3 py-0.5">
                                <span className="text-[hsl(0_0%_75%)] shrink-0 text-[10px] mt-0.5 font-bold">[{log.timestamp}]</span>
                                <span className={`break-words font-medium ${
                                    log.level === 'error' ? 'text-danger font-bold' : 
                                    log.level === 'warn' ? 'text-warning font-bold' : 
                                    log.level === 'success' ? 'text-accent font-bold' : 
                                    'text-foreground'
                                }`}>
                                    {log.message}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
