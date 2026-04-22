'use client';

import React from 'react';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';

interface SparklineData {
    value: number;
}

export function MiniSparkline({ data, color = '#00ff9d' }: { data: SparklineData[], color?: string }) {
    return (
        <div className="w-full h-8 opacity-50">
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
    color = '#00ff9d',
    className = ''
}: {
    label: string,
    value: string | number,
    unit?: string,
    sparklineData?: SparklineData[],
    color?: string,
    className?: string
}) {
    return (
        <div className={`border border-grid console-card-glass p-3 sm:p-4 flex flex-col justify-between min-h-[90px] sm:min-h-[100px] ${className}`}>
            <div className="flex justify-between items-start">
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] sm:tracking-widest text-[hsl(0_0%_82%)]">{label}</span>
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
            </div>
            
            <div className="mt-2 flex items-baseline gap-1">
                <span className="font-mono text-lg sm:text-xl text-foreground font-bold">{value}</span>
                {unit && <span className="font-mono text-[10px] text-muted">{unit}</span>}
            </div>

            {sparklineData.length > 0 && (
                <div className="mt-2">
                    <MiniSparkline data={sparklineData} color={color} />
                </div>
            )}
        </div>
    );
}
