'use client';

import {
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import type { ExperimentMetricSeriesPoint } from '@/lib/experiments/types';

interface MetricSeriesInput {
    runId: string;
    label: string;
    color: string;
    points: ExperimentMetricSeriesPoint[];
}

export function ExperimentMetricChart({
    title,
    metricKey,
    series,
    emptyMessage,
}: {
    title: string;
    metricKey: keyof ExperimentMetricSeriesPoint;
    series: MetricSeriesInput[];
    emptyMessage: string;
}) {
    const merged = mergeSeries(metricKey, series);

    return (
        <div className="flex h-full min-h-[260px] flex-col">
            <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">{title}</div>
            {merged.length === 0 ? (
                <div className="flex min-h-[220px] flex-1 items-center justify-center border border-dashed border-grid bg-black/10 px-6 text-center font-mono text-xs text-muted">
                    {emptyMessage}
                </div>
            ) : (
                <div className="min-h-[220px] flex-1">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={merged} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                            <CartesianGrid stroke="#2a2a2a" strokeDasharray="3 3" vertical={false} />
                            <XAxis
                                dataKey="label"
                                stroke="#777"
                                fontSize={10}
                                tickLine={false}
                                axisLine={false}
                                fontFamily="monospace"
                            />
                            <YAxis
                                stroke="#777"
                                fontSize={10}
                                tickLine={false}
                                axisLine={false}
                                fontFamily="monospace"
                                width={72}
                                tickFormatter={(value) => typeof value === 'number' ? formatTick(value, metricKey) : String(value)}
                            />
                            <Tooltip
                                contentStyle={{
                                    backgroundColor: '#040404',
                                    border: '1px solid #2b2b2b',
                                    borderRadius: 0,
                                    fontFamily: 'monospace',
                                    fontSize: '12px',
                                }}
                                formatter={(value: unknown) => typeof value === 'number' ? formatTooltipValue(value, metricKey) : String(value ?? '')}
                            />
                            <Legend wrapperStyle={{ fontFamily: 'monospace', fontSize: '10px' }} />
                            {series.map((item) => (
                                <Line
                                    key={`${item.runId}:${String(metricKey)}`}
                                    type="monotone"
                                    dataKey={lineKey(item.runId)}
                                    name={item.label}
                                    stroke={item.color}
                                    strokeWidth={2}
                                    dot={false}
                                    isAnimationActive={false}
                                    connectNulls
                                />
                            ))}
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
}

function mergeSeries(
    metricKey: keyof ExperimentMetricSeriesPoint,
    series: MetricSeriesInput[],
) {
    const orderedLabels: string[] = [];
    const byLabel = new Map<string, Record<string, string | number | null>>();

    for (const item of series) {
        for (const point of item.points) {
            const value = point[metricKey];
            if (typeof value !== 'number') continue;
            const label = point.epoch_label;
            if (!byLabel.has(label)) {
                orderedLabels.push(label);
                byLabel.set(label, { label });
            }
            byLabel.get(label)![lineKey(item.runId)] = value;
        }
    }

    return orderedLabels.map((label) => byLabel.get(label)!).filter(Boolean);
}

function lineKey(runId: string): string {
    return `run_${runId.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`;
}

function formatTick(
    value: number,
    metricKey: keyof ExperimentMetricSeriesPoint,
): string {
    if (metricKey === 'learning_rate') {
        if (value === 0) return '0';
        if (Math.abs(value) < 0.001) return value.toExponential(1);
        if (Math.abs(value) < 0.01) return value.toFixed(4);
        return value.toFixed(3);
    }

    if (Math.abs(value) >= 100) return value.toFixed(0);
    if (Math.abs(value) >= 10) return value.toFixed(1);
    if (Math.abs(value) < 0.01 && value !== 0) return value.toExponential(1);
    return value.toFixed(2);
}

function formatTooltipValue(
    value: number,
    metricKey: keyof ExperimentMetricSeriesPoint,
): string {
    if (metricKey === 'learning_rate') {
        return value.toExponential(6);
    }
    if (Math.abs(value) < 0.01 && value !== 0) {
        return value.toExponential(4);
    }
    return value.toFixed(4);
}
