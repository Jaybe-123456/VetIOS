'use client';

import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';

export function TelemetryChart({ data, dataKey = 'value', color = 'var(--green-bright)' }: { data: any[], dataKey?: string, color?: string }) {
    return (
        <div className="w-full h-full min-h-[220px] rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 transition-all duration-150 hover:border-[var(--border-active)]">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(156, 163, 175, 0.24)" vertical={false} />
                    <XAxis
                        dataKey="time"
                        stroke="var(--text-secondary)"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) => value}
                        fontFamily="JetBrains Mono"
                    />
                    <YAxis
                        stroke="var(--text-secondary)"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) => `${value}`}
                        fontFamily="JetBrains Mono"
                        width={40}
                    />
                    <Tooltip
                        contentStyle={{
                            backgroundColor: 'var(--bg-overlay)',
                            border: '1px solid var(--border-default)',
                            borderRadius: '6px',
                            fontFamily: 'JetBrains Mono',
                            fontSize: '12px',
                            color: 'var(--text-primary)',
                        }}
                        itemStyle={{ color: 'var(--text-primary)' }}
                        labelStyle={{ color: 'var(--text-secondary)' }}
                    />
                    <Line
                        type="monotone"
                        dataKey={dataKey}
                        stroke={color}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, fill: 'var(--green-glow)', stroke: 'var(--bg-base)' }}
                        isAnimationActive={false}
                    />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}
