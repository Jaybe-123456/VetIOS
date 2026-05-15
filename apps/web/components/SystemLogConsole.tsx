'use client';

import React from 'react';
import { VercelLogTable, type VercelLogLevel, type VercelLogTableRow } from '@/components/logs/VercelLogTable';

export interface LogEntry {
    id: string;
    timestamp: string;
    level: 'info' | 'warn' | 'error' | 'success';
    message: string;
}

export function SystemLogConsole({ logs, className = '' }: { logs: LogEntry[], className?: string }) {
    const rows = logs.map(systemLogToRow);

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
            
            <div className="p-3">
                {logs.length === 0 ? (
                    <div className="text-[hsl(0_0%_72%)] font-medium italic">Awaiting system initialization...</div>
                ) : (
                    <VercelLogTable
                        rows={rows}
                        autoScroll
                        bodyClassName="max-h-[200px] min-h-[120px] sm:max-h-[300px] sm:min-h-[150px]"
                    />
                )}
            </div>
        </div>
    );
}

function systemLogToRow(log: LogEntry): VercelLogTableRow {
    return {
        id: log.id,
        timestamp: normalizeTimestamp(log.timestamp),
        method: 'SYS',
        status: log.level.toUpperCase(),
        level: systemLogLevel(log.level),
        host: 'inference-console',
        request: '/runtime/logs',
        badges: ['m', 'f'],
        message: log.message,
    };
}

function systemLogLevel(level: LogEntry['level']): VercelLogLevel {
    if (level === 'error') return 'ERROR';
    if (level === 'warn') return 'WARN';
    if (level === 'success') return 'SUCCESS';
    return 'INFO';
}

function normalizeTimestamp(timestamp: string) {
    const parsed = new Date(timestamp);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();

    const clockMatch = timestamp.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (clockMatch) {
        const today = new Date();
        const meridiem = clockMatch[4]?.toUpperCase();
        let hours = Number(clockMatch[1]);
        if (meridiem === 'PM' && hours < 12) hours += 12;
        if (meridiem === 'AM' && hours === 12) hours = 0;
        today.setHours(hours, Number(clockMatch[2]), Number(clockMatch[3] ?? '0'), 0);
        return today.toISOString();
    }

    return new Date().toISOString();
}
