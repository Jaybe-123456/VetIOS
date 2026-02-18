import React from 'react';

type BadgeVariant = 'info' | 'success' | 'warning' | 'error' | 'neutral';

interface StatusBadgeProps {
    label: string;
    variant?: BadgeVariant;
}

const VARIANT_STYLES: Record<BadgeVariant, React.CSSProperties> = {
    info: { backgroundColor: '#dbeafe', color: '#1e40af' },
    success: { backgroundColor: '#dcfce7', color: '#166534' },
    warning: { backgroundColor: '#fef9c3', color: '#854d0e' },
    error: { backgroundColor: '#fee2e2', color: '#991b1b' },
    neutral: { backgroundColor: '#f3f4f6', color: '#374151' },
};

/**
 * A minimal status badge component used across encounter and decision UIs.
 */
export function StatusBadge({ label, variant = 'neutral' }: StatusBadgeProps): React.ReactElement {
    return React.createElement(
        'span',
        {
            style: {
                ...VARIANT_STYLES[variant],
                padding: '2px 8px',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: 600,
                display: 'inline-block',
            },
        },
        label,
    );
}
