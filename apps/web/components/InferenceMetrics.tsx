'use client';

import React from 'react';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';

interface SparklineData {
    value: number;
}

export function MiniSparkline({ data, color = 'var(--green-bright)' }: { data: SparklineData[], color?: string }) {
    return (
        <div className="h-8 w-full opacity-70">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data}>
                    <YAxis hide domain={['auto', 'auto']} />
                    <Line
                        type="monotone"
                        dataKey="value"
                        stroke={color}
                        strokeWidth={1.5}
                        dot={false}
                        isAnimationActive={false}
                    />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}

export function MetricCard({
    label,
    value,
    unit = '',
    sparklineData = [],
    color = 'var(--green-bright)',
    className = '',
}: {
    label: string,
    value: string | number,
    unit?: string,
    sparklineData?: SparklineData[],
    color?: string,
    className?: string,
}) {
    return (
        <div className={`card-surface min-h-[100px] p-4 flex flex-col justify-between transition-all duration-150 hover:border-[var(--border-active)] hover:shadow-glow ${className}`}>
            <div className="flex justify-between items-start">
                <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]/75">{label}</span>
                <div className="h-1.5 w-1.5 rounded-full bg-[var(--green-bright)]" aria-hidden="true" />
            </div>

            <div className="mt-2 flex items-baseline gap-1">
                <span className="font-mono text-xl font-bold text-[var(--text-primary)]">{value}</span>
                {unit ? <span className="font-mono text-[10px] text-[var(--text-secondary)]/70">{unit}</span> : null}
            </div>

            {sparklineData.length > 0 ? (
                <div className="mt-2">
                    <MiniSparkline data={sparklineData} color={color} />
                </div>
            ) : null}
        </div>
    );
}
