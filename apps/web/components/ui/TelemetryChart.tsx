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

export function TelemetryChart({ data, dataKey = 'value', color = '#00ff41' }: { data: any[], dataKey?: string, color?: string }) {
    return (
        <div className="w-full h-full min-h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                    <XAxis
                        dataKey="time"
                        stroke="#666"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) => value}
                        fontFamily="monospace"
                    />
                    <YAxis
                        stroke="#666"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) => `${value}`}
                        fontFamily="monospace"
                        width={40}
                    />
                    <Tooltip
                        contentStyle={{
                            backgroundColor: '#000',
                            border: '1px solid #333',
                            borderRadius: '0px',
                            fontFamily: 'monospace',
                            fontSize: '12px'
                        }}
                        itemStyle={{ color: '#fff' }}
                    />
                    <Line
                        type="monotone"
                        dataKey={dataKey}
                        stroke={color}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, fill: color, stroke: '#000' }}
                        isAnimationActive={false}
                    />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}
