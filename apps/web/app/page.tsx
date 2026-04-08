'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function Home() {
    // Light/Dark mode state
    const [theme, setTheme] = useState<'dark' | 'light'>('dark');

    const isDark = theme === 'dark';

    return (
        <div className={`min-h-screen w-full relative overflow-hidden transition-colors duration-500 flex flex-col font-sans ${isDark ? 'bg-[#0a0e14] text-white' : 'bg-gray-50 text-gray-900'}`}>
            {/* Base Grid Background - Right Side */}
            <div className="absolute top-0 right-0 w-1/2 h-full hidden lg:block opacity-70 pointer-events-none">
                <div 
                    className="w-full h-full transition-colors duration-500" 
                    style={{
                        backgroundImage: `radial-gradient(circle at center, transparent 0%, ${isDark ? '#0a0e14' : '#f9fafb'} 100%), radial-gradient(circle, ${isDark ? '#00f0ff' : '#00a8b5'} 1px, transparent 1.5px)`,
                        backgroundSize: '100% 100%, 48px 48px',
                        backgroundPosition: '0 0, 24px 24px'
                    }}
                />
            </div>
            
            {/* Grid Dots implementation (closer to image reference with circles) */}
            <div className="absolute top-0 right-0 w-[55%] h-full hidden md:flex items-center pointer-events-none z-0">
                <div className="w-full h-full relative transition-colors duration-500" style={{ background: isDark ? '#0a0e14' : '#f9fafb' }}>
                    <div className="absolute inset-0 grid" style={{ gridTemplateColumns: 'repeat(8, 1fr)', gridTemplateRows: 'repeat(12, 1fr)', gap: '0' }}>
                        {Array.from({ length: 96 }).map((_, i) => (
                            <div key={i} className="flex items-center justify-center w-full h-full">
                                <div className={`w-2 h-2 rounded-full border-2 transition-colors duration-500 ${isDark ? 'border-[#00f0ff]' : 'border-[#00a8b5]'}`}></div>
                            </div>
                        ))}
                    </div>
                    {/* Gradient mask to blend left edge */}
                    <div className={`absolute inset-y-0 left-0 w-32 transition-colors duration-500 ${isDark ? 'bg-gradient-to-r from-[#0a0e14] to-transparent' : 'bg-gradient-to-r from-gray-50 to-transparent'} z-10`} />
                </div>
            </div>

            {/* Main Content */}
            <main className="flex flex-col justify-center flex-1 w-full max-w-7xl mx-auto px-8 md:px-16 z-10 relative mt-20">
                
                {/* Top Badges */}
                <div className="flex flex-col gap-3 mb-12 animate-fade-in -ml-2">
                    <div className={`inline-flex w-fit items-center px-4 py-1.5 border border-[#4d8b2d] text-xs font-bold tracking-wider transition-colors duration-500 ${isDark ? 'bg-[#1a2e0a]/40 text-[#85cc30]' : 'bg-[#4d8b2d]/10 text-[#2a4d18]'}`}>
                        NVIDIA INCEPTION PARTNER
                    </div>
                    <div className={`inline-flex w-fit items-center px-4 py-1.5 border border-[#4d8b2d] text-xs font-bold tracking-wider transition-colors duration-500 ${isDark ? 'bg-[#1a2e0a]/40 text-[#85cc30]' : 'bg-[#4d8b2d]/10 text-[#2a4d18]'}`}>
                        SERIES SEED
                    </div>
                </div>

                {/* Main Branding Segment */}
                <div className="space-y-6">
                    <h1 className={`text-8xl md:text-[140px] font-semibold tracking-tighter leading-none mb-6 transition-colors duration-500 ${isDark ? 'text-[#00f0ff]' : 'text-[#00a8b5]'}`}>
                        VetIOS
                    </h1>
                    <div className={`inline-flex w-fit items-center px-6 py-4 border-l-4 border-y border-r border-[#4d8b2d] backdrop-blur-sm -ml-2 mb-8 transition-colors duration-500 ${isDark ? 'bg-[#294211]/30' : 'bg-[#4d8b2d]/10'}`}>
                        <span className={`text-lg md:text-xl font-bold tracking-[0.2em] whitespace-nowrap transition-colors duration-500 ${isDark ? 'text-[#85cc30]' : 'text-[#2a4d18]'}`}>
                            VETERINARY INFERENCE OPERATING SYSTEM
                        </span>
                    </div>

                    <p className={`text-xl md:text-2xl max-w-2xl font-light leading-relaxed mb-6 transition-colors duration-500 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                        The Clinical Intelligence Network that makes every vet smarter and every clinic impossible to replace.
                    </p>
                    
                    {/* Cyan Bar */}
                    <div className={`w-full max-w-[500px] h-2 mb-8 transition-colors duration-500 ${isDark ? 'bg-[#00f0ff]' : 'bg-[#00a8b5]'}`} />

                    <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500 font-medium tracking-wide">
                        <span>Nairobi, Kenya</span>
                        <span>•</span>
                        <span>2026</span>
                        <span>•</span>
                        <span>vetios.tech</span>
                        <span>•</span>
                        <span>V1.0 OMEGA</span>
                    </div>
                </div>

                {/* Call to action for the original app (Login/Dashboard) */}
                <div className="mt-16 flex items-center gap-4 animate-fade-in z-20 relative">
                    <Link 
                        href="/dashboard"
                        className={`px-8 py-4 rounded-sm font-semibold transition-all ${
                            isDark 
                                ? 'bg-[#00f0ff] text-[#0a0e14] hover:bg-white hover:shadow-[0_0_20px_#00f0ff]' 
                                : 'bg-[#00a8b5] text-white hover:bg-gray-900 hover:shadow-[0_0_15px_rgba(0,168,181,0.4)]'
                        }`}
                    >
                        Launch Terminal
                    </Link>
                </div>
            </main>

            {/* Light/Dark Mode Switcher */}
            <div className={`absolute bottom-6 right-6 z-50 flex items-center gap-2 backdrop-blur-md border p-2 rounded-full shadow-lg transition-colors duration-500 ${isDark ? 'bg-black/50 border-gray-800' : 'bg-white/80 border-gray-200'}`}>
                {/* Light Mode Button */}
                <button 
                    onClick={() => setTheme('light')}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                        !isDark 
                            ? 'bg-[#00a8b5] text-white shadow-[0_0_10px_rgba(0,168,181,0.5)]' 
                            : 'text-gray-400 hover:text-white hover:bg-gray-800'
                    }`}
                    aria-label="Light Mode"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="5" />
                        <line x1="12" y1="1" x2="12" y2="3" />
                        <line x1="12" y1="21" x2="12" y2="23" />
                        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                        <line x1="1" y1="12" x2="3" y2="12" />
                        <line x1="21" y1="12" x2="23" y2="12" />
                        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                    </svg>
                </button>
                
                {/* Dark Mode Button */}
                <button 
                    onClick={() => setTheme('dark')}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                        isDark 
                            ? 'bg-[#00f0ff] text-[#0a0e14] shadow-[0_0_15px_#00f0ff]' 
                            : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                    aria-label="Dark Mode"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                    </svg>
                </button>
            </div>
        </div>
    );
}
