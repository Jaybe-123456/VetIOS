'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { TerminalSquare, ChevronRight, Moon } from 'lucide-react';

// Typewriter hook for the main headline
function useTypewriter(words: string[], typingSpeed = 150, deletingSpeed = 100, pauseDelay = 2000) {
    const [text, setText] = useState('');
    const [wordIndex, setWordIndex] = useState(0);
    const [isDeleting, setIsDeleting] = useState(false);

    useEffect(() => {
        const currentWord = words[wordIndex];
        
        const timeout = setTimeout(() => {
            if (!isDeleting) {
                // Typing
                setText(currentWord.substring(0, text.length + 1));
                if (text === currentWord) {
                    setTimeout(() => setIsDeleting(true), pauseDelay);
                }
            } else {
                // Deleting
                setText(currentWord.substring(0, text.length - 1));
                if (text === '') {
                    setIsDeleting(false);
                    setWordIndex((prev) => (prev + 1) % words.length);
                }
            }
        }, isDeleting ? deletingSpeed : typingSpeed);

        return () => clearTimeout(timeout);
    }, [text, isDeleting, wordIndex, words, typingSpeed, deletingSpeed, pauseDelay]);

    return text;
}

export default function Home() {
    const roles = ['veterinarians', 'clinics', 'ML teams', 'agents', 'scale'];
    const typedText = useTypewriter(roles);

    return (
        <div className="min-h-screen w-full bg-[#0e0e11] text-[#f2f2f3] font-sans overflow-x-hidden selection:bg-[#9747ff] selection:text-white relative">
            
            {/* Top Promo Banner */}
            <div className="w-full bg-gradient-to-r from-[#173e44] via-[#43b27f] to-[#43b27f] text-white py-2 px-4 flex justify-center items-center text-sm font-medium">
                <span>Migrate from legacy systems and get full clinical insights</span>
                <Link href="/dashboard" className="ml-4 bg-black/20 hover:bg-black/40 px-3 py-1 rounded text-xs transition-colors flex items-center">
                    Get started <ChevronRight className="w-3 h-3 ml-1" />
                </Link>
            </div>

            {/* Navigation */}
            <nav className="w-full max-w-[1400px] mx-auto px-6 h-20 flex items-center justify-between border-b border-white/5 relative z-20">
                <div className="flex items-center gap-12">
                    {/* Logo */}
                    <Link href="/" className="flex items-center gap-2 group">
                        <TerminalSquare className="w-7 h-7 text-white fill-current group-hover:text-gray-300 transition-colors" />
                        <span className="text-xl font-bold tracking-tight">VetIOS</span>
                    </Link>

                    {/* Nav Links */}
                    <div className="hidden xl:flex items-center gap-8 text-[15px] font-medium text-gray-300">
                        <Link href="/" className="hover:text-white transition-colors">Product</Link>
                        <Link href="/" className="hover:text-white transition-colors">Pricing</Link>
                        <Link href="/" className="hover:text-white transition-colors">Customers</Link>
                        <Link href="/" className="hover:text-white transition-colors">Docs</Link>
                        <Link href="/" className="hover:text-white transition-colors">Changelog</Link>
                    </div>
                </div>

                <div className="flex items-center gap-8 text-[15px] font-medium">
                    <Link href="/" className="hidden sm:block text-gray-300 hover:text-white transition-colors">Contact</Link>
                    <Link 
                        href="/dashboard"
                        className="bg-white text-black px-6 py-2.5 rounded-sm hover:bg-gray-100 transition-colors tracking-wide font-semibold"
                    >
                        Dashboard
                    </Link>
                </div>
            </nav>

            {/* Background Grid Pattern */}
            <div className="absolute top-0 right-0 w-2/3 h-full hidden lg:block opacity-[0.03] pointer-events-none z-0 mt-32" style={{
                backgroundImage: 'linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)',
                backgroundSize: '80px 80px',
                maskImage: 'linear-gradient(to right, transparent, black)'
            }} />

            {/* Main Content */}
            <main className="w-full max-w-[1400px] mx-auto px-6 pt-24 pb-32 flex flex-col lg:flex-row relative z-10">
                
                {/* Left Column (Text) */}
                <div className="w-full lg:w-[65%] pt-12 lg:pt-24 relative z-10">
                    <style dangerouslySetInnerHTML={{__html: `
                        .title-kerning { letter-spacing: -0.04em; }
                    `}} />
                    <h1 className="text-[64px] sm:text-[90px] lg:text-[112px] font-medium leading-[0.95] text-white mb-10 title-kerning">
                        Your fastest path to <br className="hidden sm:block"/> production for <br />
                        <span className="text-[#9747ff] relative font-medium">
                            {typedText}
                            <span className="inline-block w-[6px] h-[75px] sm:h-[105px] bg-[#43b27f] ml-1.5 align-text-bottom animate-pulse mb-2"></span>
                        </span>
                    </h1>
                    
                    <p className="text-xl sm:text-2xl text-gray-400 max-w-2xl font-normal leading-snug">
                        Intuitive infrastructure to scale any app or agent from your first user to your billionth.
                    </p>
                </div>

                {/* Right Column (Visual) */}
                <div className="w-full lg:w-[35%] hidden lg:block relative mt-16 z-10">
                    
                    {/* "$ git push" tag */}
                    <div className="absolute top-8 left-0 bg-[#dfdfdf] text-black font-mono px-5 py-2.5 font-bold text-[15px] rounded-sm flex items-center shadow-[0_0_20px_rgba(255,255,255,0.05)] z-20">
                        $ git push
                    </div>
                    
                    {/* Connection line */}
                    <svg className="absolute top-[60px] left-[40px] w-32 h-24 stroke-[#9747ff] fill-none z-10" xmlns="http://www.w3.org/2000/svg">
                        <path d="M 0 0 L 0 45 L 80 45" strokeWidth="1.5" strokeLinecap="square" strokeLinejoin="miter" />
                    </svg>

                    {/* Dashboard Mockup Panel */}
                    <div className="absolute top-[80px] left-[120px] w-[600px] bg-[#09090b] border border-white/5 rounded-md p-6 shadow-2xl z-20 font-mono">
                        <div className="text-[10px] text-gray-500 font-mono mb-4 tracking-[0.2em] font-semibold">PRODUCTION</div>
                        
                        <div className="grid grid-cols-2 gap-4">
                            {/* Card 1 */}
                            <div className="border border-white/5 rounded p-4 bg-white/[0.01]">
                                <div className="flex justify-between items-center mb-8">
                                    <span className="text-[11px] text-gray-400 font-medium">app-backend</span>
                                    <span className="text-[10px] text-gray-500 flex items-center gap-1.5">
                                        <span className="w-2 h-2 rounded-full border border-gray-500 bg-transparent animate-pulse"></span> Deploying
                                    </span>
                                </div>
                                <div className="flex justify-between items-end">
                                    <div className="w-[45%]">
                                        <div className="text-[9px] text-gray-600 mb-2">MEMORY</div>
                                        <div className="w-full h-8 flex items-end">
                                            <svg width="100%" height="100%" viewBox="0 0 100 30" preserveAspectRatio="none">
                                                <path d="M0,25 L0,20 Q10,10 20,22 T40,15 T60,25 T80,10 T100,20 L100,30 Z" fill="rgba(151, 71, 255, 0.15)" />
                                                <path d="M0,20 Q10,10 20,22 T40,15 T60,25 T80,10 T100,20" fill="none" stroke="#9747ff" strokeWidth="1.5" />
                                            </svg>
                                        </div>
                                    </div>
                                    <div className="w-[45%]">
                                        <div className="text-[9px] text-gray-600 mb-2">CPU</div>
                                        <div className="w-full h-8 flex items-end">
                                            <svg width="100%" height="100%" viewBox="0 0 100 30" preserveAspectRatio="none">
                                                <path d="M0,20 Q20,25 40,18 T70,22 T100,10" fill="none" stroke="#9747ff" strokeWidth="1.5" />
                                            </svg>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            {/* Card 2 */}
                            <div className="border border-white/5 rounded p-4 bg-white/[0.01]">
                                <div className="flex justify-between items-center mb-8">
                                    <span className="text-[11px] text-gray-400 font-medium">app-backend</span>
                                    <span className="text-[10px] text-gray-500 flex items-center gap-1.5">
                                        <span className="w-2 h-2 rounded-full border border-gray-500 bg-transparent"></span> Deploying
                                    </span>
                                </div>
                                <div className="flex justify-between items-end">
                                    <div className="w-[45%]">
                                        <div className="text-[9px] text-gray-600 mb-2">MEMORY</div>
                                        <div className="w-full h-8 flex items-end opacity-50">
                                            <svg width="100%" height="100%" viewBox="0 0 100 30" preserveAspectRatio="none">
                                                <path d="M0,30 L0,25 Q15,20 25,28 T50,22 T75,25 T100,15 L100,30 Z" fill="rgba(151, 71, 255, 0.15)" />
                                                <path d="M0,25 Q15,20 25,28 T50,22 T75,25 T100,15" fill="none" stroke="#9747ff" strokeWidth="1.5" />
                                            </svg>
                                        </div>
                                    </div>
                                    <div className="w-[45%]">
                                        <div className="text-[9px] text-gray-600 mb-2">CPU</div>
                                        <div className="w-full h-8 flex items-end opacity-50">
                                            <svg width="100%" height="100%" viewBox="0 0 100 30" preserveAspectRatio="none">
                                                <path d="M0,25 Q30,25 50,15 T100,20" fill="none" stroke="#9747ff" strokeWidth="1.5" />
                                            </svg>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Card 3 */}
                            <div className="border border-white/5 rounded p-4 bg-white/[0.01]">
                                <div className="flex justify-between items-center mb-8">
                                    <span className="text-[11px] text-gray-400 font-medium">app-database</span>
                                    <span className="text-[10px] text-[#43b27f] flex items-center gap-1.5">
                                        <span className="text-[#43b27f]">✓</span> Available
                                    </span>
                                </div>
                                <div className="flex justify-between items-end">
                                    <div className="w-[45%]">
                                        <div className="text-[9px] text-gray-600 mb-2">MEMORY</div>
                                        <div className="w-full h-8 flex items-end">
                                            <svg width="100%" height="100%" viewBox="0 0 100 30" preserveAspectRatio="none">
                                                <path d="M0,25 L0,20 Q15,15 30,22 T60,18 T100,25 L100,25 Z" fill="rgba(151, 71, 255, 0.15)" />
                                                <path d="M0,20 Q15,15 30,22 T60,18 T100,25" fill="none" stroke="#9747ff" strokeWidth="1.5" />
                                            </svg>
                                        </div>
                                    </div>
                                    <div className="w-[45%]">
                                        <div className="text-[9px] text-gray-600 mb-2">CPU</div>
                                        <div className="w-full h-8 flex items-end">
                                            <svg width="100%" height="100%" viewBox="0 0 100 30" preserveAspectRatio="none">
                                                <path d="M0,28 Q20,28 40,25 T70,26 T100,25" fill="none" stroke="#9747ff" strokeWidth="1.5" />
                                            </svg>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            {/* Card 4 */}
                            <div className="border border-white/5 rounded p-4 bg-white/[0.01]">
                                <div className="flex justify-between items-center mb-8">
                                    <span className="text-[11px] text-gray-400 font-medium">app-frontend</span>
                                    <span className="text-[10px] text-[#43b27f] flex items-center gap-1.5">
                                        <span className="text-[#43b27f]">✓</span>
                                    </span>
                                </div>
                                <div className="flex justify-between items-end">
                                    <div className="w-[45%]">
                                        <div className="text-[9px] text-gray-600 mb-2">BANDWIDTH</div>
                                        <div className="w-full h-8 flex items-end">
                                            <svg width="100%" height="100%" viewBox="0 0 100 30" preserveAspectRatio="none">
                                                <path d="M0,25 L0,15 Q20,5 30,12 T70,8 T100,15 L100,25 Z" fill="rgba(151, 71, 255, 0.15)" />
                                                <path d="M0,15 Q20,5 30,12 T70,8 T100,15" fill="none" stroke="#9747ff" strokeWidth="1.5" />
                                            </svg>
                                        </div>
                                    </div>
                                    <div className="w-[45%]">
                                        <div className="text-[9px] text-gray-600 mb-2">REQUESTS</div>
                                        <div className="w-full h-8 flex items-end">
                                            <svg width="100%" height="100%" viewBox="0 0 100 30" preserveAspectRatio="none">
                                                <path d="M0,22 Q20,15 40,20 T70,18 T100,15" fill="none" stroke="#9747ff" strokeWidth="1.5" />
                                            </svg>
                                        </div>
                                    </div>
                                </div>
                            </div>

                        </div>
                    </div>
                    
                    {/* Floating Purple Accent Box */}
                    <div className="absolute top-[28%] right-[-100px] w-36 h-36 bg-[#8338ec] z-10 hidden xl:flex items-center justify-center">
                        <div className="w-20 h-6 bg-white/30 mr-8"></div>
                    </div>

                </div>
            </main>

            {/* Bottom Right Theme Toggle (Visual only for accuracy to image) */}
            <div className="fixed bottom-6 right-6 z-50">
                <button className="w-12 h-12 flex items-center justify-center border border-white/20 bg-black/60 backdrop-blur rounded hover:border-white/40 transition-colors">
                    <Moon className="w-5 h-5 text-gray-300" />
                </button>
            </div>
            
        </div>
    );
}
