'use client';

import { useState } from 'react';
import { useChatStore } from '@/store/useChatStore';

export default function UsernamePrompt() {
    const setUsername = useChatStore((s) => s.setUsername);
    const [value, setValue] = useState('');
    const [error, setError] = useState('');

    const validate = (v: string) => {
        if (v.length < 2) return 'Min 2 characters';
        if (v.length > 24) return 'Max 24 characters';
        if (!/^[A-Z0-9_]+$/.test(v)) return 'Uppercase, numbers, underscores only';
        return '';
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        setValue(raw);
        setError(validate(raw));
    };

    const handleConfirm = () => {
        const err = validate(value);
        if (err) { setError(err); return; }
        setUsername(value);
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 9999, fontFamily: "'Courier New', monospace",
        }}>
            <div style={{
                background: '#0a0a0a', border: '1px solid #1a1a1a',
                borderTop: '2px solid #00ff88', padding: '2rem',
                width: 'min(90vw, 400px)',
            }}>
                <p style={{ color: '#00ff88', fontSize: '0.6rem', letterSpacing: '0.2em', margin: '0 0 0.4rem' }}>
                    VET_IOS / OPERATOR_INIT
                </p>
                <h2 style={{ color: '#e8e8e8', fontSize: '1rem', fontWeight: 700, margin: '0 0 0.5rem', letterSpacing: '0.05em' }}>
                    SET YOUR CALLSIGN
                </h2>
                <p style={{ color: '#555', fontSize: '0.7rem', margin: '0 0 1.2rem', lineHeight: 1.6 }}>
                    Replaces <span style={{ color: '#888' }}>USER_OPERATOR</span> in all sessions.
                    Stored locally — you can change it in settings.
                </p>

                <input
                    value={value}
                    onChange={handleChange}
                    onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
                    maxLength={24}
                    placeholder="DR_MWANGI"
                    autoFocus
                    style={{
                        width: '100%', boxSizing: 'border-box',
                        background: '#0f0f0f',
                        border: `1px solid ${error ? '#ff4444' : '#2a2a2a'}`,
                        borderBottom: `2px solid ${error ? '#ff4444' : '#00ff88'}`,
                        color: '#00ff88', fontFamily: 'inherit',
                        fontSize: '1rem', letterSpacing: '0.12em',
                        padding: '0.6rem 0.8rem', outline: 'none',
                    }}
                />
                {error && (
                    <p style={{ color: '#ff4444', fontSize: '0.6rem', margin: '0.3rem 0 0', letterSpacing: '0.08em' }}>
                        ⚠ {error}
                    </p>
                )}

                <button
                    onClick={handleConfirm}
                    disabled={!!error || !value}
                    style={{
                        width: '100%', marginTop: '1rem',
                        background: (!!error || !value) ? '#111' : '#00ff88',
                        color: (!!error || !value) ? '#333' : '#000',
                        border: 'none', padding: '0.75rem',
                        fontFamily: 'inherit', fontSize: '0.75rem',
                        fontWeight: 700, letterSpacing: '0.2em',
                        cursor: (!!error || !value) ? 'not-allowed' : 'pointer',
                    }}
                >
                    CONFIRM CALLSIGN →
                </button>
            </div>
        </div>
    );
}
