'use client';

import { Fragment, type ReactNode } from 'react';
import { DownloadCloud, Filter } from 'lucide-react';

export interface DatasetColumn<Row> {
    key: string;
    label: string;
    render: (row: Row) => ReactNode;
    className?: string;
}

interface DatasetTableProps<Row> {
    title: string;
    columns: Array<DatasetColumn<Row>>;
    data: Row[];
    rowKey: (row: Row) => string;
    onExport?: () => void;
    filterSlot?: ReactNode;
    detailRenderer?: (row: Row) => ReactNode;
    selectedRowKey?: string | null;
    onRowToggle?: (row: Row) => void;
    emptyMessage?: string;
}

export function DatasetTable<Row>({
    title,
    columns,
    data,
    rowKey,
    onExport,
    filterSlot,
    detailRenderer,
    selectedRowKey = null,
    onRowToggle,
    emptyMessage = 'NO DATA VECTORS FOUND IN CURRENT TENANT',
}: DatasetTableProps<Row>) {
    return (
        <div className="flex flex-col border border-grid bg-background/50">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-grid bg-dim p-3 sm:p-4">
                <div className="flex items-center gap-2 font-mono text-xs sm:text-sm uppercase tracking-widest text-accent">
                    <div className="h-1.5 w-1.5 bg-accent" />
                    {title}
                </div>
                <div className="flex flex-wrap items-center justify-start sm:justify-end gap-2">
                    {filterSlot ? (
                        <div className="flex items-center gap-2 border border-grid px-2 py-1 text-muted">
                            <Filter className="h-4 w-4" />
                            {filterSlot}
                        </div>
                    ) : null}
                    <button
                        onClick={onExport}
                        className="flex items-center gap-2 border border-grid px-3 py-1.5 font-mono text-xs uppercase text-muted transition-colors hover:border-accent hover:text-foreground"
                        disabled={!onExport}
                    >
                        <DownloadCloud className="h-3 w-3" />
                        Export
                    </button>
                </div>
            </div>
            <div className="table-scroll-wrapper">
                <table className="min-w-[980px] w-full border-collapse text-left">
                    <thead>
                        <tr className="border-b border-grid bg-black/40 font-mono text-[10px] uppercase tracking-widest text-muted/70">
                            {columns.map((column) => (
                                <th key={column.key} className="p-2 sm:p-4 font-normal whitespace-nowrap">
                                    {column.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="font-mono text-xs">
                        {data.length === 0 ? (
                            <tr>
                                <td colSpan={columns.length} className="border-b border-grid/20 p-8 text-center text-muted">
                                    {emptyMessage}
                                </td>
                            </tr>
                        ) : (
                            data.map((row) => {
                                const key = rowKey(row);
                                const expanded = selectedRowKey === key;
                                return (
                                    <Fragment key={key}>
                                        <tr
                                            className="cursor-crosshair border-b border-grid/20 transition-colors active:bg-white/[0.03] sm:hover:bg-white/[0.02] touch-manipulation"
                                            onClick={() => onRowToggle?.(row)}
                                        >
                                            {columns.map((column, index) => (
                                                <td
                                                    key={`${key}:${column.key}`}
                                                    className={`whitespace-nowrap p-2 sm:p-4 ${index === 0 ? 'text-muted' : 'text-foreground/80'} ${column.className ?? ''}`}
                                                >
                                                    {column.render(row)}
                                                </td>
                                            ))}
                                        </tr>
                                        {expanded && detailRenderer ? (
                                            <tr className="border-b border-grid/20 bg-black/20">
                                                <td colSpan={columns.length} className="p-4">
                                                    {detailRenderer(row)}
                                                </td>
                                            </tr>
                                        ) : null}
                                    </Fragment>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 border-t border-grid bg-black/20 p-2 sm:p-3 font-mono text-[10px] text-muted">
                <span>Total records: {data.length}</span>
                <span>LIVE DATASET VIEW</span>
            </div>
        </div>
    );
}
