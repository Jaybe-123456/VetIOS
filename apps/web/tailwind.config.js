/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        './pages/**/*.{js,ts,jsx,tsx,mdx}',
        './components/**/*.{js,ts,jsx,tsx,mdx}',
        './app/**/*.{js,ts,jsx,tsx,mdx}',
    ],
    theme: {
        extend: {
            colors: {
                background: '#000000',
                foreground: '#ffffff',
                accent: '#00ff41', // Matrix green for execution
                muted: '#333333',
                dim: '#1a1a1a',
                danger: '#ff3333',
            },
            fontFamily: {
                mono: ['var(--font-geist-mono)', 'monospace'],
                sans: ['var(--font-inter)', 'sans-serif'],
            },
        },
    },
    plugins: [],
}
