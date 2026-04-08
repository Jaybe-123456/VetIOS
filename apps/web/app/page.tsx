'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
    TerminalSquare, ArrowRight, BrainCircuit, RefreshCw, 
    Database, Activity, FileKey, Smartphone, Lock, 
    FileText, ShieldCheck, Server, Key, FileCheck
} from 'lucide-react';

// --- Typewriter Hook ---
function useTypewriter(words: string[], typingSpeed = 100, deletingSpeed = 50, pauseDelay = 2500) {
    const [text, setText] = useState('');
    const [wordIndex, setWordIndex] = useState(0);
    const [isDeleting, setIsDeleting] = useState(false);

    useEffect(() => {
        const currentWord = words[wordIndex];
        const timeout = setTimeout(() => {
            if (!isDeleting) {
                setText(currentWord.substring(0, text.length + 1));
                if (text === currentWord) {
                    setTimeout(() => setIsDeleting(true), pauseDelay);
                }
            } else {
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

export default function LandingPage() {
    const heroWords = ["Nairobi clinics", "East African vets", "every species", "your practice"];
    const typedText = useTypewriter(heroWords);

    return (
        <div className="min-h-screen w-full bg-[#0d1117] text-white font-sans selection:bg-[#00e5ff] selection:text-black overflow-x-hidden">
            
            {/* --- 1. NAVBAR --- */}
            <nav className="fixed top-0 w-full z-50 bg-[#0d1117]/80 backdrop-blur-md border-b border-[#00e5ff]/15">
                <div className="max-w-[1400px] mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-8">
                        <Link href="/" className="flex items-center gap-2 group">
                            <TerminalSquare className="w-6 h-6 text-[#00e5ff]" />
                            <span className="font-mono text-xl font-bold tracking-tight">VetIOS</span>
                            <span className="hidden sm:inline-flex ml-2 items-center px-2 py-0.5 border border-[#39ff14]/30 bg-[#39ff14]/10 text-[#39ff14] text-[10px] font-mono font-bold tracking-wider rounded-sm">
                                NVIDIA INCEPTION PARTNER
                            </span>
                        </Link>
                        
                        <div className="hidden lg:flex items-center gap-6 text-sm font-medium text-gray-300">
                            <Link href="#product" className="hover:text-[#00e5ff] transition-colors">Product</Link>
                            <Link href="#pricing" className="hover:text-[#00e5ff] transition-colors">Pricing</Link>
                            <Link href="#customers" className="hover:text-[#00e5ff] transition-colors">Customers</Link>
                            <Link href="/docs" className="hover:text-[#00e5ff] transition-colors">Docs</Link>
                            <Link href="/changelog" className="hover:text-[#00e5ff] transition-colors">Changelog</Link>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <Link href="/login" className="hidden sm:flex px-4 py-2 text-sm font-medium border border-[#00e5ff] text-[#00e5ff] hover:bg-[#00e5ff]/10 rounded-sm transition-colors">
                            Sign In
                        </Link>
                        <Link href="/dashboard" className="px-4 py-2 text-sm font-bold bg-[#00e5ff] text-[#0d1117] hover:bg-white hover:text-black rounded-sm transition-all shadow-[0_0_15px_rgba(0,229,255,0.4)]">
                            Get Started
                        </Link>
                    </div>
                </div>
            </nav>

            {/* --- 2. HERO --- */}
            <section className="relative pt-32 pb-20 px-6 max-w-[1400px] mx-auto z-10 flex flex-col items-center text-center">
                
                {/* Background Pattern */}
                <div className="absolute inset-0 z-0 pointer-events-none" style={{
                    backgroundImage: 'radial-gradient(circle at center, #00e5ff 1px, transparent 1px)',
                    backgroundSize: '40px 40px',
                    opacity: 0.15,
                    maskImage: 'radial-gradient(circle at center, black 30%, transparent 70%)',
                    WebkitMaskImage: 'radial-gradient(circle at center, black 30%, transparent 70%)'
                }} />

                <div className="relative z-10 flex flex-col items-center w-full">
                    <Link href="/changelog" className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[#00e5ff]/30 bg-[#00e5ff]/10 text-[#00e5ff] text-sm font-medium mb-8 hover:bg-[#00e5ff]/20 transition-colors cursor-pointer">
                        <span className="w-2 h-2 rounded-full bg-[#00e5ff] animate-pulse"></span>
                        Now live: VetIOS V1.0 OMEGA — East Africa&apos;s only veterinary AI platform <ArrowRight className="w-4 h-4" />
                    </Link>

                    <h1 className="text-5xl md:text-7xl lg:text-[84px] font-mono font-bold leading-tight tracking-tighter mb-6 max-w-5xl">
                        The Clinical Intelligence Network for <br className="hidden md:block" />
                        <span className="text-[#00e5ff] border-b-4 border-[#39ff14] min-w-[300px] inline-block text-left relative">
                            {typedText}
                            <span className="absolute -right-2 top-0 bottom-0 w-[4px] bg-[#00e5ff] animate-pulse"></span>
                        </span>
                    </h1>

                    <p className="text-xl md:text-2xl text-gray-400 max-w-3xl font-light mb-10 leading-relaxed">
                        A federated, outcomes-learning AI operating system that turns every clinic into a network node — making the entire veterinary system smarter with every case.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center gap-4 mb-12">
                        <Link href="/dashboard" className="w-full sm:w-auto px-8 py-4 text-base font-bold bg-[#00e5ff] text-[#0d1117] hover:bg-white rounded-sm transition-all shadow-[0_0_20px_rgba(0,229,255,0.4)] hover:shadow-[0_0_30px_rgba(0,229,255,0.6)]">
                            Start for free
                        </Link>
                        <Link href="#features" className="w-full sm:w-auto px-8 py-4 text-base font-medium border border-[#00e5ff] text-[#00e5ff] hover:bg-[#00e5ff]/10 rounded-sm transition-colors">
                            See how it works
                        </Link>
                    </div>

                    <p className="text-sm text-gray-500 flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-[#39ff14]" /> Trusted by 47+ Nairobi clinics and growing
                    </p>
                </div>
            </section>

            {/* --- 3. TRUSTED BY --- */}
            <section className="w-full border-y border-[#00e5ff]/15 bg-[#1a2332]/50 py-6 overflow-hidden flex items-center relative">
                {/* Gradient Masks for Marquee fade */}
                <div className="absolute left-0 top-0 bottom-0 w-32 bg-gradient-to-r from-[#0d1117] to-transparent z-10" />
                <div className="absolute right-0 top-0 bottom-0 w-32 bg-gradient-to-l from-[#0d1117] to-transparent z-10" />
                
                <div className="flex gap-16 items-center px-4 animate-[marquee_20s_linear_infinite] whitespace-nowrap opacity-60 font-mono text-sm tracking-widest font-bold text-gray-300">
                    <span>UON NAIROBI</span>
                    <span className="text-[#00e5ff]">•</span>
                    <span>ILRI</span>
                    <span className="text-[#00e5ff]">•</span>
                    <span>HARDY VETERINARY</span>
                    <span className="text-[#00e5ff]">•</span>
                    <span>LAVINGTON VET</span>
                    <span className="text-[#00e5ff]">•</span>
                    <span>PETPALS KILIMANI</span>
                    <span className="text-[#00e5ff]">•</span>
                    <span>THE ANDYS</span>
                    <span className="text-[#00e5ff]">•</span>
                    <span>WSU GLOBAL HEALTH KENYA</span>
                    <span className="text-[#00e5ff]">•</span>
                    <span>CORNELL COLLEGE OF VET MEDICINE</span>
                    <span className="text-[#00e5ff]">•</span>
                    <span className="text-[#39ff14]">NVIDIA</span>
                    
                    {/* Duplicate for infinite scroll */}
                    <span className="text-[#00e5ff]">•</span>
                    <span>UON NAIROBI</span>
                    <span className="text-[#00e5ff]">•</span>
                    <span>ILRI</span>
                    <span className="text-[#00e5ff]">•</span>
                    <span>HARDY VETERINARY</span>
                </div>
            </section>

            {/* --- 4. HOW IT WORKS --- */}
            <section id="features" className="py-24 px-6 max-w-[1400px] mx-auto">
                <div className="text-center mb-16 animate-fade-in-up">
                    <h2 className="text-4xl md:text-5xl font-mono font-bold mb-4">From symptoms to certainty in seconds.</h2>
                    <p className="text-gray-400 text-lg">Click, click, done. The simplest clinical pipeline deployed.</p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Step 1 */}
                    <div className="bg-[#1a2332] border border-[#00e5ff]/15 rounded-md p-6 hover:border-[#00e5ff]/50 hover:shadow-[0_0_20px_rgba(0,229,255,0.1)] transition-all group">
                        <div className="w-10 h-10 border border-[#00e5ff] text-[#00e5ff] rounded-full flex items-center justify-center font-mono font-bold text-lg mb-6 group-hover:bg-[#00e5ff] group-hover:text-[#0d1117] transition-colors">1</div>
                        <h3 className="text-xl font-bold mb-3 font-mono text-white">Enter Clinical Data</h3>
                        <p className="text-sm text-gray-400 mb-8 leading-relaxed">
                            Structured capture of symptoms, biomarkers, species history (Canine, Feline, Equine).
                        </p>
                        <div className="bg-[#0d1117] border border-[#00e5ff]/10 rounded p-4 font-mono text-xs text-[#39ff14] overflow-hidden">
                            <div className="mb-2 text-gray-500">{"// Payload"}</div>
                            <div>{`{`}</div>
                            <div className="pl-4">{`"species": "Canine",`}</div>
                            <div className="pl-4">{`"temp_c": 39.5,`}</div>
                            <div className="pl-4">{`"symptoms": ["lethargy", "vomiting"]`}</div>
                            <div>{`}`}</div>
                        </div>
                    </div>

                    {/* Step 2 */}
                    <div className="bg-[#1a2332] border border-[#00e5ff]/15 rounded-md p-6 hover:border-[#00e5ff]/50 hover:shadow-[0_0_20px_rgba(0,229,255,0.1)] transition-all group">
                        <div className="w-10 h-10 border border-[#00e5ff] text-[#00e5ff] rounded-full flex items-center justify-center font-mono font-bold text-lg mb-6 group-hover:bg-[#00e5ff] group-hover:text-[#0d1117] transition-colors">2</div>
                        <h3 className="text-xl font-bold mb-3 font-mono text-white">AI Inference</h3>
                        <p className="text-sm text-gray-400 mb-8 leading-relaxed">
                            Real-time ranked differentials with confidence scoring. Nairobi-calibrated prevalence model.
                        </p>
                        <div className="bg-[#0d1117] border border-[#00e5ff]/10 rounded p-4 font-mono text-xs">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-[#00e5ff]">Canine Parvovirus</span>
                                <span className="text-[#39ff14]">94.2%</span>
                            </div>
                            <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden mb-4">
                                <div className="bg-[#39ff14] w-[94.2%] h-full"></div>
                            </div>
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-gray-400">Ehrlichiosis</span>
                                <span className="text-orange-400">12.5%</span>
                            </div>
                            <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                                <div className="bg-orange-400 w-[12.5%] h-full"></div>
                            </div>
                        </div>
                    </div>

                    {/* Step 3 */}
                    <div className="bg-[#1a2332] border border-[#00e5ff]/15 rounded-md p-6 hover:border-[#00e5ff]/50 hover:shadow-[0_0_20px_rgba(0,229,255,0.1)] transition-all group">
                        <div className="w-10 h-10 border border-[#00e5ff] text-[#00e5ff] rounded-full flex items-center justify-center font-mono font-bold text-lg mb-6 group-hover:bg-[#00e5ff] group-hover:text-[#0d1117] transition-colors">3</div>
                        <h3 className="text-xl font-bold mb-3 font-mono text-white">Outcome Learning</h3>
                        <p className="text-sm text-gray-400 mb-8 leading-relaxed">
                            Every closed case recalibrates the model. The network gets smarter for every clinic in the region.
                        </p>
                        <div className="bg-[#0d1117] border border-[#00e5ff]/10 rounded p-4 font-mono text-xs text-center flex flex-col items-center justify-center h-[120px]">
                            <RefreshCw className="w-8 h-8 text-[#00e5ff] mb-2 animate-spin-slow" />
                            <span className="text-[#00e5ff]">Model Weights Updated</span>
                            <span className="text-gray-500 mt-1">Global prevalence shifted +0.01%</span>
                        </div>
                    </div>
                </div>
            </section>

            {/* --- 5. FEATURE BENTO GRID --- */}
            <section className="py-24 px-6 max-w-[1400px] mx-auto border-t border-white/5">
                <div className="mb-16">
                    <h2 className="text-4xl md:text-5xl font-mono font-bold mb-4">Deploy clinical intelligence. Zero ops.</h2>
                    <p className="text-gray-400 text-lg">Intuitive AI infrastructure to scale any clinic from day one to regional dominance.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[
                        { icon: BrainCircuit, title: "Inference Console", desc: "Real-time diagnostic probability + confidence metrics" },
                        { icon: RefreshCw, title: "Federated Outcome Learning", desc: "Privacy-preserving model recalibration after every case" },
                        { icon: Database, title: "East Africa Clinical Dataset", desc: "The only Nairobi-calibrated veterinary outcomes database" },
                        { icon: Activity, title: "Adversarial Simulation Lab", desc: "10M edge-case scenarios/day. 99.9% pre-deployment threshold" },
                        { icon: FileKey, title: "Model Registry", desc: "Versioned, auditable AI models with public Model Cards" },
                        { icon: Smartphone, title: "PetPass App", desc: "Consumer app that pulls pet owners toward your clinic" }
                    ].map((feature, i) => (
                        <div key={i} className="bg-[#1a2332] border border-[#00e5ff]/15 rounded-md p-6 hover:border-[#00e5ff]/50 hover:shadow-[0_0_20px_rgba(0,229,255,0.1)] transition-all cursor-crosshair">
                            <feature.icon className="w-8 h-8 text-[#39ff14] mb-4" />
                            <h4 className="text-lg font-mono font-bold mb-2 text-white">{feature.title}</h4>
                            <p className="text-sm text-gray-400 leading-relaxed">{feature.desc}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* --- 6. FEATURE DEEP DIVES --- */}
            <section className="py-24 px-6 max-w-[1400px] mx-auto space-y-32">
                
                {/* Row 1 */}
                <div className="flex flex-col lg:flex-row items-center gap-16">
                    <div className="w-full lg:w-1/2">
                        <h2 className="text-3xl md:text-4xl font-mono font-bold mb-6 text-white">The Reality Calibration Loop</h2>
                        <p className="text-lg text-gray-400 mb-8 leading-relaxed">
                            The system is self-correcting. Every diagnostic delta becomes a training signal. The more clinics use VetIOS, the more accurate it becomes — for every clinic.
                        </p>
                        <Link href="/docs/outcome-learning" className="inline-flex items-center text-[#00e5ff] font-bold hover:underline font-mono">
                            Outcome Learning docs <ArrowRight className="w-4 h-4 ml-2" />
                        </Link>
                    </div>
                    <div className="w-full lg:w-1/2 bg-[#1a2332] border border-[#00e5ff]/20 rounded-lg p-8 shadow-[0_0_40px_rgba(0,229,255,0.05)]">
                        <div className="flex items-center justify-between relative">
                            <div className="absolute inset-0 top-1/2 h-[2px] bg-gradient-to-r from-gray-700 via-[#00e5ff] to-[#39ff14] -z-10 -translate-y-1/2"></div>
                            <div className="w-24 h-24 rounded bg-[#0d1117] border border-gray-700 flex flex-col items-center justify-center font-mono text-xs text-white z-10">
                                <span className="mb-1">Prediction</span>
                                <span className="text-gray-500">v1.2</span>
                            </div>
                            <div className="w-24 h-24 rounded bg-[#0d1117] border border-[#00e5ff] flex flex-col items-center justify-center font-mono text-xs text-[#00e5ff] z-10 shadow-[0_0_15px_rgba(0,229,255,0.2)]">
                                <span className="mb-1">Outcome</span>
                                <span className="text-[#00e5ff]">+True Pos</span>
                            </div>
                            <div className="w-24 h-24 rounded bg-[#0d1117] border border-[#39ff14] flex flex-col items-center justify-center font-mono text-xs text-[#39ff14] z-10 shadow-[0_0_15px_rgba(57,255,20,0.2)]">
                                <span className="mb-1">Learn</span>
                                <span className="text-[#39ff14]">Weights++</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Row 2 */}
                <div className="flex flex-col lg:flex-row-reverse items-center gap-16">
                    <div className="w-full lg:w-1/2">
                        <h2 className="text-3xl md:text-4xl font-mono font-bold mb-6 text-white">Full-stack previews for every case record</h2>
                        <p className="text-lg text-gray-400 mb-8 leading-relaxed">
                            Every patient case creates a versioned, auditable snapshot. Your Clinic Memory Engine never forgets an interaction, test result, or outcome.
                        </p>
                        <Link href="/docs/memory-engine" className="inline-flex items-center text-[#00e5ff] font-bold hover:underline font-mono">
                            Clinic Memory Engine docs <ArrowRight className="w-4 h-4 ml-2" />
                        </Link>
                    </div>
                    <div className="w-full lg:w-1/2 bg-[#1a2332] border border-[#00e5ff]/20 rounded-lg p-6 flex shadow-[0_0_40px_rgba(0,229,255,0.05)] h-64">
                        <div className="w-1/3 border-r border-white/5 pr-4 flex flex-col gap-3 font-mono text-xs">
                            <div className="text-gray-500 mb-2">HISTORY</div>
                            <div className="bg-[#00e5ff]/10 border border-[#00e5ff]/30 text-[#00e5ff] p-2 rounded cursor-pointer">v4 — Final Dx</div>
                            <div className="text-gray-400 p-2 border border-transparent cursor-pointer hover:bg-white/5 rounded">v3 — Lab Results</div>
                            <div className="text-gray-400 p-2 border border-transparent cursor-pointer hover:bg-white/5 rounded">v2 — Inference</div>
                            <div className="text-gray-400 p-2 border border-transparent cursor-pointer hover:bg-white/5 rounded">v1 — Intake</div>
                        </div>
                        <div className="w-2/3 pl-6 font-mono text-xs overflow-hidden text-gray-300">
                            <div className="flex gap-2 items-center text-[#39ff14] mb-4">
                                <ShieldCheck className="w-4 h-4" /> Confirmed Snapshot Snapshot Hash: 8a9b2f...
                            </div>
                            <div className="mb-2">Diagnosis: <span className="text-white font-bold">Tick Fever</span></div>
                            <div className="mb-2">Confidence: <span className="text-[#00e5ff]">98.1%</span></div>
                            <div className="text-gray-500 mt-4 leading-normal">
                                {`/* Treatment plan executed successfully. Patient recovered in 48 hours. Metrics captured for federated learning pool. */`}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Row 3 */}
                <div className="flex flex-col lg:flex-row items-center gap-16">
                    <div className="w-full lg:w-1/2">
                        <h2 className="text-3xl md:text-4xl font-mono font-bold mb-6 text-white">Adversarial Simulation: Stress-tested before it ships</h2>
                        <p className="text-lg text-gray-400 mb-8 leading-relaxed">
                            Models don&apos;t fail on average cases — they fail at the edges. 10M synthetic scenarios/day. No model ships until 99.9% adversarial accuracy is cleared.
                        </p>
                        <Link href="/docs/simulation" className="inline-flex items-center text-[#00e5ff] font-bold hover:underline font-mono">
                            Simulation Lab docs <ArrowRight className="w-4 h-4 ml-2" />
                        </Link>
                    </div>
                    <div className="w-full lg:w-1/2 bg-[#1a2332] border border-[#00e5ff]/20 rounded-lg p-8 grid grid-cols-2 gap-4 shadow-[0_0_40px_rgba(0,229,255,0.05)]">
                        <div className="col-span-2 bg-[#0d1117] border border-gray-800 rounded p-6 text-center">
                            <div className="text-5xl font-mono font-bold text-[#00e5ff] mb-2 tracking-tighter">10,000,000</div>
                            <div className="text-gray-500 font-mono text-xs uppercase tracking-widest">Synthetic Scenarios / Day</div>
                        </div>
                        <div className="bg-[#0d1117] border border-gray-800 rounded p-6 text-center">
                            <div className="text-3xl font-mono font-bold text-[#39ff14] mb-2">99.9%</div>
                            <div className="text-gray-500 font-mono text-xs uppercase tracking-widest">Pass Rate</div>
                        </div>
                        <div className="bg-[#0d1117] border border-gray-800 rounded p-6 text-center">
                            <div className="text-3xl font-mono font-bold text-white mb-2">500</div>
                            <div className="text-gray-500 font-mono text-xs uppercase tracking-widest">TFLOPS Avg</div>
                        </div>
                    </div>
                </div>

                {/* Row 4 */}
                <div className="flex flex-col lg:flex-row-reverse items-center gap-16">
                    <div className="w-full lg:w-1/2">
                        <h2 className="text-3xl md:text-4xl font-mono font-bold mb-6 text-white">Enterprise-grade multi-tenant isolation</h2>
                        <p className="text-lg text-gray-400 mb-8 leading-relaxed">
                            DB-level row isolation. Per-tenant rate limiting. Two-tier RBAC. No clinic bleeds into another. Your proprietary clinical data remains entirely yours.
                        </p>
                        <Link href="/docs/ops" className="inline-flex items-center text-[#00e5ff] font-bold hover:underline font-mono">
                            Platform ops docs <ArrowRight className="w-4 h-4 ml-2" />
                        </Link>
                    </div>
                    <div className="w-full lg:w-1/2 bg-[#1a2332] border border-[#00e5ff]/20 rounded-lg p-8 shadow-[0_0_40px_rgba(0,229,255,0.05)] font-mono text-sm">
                        <div className="border border-gray-700/50 rounded bg-[#0d1117] p-4 text-center text-[#00e5ff] mb-4">
                            Global Load Balancer / WAF
                        </div>
                        <div className="flex justify-between gap-4 mb-4">
                            <div className="flex-1 border border-gray-700/50 rounded bg-[#0d1117] p-2 text-center text-xs text-gray-300">Tenant Route A</div>
                            <div className="flex-1 border border-gray-700/50 rounded bg-[#0d1117] p-2 text-center text-xs text-gray-300">Tenant Route B</div>
                        </div>
                        <div className="border border-[#39ff14]/50 rounded bg-[#39ff14]/5 p-4 text-center text-[#39ff14]">
                            Strict Row-Level Security (RLS) PostgreSQL Policies
                        </div>
                    </div>
                </div>

            </section>

            {/* --- 7. TESTIMONIAL --- */}
            <section className="py-24 px-6 bg-[#00e5ff]/5 border-y border-[#00e5ff]/15">
                <div className="max-w-4xl mx-auto text-center">
                    <div className="text-[#00e5ff] text-6xl font-serif mb-4">&quot;</div>
                    <p className="text-2xl md:text-3xl font-light text-white mb-8 leading-snug font-sans">
                        VetIOS is the only platform that actually knows what diseases look like in Nairobi. Western AI gave us London differentials. <span className="font-bold text-[#00e5ff]">VetIOS gives us the truth.</span>
                    </p>
                    <div className="font-mono text-[#39ff14] text-sm uppercase tracking-widest font-bold">
                        — Hardy Veterinary, Karen, Nairobi
                    </div>
                </div>
            </section>

            {/* --- 8. THREE-TIER PRICING --- */}
            <section id="pricing" className="py-24 px-6 max-w-[1400px] mx-auto border-b border-white/5">
                <div className="text-center mb-16">
                    <h2 className="text-4xl md:text-5xl font-mono font-bold mb-4 text-white">Three Revenue Tiers. Three Compounding Moats.</h2>
                    <p className="text-gray-400 text-lg">Every tier has a different switching cost — and they compound with each other.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8 items-center">
                    {/* Tier 1 */}
                    <div className="bg-[#1a2332] border border-white/10 rounded-lg p-8 flex flex-col h-full hover:border-[#00e5ff]/30 transition-colors">
                        <h3 className="font-mono text-xl font-bold text-white mb-2">Independent Clinics</h3>
                        <div className="flex items-baseline gap-1 mb-6">
                            <span className="text-4xl font-bold text-white">$149</span>
                            <span className="text-gray-500 text-sm">/mo</span>
                        </div>
                        <ul className="space-y-4 mb-8 flex-1 text-sm text-gray-300 font-medium">
                            <li className="flex items-start gap-2"><Lock className="w-4 h-4 text-[#00e5ff] mt-0.5 shrink-0" /> Inference Console</li>
                            <li className="flex items-start gap-2"><Lock className="w-4 h-4 text-[#00e5ff] mt-0.5 shrink-0" /> Clinic Memory Engine</li>
                            <li className="flex items-start gap-2"><Lock className="w-4 h-4 text-[#00e5ff] mt-0.5 shrink-0" /> PetPass integration</li>
                            <li className="flex items-start gap-2"><Lock className="w-4 h-4 text-[#00e5ff] mt-0.5 shrink-0" /> Data Dividend credits</li>
                        </ul>
                        <div className="text-xs text-center text-gray-500 font-mono mb-4 border-t border-white/10 pt-4">&quot;3% monthly churn&quot;</div>
                        <Link href="/dashboard" className="w-full py-3 text-center border border-white/20 hover:bg-white hover:text-black rounded transition-colors font-bold tracking-wide">
                            Start free trial
                        </Link>
                    </div>

                    {/* Tier 2 (Highlighted) */}
                    <div className="bg-[#1a2332] border-2 border-[#00e5ff] rounded-lg p-8 flex flex-col h-[105%] relative shadow-[0_0_30px_rgba(0,229,255,0.15)] z-10 transform scale-100 md:scale-105">
                        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#00e5ff] text-[#0d1117] text-[10px] font-bold font-mono px-3 py-1 uppercase tracking-widest rounded-full">
                            Most Popular
                        </div>
                        <h3 className="font-mono text-xl font-bold text-[#00e5ff] mb-2">Research & Academic</h3>
                        <div className="flex items-baseline gap-1 mb-6">
                            <span className="text-4xl font-bold text-white">$1,000</span>
                            <span className="text-gray-500 text-sm">/mo</span>
                        </div>
                        <ul className="space-y-4 mb-8 flex-1 text-sm text-gray-300 font-medium">
                            <li className="flex items-start gap-2"><Lock className="w-4 h-4 text-[#39ff14] mt-0.5 shrink-0" /> Clinical Dataset</li>
                            <li className="flex items-start gap-2"><Lock className="w-4 h-4 text-[#39ff14] mt-0.5 shrink-0" /> Experiment Track</li>
                            <li className="flex items-start gap-2"><Lock className="w-4 h-4 text-[#39ff14] mt-0.5 shrink-0" /> Model Registry</li>
                            <li className="flex items-start gap-2"><Lock className="w-4 h-4 text-[#39ff14] mt-0.5 shrink-0" /> Full API Access</li>
                        </ul>
                        <div className="text-xs text-center text-[#39ff14] font-mono mb-4 border-t border-white/10 pt-4">&quot;~1% monthly churn&quot;</div>
                        <Link href="/contact" className="w-full py-3 text-center bg-[#00e5ff] text-[#0d1117] hover:bg-white rounded transition-colors font-bold tracking-wide">
                            Contact Us
                        </Link>
                    </div>

                    {/* Tier 3 */}
                    <div className="bg-[#1a2332] border border-white/10 rounded-lg p-8 flex flex-col h-full hover:border-[#00e5ff]/30 transition-colors">
                        <h3 className="font-mono text-xl font-bold text-white mb-2">Enterprise Chains</h3>
                        <div className="flex items-baseline gap-1 mb-6">
                            <span className="text-4xl font-bold text-white">$8,000+</span>
                            <span className="text-gray-500 text-sm">/mo</span>
                        </div>
                        <ul className="space-y-4 mb-8 flex-1 text-sm text-gray-300 font-medium">
                            <li className="flex items-start gap-2"><Lock className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" /> Chain-wide intelligence</li>
                            <li className="flex items-start gap-2"><Lock className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" /> Regulatory audit trails</li>
                            <li className="flex items-start gap-2"><Lock className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" /> Edge Box hardware</li>
                            <li className="flex items-start gap-2"><Lock className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" /> Dedicated support</li>
                        </ul>
                        <div className="text-xs text-center text-gray-500 font-mono mb-4 border-t border-white/10 pt-4">&quot;10% annual churn&quot;</div>
                        <Link href="/contact" className="w-full py-3 text-center border border-white/20 hover:bg-white hover:text-black rounded transition-colors font-bold tracking-wide">
                            Get a demo
                        </Link>
                    </div>
                </div>
            </section>

            {/* --- 9. SECURITY & COMPLIANCE --- */}
            <section className="py-24 px-6 max-w-[1400px] mx-auto border-b border-white/5">
                <div className="text-center mb-16">
                    <h2 className="text-3xl md:text-4xl font-mono font-bold mb-4 text-white">Built for clinical trust. Certified for regulatory confidence.</h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {[
                        { icon: Lock, title: "Federated Privacy", desc: "Patient data never leaves your clinic. Models update via secure edge gradients." },
                        { icon: FileText, title: "Append-only Audit Trail", desc: "Every inference logged, immutable, and cryptographically verified." },
                        { icon: ShieldCheck, title: "Kenya DVS Certification", desc: "Regulatory compliance built directly into the inference layer." },
                        { icon: Server, title: "Multi-tenant Isolation", desc: "Hardened DB-level row separation ensuring zero cross-clinic bleeding." },
                        { icon: Key, title: "Governance Middleware", desc: "Strict policy enforced asynchronously at every single inference call." },
                        { icon: FileCheck, title: "Public Model Cards", desc: "Fully auditable, heavily certified, fully transparent AI model snapshots." }
                    ].map((sec, i) => (
                        <div key={i} className="flex gap-4 p-4 border border-transparent hover:border-[#00e5ff]/10 hover:bg-white/[0.02] rounded transition-all">
                            <sec.icon className="w-8 h-8 text-[#00e5ff] shrink-0" />
                            <div>
                                <h4 className="font-bold text-white mb-1 font-mono text-sm">{sec.title}</h4>
                                <p className="text-sm text-gray-400">{sec.desc}</p>
                            </div>
                        </div>
                    ))}
                </div>
                
                <div className="mt-16 text-center text-xs font-mono text-gray-600 uppercase tracking-widest border border-gray-800 rounded bg-[#0d1117] py-2 px-4 shadow-sm inline-block mx-auto left-0 right-0 max-w-fit">
                    NVIDIA Inception Partner · vetios.tech · Nairobi, Kenya
                </div>
            </section>

            {/* --- 10. CLOSING CTA SECTION --- */}
            <section className="relative py-32 px-6 overflow-hidden flex flex-col items-center text-center">
                {/* Floating animated particles backdrop */}
                <div className="absolute inset-0 z-0 bg-[#00e5ff]/5" />
                <div className="absolute top-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#00e5ff]/50 to-transparent"></div>
                <div className="absolute bottom-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#39ff14]/50 to-transparent"></div>

                <div className="relative z-10 max-w-4xl">
                    <h2 className="text-5xl md:text-7xl font-mono font-bold mb-8 text-white tracking-tight">
                        The infrastructure layer all veterinary AI is built on.
                    </h2>
                    <p className="text-xl md:text-2xl text-gray-400 font-light mb-12 leading-relaxed">
                        When Cornell cites our dataset. When IVC Evidensia runs on our inference. When every vet in Africa trains on our platform — that is the endgame.
                    </p>
                    
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-6 mb-12">
                        <Link href="/dashboard" className="w-full sm:w-auto px-10 py-5 text-lg font-bold bg-[#00e5ff] text-[#0d1117] hover:bg-white rounded-sm transition-all shadow-[0_0_20px_rgba(0,229,255,0.4)]">
                            Start for free
                        </Link>
                        <Link href="/contact" className="w-full sm:w-auto px-10 py-5 text-lg font-medium border border-[#00e5ff] text-[#00e5ff] hover:bg-[#00e5ff]/10 rounded-sm transition-colors">
                            Book a demo
                        </Link>
                    </div>

                    <p className="font-mono text-xs text-gray-500 uppercase tracking-widest">
                        vetios.tech · Nairobi, Kenya · 2026 · NVIDIA Inception Partner
                    </p>
                </div>
            </section>

            {/* --- 11. FOOTER --- */}
            <footer className="w-full bg-[#09090b] pt-16 pb-8 px-6 border-t border-white/10 font-sans">
                <div className="max-w-[1400px] mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 mb-16">
                    <div>
                        <div className="flex items-center gap-2 mb-6">
                            <TerminalSquare className="w-5 h-5 text-[#00e5ff]" />
                            <span className="font-mono text-base font-bold text-white">VetIOS</span>
                        </div>
                        <p className="text-sm text-gray-500">The Clinical Intelligence Network.</p>
                    </div>
                    <div>
                        <h4 className="text-white font-bold mb-4 text-sm tracking-wide">Product</h4>
                        <ul className="space-y-3 text-sm text-gray-400">
                            <li><Link href="/" className="hover:text-[#00e5ff]">Inference Console</Link></li>
                            <li><Link href="/" className="hover:text-[#00e5ff]">Memory Engine</Link></li>
                            <li><Link href="/" className="hover:text-[#00e5ff]">Model Registry</Link></li>
                            <li><Link href="/" className="hover:text-[#00e5ff]">Pricing</Link></li>
                        </ul>
                    </div>
                    <div>
                        <h4 className="text-white font-bold mb-4 text-sm tracking-wide">Resources</h4>
                        <ul className="space-y-3 text-sm text-gray-400">
                            <li><Link href="/docs" className="hover:text-[#00e5ff]">Documentation</Link></li>
                            <li><Link href="/" className="hover:text-[#00e5ff]">Clinical Dataset</Link></li>
                            <li><Link href="/" className="hover:text-[#00e5ff]">API Reference</Link></li>
                            <li><Link href="/" className="hover:text-[#00e5ff]">Simulation Status</Link></li>
                        </ul>
                    </div>
                    <div>
                        <h4 className="text-white font-bold mb-4 text-sm tracking-wide">Company</h4>
                        <ul className="space-y-3 text-sm text-gray-400">
                            <li><Link href="/" className="hover:text-[#00e5ff]">About</Link></li>
                            <li><Link href="/" className="hover:text-[#00e5ff]">Blog</Link></li>
                            <li><Link href="/" className="hover:text-[#00e5ff]">Careers</Link></li>
                            <li><Link href="/" className="hover:text-[#00e5ff]">Contact</Link></li>
                        </ul>
                    </div>
                </div>
                
                <div className="max-w-[1400px] mx-auto border-t border-white/5 pt-8 flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-gray-500">
                    <div className="font-mono">© VetIOS 2026 · vetios.tech</div>
                    <div className="flex gap-6">
                        <Link href="/" className="hover:text-white">Privacy</Link>
                        <Link href="/" className="hover:text-white">Terms</Link>
                        <Link href="/" className="hover:text-white">Legal</Link>
                    </div>
                </div>
            </footer>
            
        </div>
    );
}
