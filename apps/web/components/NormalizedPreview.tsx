'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Eye, Edit3, Check } from 'lucide-react';
import type { NormalizedInput } from '@/lib/input/inputNormalizer';

interface NormalizedPreviewProps {
    normalized: NormalizedInput;
    onConfirm: (edited: NormalizedInput) => void;
    onCancel: () => void;
}

export function NormalizedPreview({ normalized, onConfirm, onCancel }: NormalizedPreviewProps) {
    const [expanded, setExpanded] = useState(true);
    const [editing, setEditing] = useState(false);
    const [editText, setEditText] = useState('');

    const jsonPreview = JSON.stringify(normalized, null, 2);

    function handleEdit() {
        setEditText(jsonPreview);
        setEditing(true);
    }

    function handleConfirmEdit() {
        try {
            const parsed = JSON.parse(editText);
            onConfirm({
                species: parsed.species ?? null,
                breed: parsed.breed ?? null,
                symptoms: Array.isArray(parsed.symptoms) ? parsed.symptoms : [],
                metadata: parsed.metadata ?? {},
            });
        } catch {
            // If user broke the JSON, just use original
            onConfirm(normalized);
        }
    }

    return (
        <div className="border border-accent/40 bg-accent/5">
            {/* Header */}
            <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-between px-4 py-3 font-mono text-xs uppercase tracking-wider text-accent hover:bg-accent/10 transition-colors"
            >
                <span className="flex items-center gap-2">
                    <Eye className="w-3.5 h-3.5" />
                    Normalized Input Preview
                </span>
                {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {/* Body */}
            {expanded && (
                <div className="px-4 pb-4 space-y-3">
                    {/* Summary badges */}
                    <div className="flex flex-wrap gap-2">
                        <Badge label="Species" value={normalized.species || '—'} />
                        <Badge label="Breed" value={normalized.breed || '—'} />
                        <Badge label="Symptoms" value={`${normalized.symptoms.length} found`} />
                        <Badge label="Metadata" value={`${Object.keys(normalized.metadata).length} keys`} />
                    </div>

                    {/* JSON Preview / Editor */}
                    {editing ? (
                        <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            className="w-full bg-black border border-accent/30 p-3 font-mono text-[10px] sm:text-xs text-green-400 min-h-[140px] sm:min-h-[180px] resize-y focus:outline-none focus:border-accent"
                        />
                    ) : (
                        <pre className="bg-black border border-grid p-3 font-mono text-[10px] sm:text-xs text-green-400 overflow-x-auto max-h-[180px] sm:max-h-[250px] overflow-y-auto">
                            {jsonPreview}
                        </pre>
                    )}

                    {/* Buttons */}
                    <div className="flex flex-col sm:flex-row gap-2">
                        {editing ? (
                            <button
                                type="button"
                                onClick={handleConfirmEdit}
                                className="flex items-center gap-2 px-4 py-2 font-mono text-xs uppercase tracking-wider border border-accent text-accent hover:bg-accent hover:text-black transition-colors"
                            >
                                <Check className="w-3.5 h-3.5" />
                                Apply Edits & Submit
                            </button>
                        ) : (
                            <>
                                <button
                                    type="button"
                                    onClick={() => onConfirm(normalized)}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 font-mono text-xs uppercase tracking-wider border border-accent text-accent hover:bg-accent hover:text-black transition-colors"
                                >
                                    <Check className="w-3.5 h-3.5" />
                                    Confirm & Execute
                                </button>
                                <button
                                    type="button"
                                    onClick={handleEdit}
                                    className="flex items-center gap-2 px-4 py-2.5 font-mono text-xs uppercase tracking-wider border border-muted text-muted hover:text-foreground hover:border-foreground transition-colors"
                                >
                                    <Edit3 className="w-3.5 h-3.5" />
                                    Edit
                                </button>
                            </>
                        )}
                        <button
                            type="button"
                            onClick={onCancel}
                            className="px-4 py-2.5 font-mono text-xs uppercase tracking-wider border border-muted/50 text-muted hover:text-foreground transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

function Badge({ label, value }: { label: string; value: string }) {
    return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-dim border border-grid font-mono text-[10px] uppercase">
            <span className="text-muted">{label}:</span>
            <span className="text-foreground">{value}</span>
        </span>
    );
}
