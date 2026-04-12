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
                <span className="uppercase tracking-[0.2em] text-muted text-[10px]">System Logs</span>
                <div className="flex gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-red-500/50" />
                    <div className="w-2 h-2 rounded-full bg-yellow-500/50" />
                    <div className="w-2 h-2 rounded-full bg-green-500/50" />
                </div>
            </div>
            
            <div 
                ref={scrollRef}
                className="p-3 overflow-y-auto max-h-[250px] min-h-[150px] scrollbar-thin scrollbar-thumb-grid transition-all"
            >
                {logs.length === 0 ? (
                    <div className="text-muted/40 italic">Awaiting system initialization...</div>
                ) : (
                    <div className="space-y-1">
                        {logs.map((log) => (
                            <div key={log.id} className="flex gap-3">
                                <span className="text-muted shrink-0 text-[10px] mt-0.5">[{log.timestamp}]</span>
                                <span className={`break-words ${
                                    log.level === 'error' ? 'text-danger' : 
                                    log.level === 'warn' ? 'text-warning' : 
                                    log.level === 'success' ? 'text-accent' : 
                                    'text-foreground/80'
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
