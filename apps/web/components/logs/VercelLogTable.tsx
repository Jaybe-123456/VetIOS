'use client';

import { useEffect, useRef } from 'react';

export type VercelLogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS' | 'DEBUG';

export interface VercelLogTableRow {
    id: string;
    timestamp: string;
    level?: VercelLogLevel;
    method?: string;
    status?: string | number;
    host?: string;
    request?: string;
    message: string;
    badges?: string[];
    messageCount?: number;
}

interface VercelLogTableProps {
    rows: VercelLogTableRow[];
    emptyMessage?: string;
    className?: string;
    bodyClassName?: string;
    autoScroll?: boolean;
}

export function VercelLogTable({
    rows,
    emptyMessage = 'NO LOGS AVAILABLE',
    className = '',
    bodyClassName = 'h-[480px]',
    autoScroll = false,
}: VercelLogTableProps) {
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (autoScroll && scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [autoScroll, rows]);

    return (
        <div className={`border border-grid bg-black font-mono text-[11px] text-[hsl(0_0%_92%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${className}`}>
            <div ref={scrollRef} className={`overflow-auto ${bodyClassName}`}>
                <div className="min-w-[1040px]">
                    <div className="sticky top-0 z-10 grid grid-cols-[155px_96px_170px_270px_minmax(320px,1fr)] gap-0 border-b border-grid bg-[#050505] px-4 py-3 text-[12px] font-semibold text-[hsl(0_0%_58%)]">
                        <div>Time</div>
                        <div>Status</div>
                        <div>Host</div>
                        <div>Request</div>
                        <div>Messages</div>
                    </div>

                    {rows.length === 0 ? (
                        <div className="px-4 py-10 text-center text-[12px] font-semibold uppercase tracking-[0.18em] text-[hsl(0_0%_64%)]">
                            {emptyMessage}
                        </div>
                    ) : (
                        rows.map((row) => (
                            <div
                                key={row.id}
                                className="grid grid-cols-[155px_96px_170px_270px_minmax(320px,1fr)] gap-0 border-b border-white/[0.03] px-4 py-2.5 odd:bg-white/[0.025] hover:bg-white/[0.07]"
                            >
                                <TimeCell timestamp={row.timestamp} />
                                <div className="flex items-center gap-1.5 whitespace-nowrap">
                                    {row.method && <span className="text-[hsl(0_0%_72%)]">{row.method}</span>}
                                    <span className={`font-bold ${statusTone(row.level, row.status)}`}>
                                        {row.status ?? row.level ?? 'INFO'}
                                    </span>
                                </div>
                                <div className="truncate pr-4 font-bold text-[#dffcff]">{row.host ?? 'vetios.tech'}</div>
                                <div className="flex min-w-0 items-center gap-1.5 pr-4">
                                    {row.badges?.slice(0, 3).map((badge, index) => (
                                        <span
                                            key={`${row.id}-${badge}-${index}`}
                                            className="inline-flex h-4 min-w-4 items-center justify-center border border-[hsl(0_0%_32%)] bg-white/[0.04] px-1 text-[9px] font-bold text-[hsl(0_0%_68%)]"
                                        >
                                            {badge}
                                        </span>
                                    ))}
                                    <span className="truncate font-bold text-white">{row.request ?? '-'}</span>
                                </div>
                                <div className="flex min-w-0 items-center gap-2">
                                    {typeof row.messageCount === 'number' && (
                                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/[0.12] px-1.5 text-[10px] font-bold text-[hsl(0_0%_70%)]">
                                            {row.messageCount}
                                        </span>
                                    )}
                                    <span className={`truncate font-semibold ${messageTone(row.level)}`}>
                                        {row.message}
                                    </span>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

function TimeCell({ timestamp }: { timestamp: string }) {
    const { date, time } = formatLogTimestamp(timestamp);

    return (
        <div className="whitespace-nowrap pr-4">
            <span className="mr-2 font-bold uppercase text-[hsl(0_0%_46%)]">{date}</span>
            <span className="font-bold text-white">{time}</span>
        </div>
    );
}

function formatLogTimestamp(timestamp: string) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
        return { date: '--', time: timestamp };
    }

    const monthDay = date.toLocaleString('en-US', { month: 'short', day: '2-digit' }).toUpperCase();
    const clock = date.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
    const ms = String(date.getMilliseconds()).padStart(3, '0').slice(0, 2);

    return { date: monthDay, time: `${clock}.${ms}` };
}

function statusTone(level: VercelLogLevel | undefined, status: string | number | undefined) {
    const normalizedStatus = String(status ?? '').toUpperCase();
    if (level === 'ERROR' || normalizedStatus.startsWith('5') || normalizedStatus === 'FAILED') return 'text-[#ff5c5c]';
    if (level === 'WARN' || normalizedStatus.startsWith('4') || normalizedStatus === 'BLOCKED') return 'text-[#ffb000]';
    if (level === 'SUCCESS' || normalizedStatus.startsWith('2') || normalizedStatus === 'OK') return 'text-[#00e676]';
    return 'text-[#00e676]';
}

function messageTone(level: VercelLogLevel | undefined) {
    if (level === 'ERROR') return 'text-[#ff6b6b]';
    if (level === 'WARN') return 'text-[#ffb000]';
    if (level === 'SUCCESS') return 'text-[#7dff9a]';
    if (level === 'DEBUG') return 'text-[hsl(0_0%_64%)]';
    return 'text-[hsl(0_0%_92%)]';
}
