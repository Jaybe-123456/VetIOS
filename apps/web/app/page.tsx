'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function Home() {
    // Mode switch state
    const [mode, setMode] = useState<'default' | 'omega'>('omega');

    return (
        <div className="min-h-screen w-full relative overflow-hidden bg-[#0a0e14] text-white flex flex-col font-sans transition-colors duration-500">
            {/* Base Grid Background - Right Side */}
            <div className="absolute top-0 right-0 w-1/2 h-full hidden lg:block opacity-70 pointer-events-none">
                <div
                    className="w-full h-full"
                    style={{
                        backgroundImage: `radial-gradient(circle at center, transparent 0%, #0a0e14 100%), radial-gradient(circle, #00f0ff 1px, transparent 1.5px)`,
                        backgroundSize: '100% 100%, 48px 48px',
                        backgroundPosition: '0 0, 24px 24px'
                    }}
                />
            </div>

            {/* Grid Dots implementation (closer to image reference with circles) */}
            <div className="absolute top-0 right-0 w-[55%] h-full hidden md:flex items-center pointer-events-none z-0">
                <div className="w-full h-full relative" style={{ background: '#0a0e14' }}>
                    <div className="absolute inset-0 grid" style={{ gridTemplateColumns: 'repeat(8, 1fr)', gridTemplateRows: 'repeat(12, 1fr)', gap: '0' }}>
                        {Array.from({ length: 96 }).map((_, i) => (
                            <div key={i} className="flex items-center justify-center w-full h-full">
                                <div className="w-2 h-2 rounded-full border-2 border-[#00f0ff]"></div>
                            </div>
                        ))}
                    </div>
                    {/* Gradient mask to blend left edge */}
                    <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-[#0a0e14] to-transparent z-10" />
                </div>
            </div>

            {/* Main Content */}
            <main className="flex flex-col justify-center flex-1 w-full max-w-7xl mx-auto px-8 md:px-16 z-10 relative mt-20">

                {/* Top Badges */}
                {mode === 'omega' && (
                    <div className="flex flex-col gap-3 mb-12 animate-fade-in -ml-2">
                        <div className="inline-flex w-fit items-center px-4 py-1.5 border border-[#4d8b2d] bg-[#1a2e0a]/40 text-[#85cc30] text-xs font-bold tracking-wider">
                            NVIDIA INCEPTION PARTNER
                        </div>
                        <div className="inline-flex w-fit items-center px-4 py-1.5 border border-[#4d8b2d] bg-[#1a2e0a]/40 text-[#85cc30] text-xs font-bold tracking-wider">
                            SERIES SEED
                        </div>
                    </div>
                )}

                {/* Main Branding Segment */}
                <div className="space-y-6">
                    {mode === 'omega' ? (
                        <>
                            <h1 className="text-8xl md:text-[140px] font-semibold tracking-tighter text-[#00f0ff] leading-none mb-6">
                                VetIOS
                            </h1>
                            <div className="inline-flex w-fit items-center px-6 py-4 border-l-4 border-y border-r border-[#4d8b2d] bg-[#294211]/30 backdrop-blur-sm -ml-2 mb-8">
                                <span className="text-[#85cc30] text-lg md:text-xl font-bold tracking-[0.2em] whitespace-nowrap">
                                    VETERINARY INFERENCE OPERATING SYSTEM
                                </span>
                            </div>
                        </>
                    ) : (
                        <>
                            <h1 className="text-6xl md:text-[90px] font-bold tracking-tight text-white mb-6">
                                Welcome to VetIOS
                            </h1>
                            <p className="text-xl text-gray-400 max-w-xl">
                                Enter the clinical intelligence hub to explore veterinary models.
                            </p>
                        </>
                    )}

                    <p className={`text-xl md:text-2xl text-gray-300 max-w-2xl font-light leading-relaxed mb-6 ${mode === 'default' ? 'hidden' : ''}`}>
                        The Clinical Intelligence Network that makes every vet smarter and every clinic impossible to replace.
                    </p>

                    {/* Cyan Bar */}
                    {mode === 'omega' && (
                        <div className="w-full max-w-[500px] h-2 bg-[#00f0ff] mb-8" />
                    )}

                    <div className={`flex flex-wrap items-center gap-2 text-sm text-gray-500 font-medium tracking-wide ${mode === 'default' ? 'hidden' : ''}`}>
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
                        className={`px-8 py-4 rounded-sm font-semibold transition-all ${mode === 'omega'
                                ? 'bg-[#00f0ff] text-[#0a0e14] hover:bg-white hover:shadow-[0_0_20px_#00f0ff]'
                                : 'bg-white text-black hover:bg-gray-200'
                            }`}
                    >
                        Launch Terminal
                    </Link>
                </div>
            </main>

            {/* Mode Switcher */}
            <div className="absolute bottom-6 right-6 z-50 flex items-center gap-2 bg-black/50 backdrop-blur-md border border-gray-800 p-2 rounded-full shadow-lg">
                <button
                    onClick={() => setMode('default')}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${mode === 'default' ? 'bg-white text-black' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
                    aria-label="Standard Mode"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /></svg>
                </button>
                <button
                    onClick={() => setMode('omega')}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-[0_0_10px_transparent] ${mode === 'omega' ? 'bg-[#00f0ff] text-[#0a0e14] shadow-[0_0_15px_#00f0ff]' : 'text-gray-400 hover:text-[#00f0ff] hover:bg-gray-800'}`}
                    aria-label="Omega Mode"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" /></svg>
                </button>
            </div>
        </div>
    );
}
