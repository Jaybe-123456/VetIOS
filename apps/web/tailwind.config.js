/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ['class'],
    content: [
        './pages/**/*.{js,ts,jsx,tsx,mdx}',
        './components/**/*.{js,ts,jsx,tsx,mdx}',
        './app/**/*.{js,ts,jsx,tsx,mdx}',
    ],
    theme: {
        extend: {
            colors: {
                background: 'var(--background)',
                foreground: 'var(--foreground)',
                border: 'var(--border)',
                muted: 'var(--muted-foreground)',
                primary: 'var(--primary)',
                accent: 'var(--accent)',
            },
            fontFamily: {
                mono: ['JetBrains Mono', 'monospace'],
                sans: ['Inter', 'sans-serif'],
            },
            boxShadow: {
                glow: '0 0 0 1px rgba(0,255,136,0.2), 0 0 18px rgba(0,255,136,0.12)',
            },
        },
    },
    plugins: [],
};
