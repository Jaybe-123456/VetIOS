'use client';

import { TerminalButton } from '@/components/ui/terminal';
import { DownloadCloud, Filter } from 'lucide-react';

interface DatasetTableProps {
    title: string;
    columns: string[];
    data: any[];
}

export function DatasetTable({ title, columns, data }: DatasetTableProps) {
    const handleExport = () => {
        if (!data || data.length === 0) return;

        const jsonString = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        const filename = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        a.download = `vetios_export_${filename}.json`;
        
        document.body.appendChild(a);
        a.click();
        
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <div className="border border-grid bg-background/50 flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-grid bg-dim">
                <span className="font-mono text-sm tracking-widest text-accent uppercase flex items-center gap-2">
                    <div className="w-1.5 h-1.5 bg-accent" />
                    {title}
                </span>
                <div className="flex items-center gap-2">
                    <button className="p-2 border border-grid text-muted hover:text-foreground hover:border-accent transition-colors">
                        <Filter className="w-4 h-4" />
                    </button>
                    <button onClick={handleExport} className="px-3 py-1.5 border border-grid text-xs font-mono uppercase text-muted hover:text-foreground hover:border-accent transition-colors flex items-center gap-2">
                        <DownloadCloud className="w-3 h-3" />
                        Export
                    </button>
                </div>
            </div>
            <div className="w-full overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[600px]">
                    <thead>
                        <tr className="border-b border-grid font-mono text-[10px] uppercase text-muted/70 tracking-widest bg-black/40">
                            {columns.map((col, i) => (
                                <th key={i} className="p-4 font-normal whitespace-nowrap">{col}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="font-mono text-xs">
                        {data.length === 0 ? (
                            <tr>
                                <td colSpan={columns.length} className="p-8 text-center text-muted border-b border-grid/20">
                                    NO DATA VECTORS FOUND IN CURRENT TENANT
                                </td>
                            </tr>
                        ) : (
                            data.map((row, i) => (
                                <tr key={i} className="border-b border-grid/20 hover:bg-white/[0.02] transition-colors cursor-crosshair">
                                    {columns.map((col, j) => (
                                        <td key={j} className={`p-4 ${j === 0 ? 'text-muted' : 'text-foreground/80'} whitespace-nowrap`}>
                                            {row[col] || '-'}
                                        </td>
                                    ))}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
            <div className="p-3 border-t border-grid text-right font-mono text-[10px] text-muted flex justify-between items-center bg-black/20">
                <span>Total records: {data.length}</span>
                <div className="flex items-center gap-2">
                    <button className="px-2 border border-grid hover:text-accent">PREV</button>
                    <span>PAGE 1</span>
                    <button className="px-2 border border-grid hover:text-accent">NEXT</button>
                </div>
            </div>
        </div>
    );
}
