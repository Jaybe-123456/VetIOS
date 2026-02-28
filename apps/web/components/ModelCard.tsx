'use client';

import { Activity, Server, ArrowRight } from 'lucide-react';

interface ModelCardProps {
    name: string;
    version: string;
    accuracy: number;
    parameters: string;
    status: 'production' | 'staging' | 'training' | 'archived';
    onPromote?: () => void;
    onRollback?: () => void;
}

export function ModelCard({ name, version, accuracy, parameters, status, onPromote, onRollback }: ModelCardProps) {
    const isProd = status === 'production';
    const isStag = status === 'staging';

    return (
        <div className={`p-6 border flex flex-col gap-4 transition-colors ${isProd ? 'border-accent bg-accent/5 cursor-default' :
                isStag ? 'border-grid bg-background/50 hover:border-accent/50 cursor-crosshair' :
                    'border-grid/50 bg-background/20 opacity-70'
            }`}>
            <div className="flex justify-between items-start">
                <div className="flex flex-col gap-1">
                    <span className="font-mono text-lg font-bold tracking-tight text-foreground">
                        {name} <span className="text-muted text-sm ml-2">{version}</span>
                    </span>
                    <span className="font-mono text-xs uppercase text-muted tracking-wider flex items-center gap-2">
                        <Server className="w-3 h-3" />
                        {parameters} Param Architecture
                    </span>
                </div>
                <div className={`px-2 py-1 font-mono text-[10px] uppercase border ${isProd ? 'border-accent text-accent' :
                        isStag ? 'border-muted text-muted' :
                            'border-transparent text-muted bg-grid/50'
                    }`}>
                    {status}
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4 my-2">
                <div className="border border-grid/50 p-3 bg-black/20">
                    <div className="font-mono text-[10px] text-muted uppercase mb-1">Glob. Accuracy</div>
                    <div className="font-mono text-xl text-foreground">{(accuracy * 100).toFixed(2)}%</div>
                </div>
                <div className="border border-grid/50 p-3 bg-black/20">
                    <div className="font-mono text-[10px] text-muted uppercase mb-1">Latency p99</div>
                    <div className="font-mono text-xl text-foreground">{(accuracy * 180 + 20).toFixed(0)}ms</div>
                </div>
            </div>

            <div className="flex items-center gap-2 mt-auto pt-4 border-t border-grid/30">
                {isStag && (
                    <button
                        onClick={onPromote}
                        className="flex-1 py-2 px-4 bg-transparent border border-accent/50 text-accent font-mono text-xs uppercase tracking-widest hover:bg-accent hover:text-black transition-colors flex items-center justify-center gap-2"
                    >
                        Promote to Prod <ArrowRight className="w-3 h-3" />
                    </button>
                )}
                {isProd && (
                    <button
                        onClick={onRollback}
                        className="flex-1 py-2 px-4 bg-transparent border border-danger/50 text-danger font-mono text-xs uppercase tracking-widest hover:bg-danger hover:text-white transition-colors"
                    >
                        Emergency Rollback
                    </button>
                )}
                {!isProd && !isStag && (
                    <span className="font-mono text-[10px] text-muted uppercase tracking-wider mx-auto">
                        Historical Record
                    </span>
                )}
            </div>
        </div>
    );
}
