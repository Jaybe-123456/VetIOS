'use client';

import { motion } from 'framer-motion';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, Brain, Database, Target, TrendingUp } from 'lucide-react';

// ── Metrics ──

const metrics = [
  { label: 'Total Analyses', value: '4,281', change: '+12.5%', icon: Database },
  { label: 'Accuracy Rate', value: '98.2%', change: '+0.4%', icon: Target },
  { label: 'Data Points', value: '1.2M', change: '+18.2%', icon: Activity },
  { label: 'Active Models', value: '24', change: 'Stable', icon: Brain },
];

export function DashboardMetrics() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {metrics.map((metric, index) => (
        <motion.div
          key={index}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: index * 0.1 }}
          className="p-4 bg-white/5 border border-white/10 hover:border-accent/20 transition-all flex flex-col gap-2 relative overflow-hidden group"
        >
          <div className="absolute top-0 right-0 w-16 h-16 bg-accent/5 -mr-8 -mt-8 rotate-45 blur-2xl group-hover:bg-accent/10 transition-all" />
          
          <div className="flex items-center justify-between relative">
            <metric.icon className="w-4 h-4 text-accent/50" />
            <span className={cn(
              "font-mono text-[9px] uppercase tracking-wider",
              metric.change.startsWith('+') ? "text-accent" : "text-muted-foreground"
            )}>
              {metric.change}
            </span>
          </div>

          <div className="flex flex-col relative">
            <span className="font-mono text-xl font-bold text-white/90">{metric.value}</span>
            <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{metric.label}</span>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

// ── Analytics Chart ──

const chartData = [
  { time: '00:00', value: 40 },
  { time: '04:00', value: 30 },
  { time: '08:00', value: 65 },
  { time: '12:00', value: 45 },
  { time: '16:00', value: 80 },
  { time: '20:00', value: 55 },
  { time: '23:59', value: 60 },
];

export function AnalyticsChart() {
  return (
    <div className="p-6 bg-white/5 border border-white/10 h-64 sm:h-80">
      <div className="flex items-center justify-between mb-6">
        <div className="flex flex-col">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">Inference Activity</span>
          <span className="font-mono text-[9px] text-muted-foreground">REAL-TIME TELEMETRY STREAM</span>
        </div>
        <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-accent animate-pulse rounded-full" />
            <span className="font-mono text-[9px] text-white/50 tracking-widest uppercase">LIVE</span>
        </div>
      </div>

      <div className="w-full h-full pb-8">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#00ff66" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#00ff66" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <XAxis 
              dataKey="time" 
              stroke="rgba(255,255,255,0.2)" 
              fontSize={10} 
              fontFamily="var(--font-geist-mono)"
              axisLine={false}
              tickLine={false}
            />
            <YAxis hide domain={['auto', 'auto']} />
            <Tooltip 
              contentStyle={{ background: '#0a0a0a', border: '1px solid rgba(0,255,102,0.2)', fontFamily: 'var(--font-geist-mono)', fontSize: '10px' }}
              itemStyle={{ color: '#00ff66' }}
            />
            <Area 
              type="monotone" 
              dataKey="value" 
              stroke="#00ff66" 
              strokeWidth={2}
              fillOpacity={1} 
              fill="url(#colorValue)" 
              animationDuration={2000}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

import { cn } from '@/lib/utils';
