'use client';

import { useEffect, useState } from 'react';
import TopNav from './TopNav';
import HeroSection from './sections/HeroSection';
import ArchitectureSection from './sections/ArchitectureSection';
import ModulesSection from './sections/ModulesSection';
import FlywheelSection from './sections/FlywheelSection';
import GlobalNetworkSection from './sections/GlobalNetworkSection';
import InterfacePreviewSection from './sections/InterfacePreviewSection';
import DeveloperInfraSection from './sections/DeveloperInfraSection';
import TechStackSection from './sections/TechStackSection';
import FinalCTASection from './sections/FinalCTASection';
import TrainingSection from './TrainingSection';
import Footer from './sections/Footer';

export default function LandingPage() {
    const [menuOpen, setMenuOpen] = useState(false);
    const [scrolled, setScrolled] = useState(false);

    useEffect(() => {
        const scrollElement = document.querySelector<HTMLElement>('[data-shellless-scroll="true"]');
        const handleScroll = () => {
            const scrollTop = scrollElement?.scrollTop ?? window.scrollY;
            setScrolled(scrollTop > 24);
        };

        handleScroll();
        scrollElement?.addEventListener('scroll', handleScroll, { passive: true });
        window.addEventListener('scroll', handleScroll, { passive: true });

        return () => {
            scrollElement?.removeEventListener('scroll', handleScroll);
            window.removeEventListener('scroll', handleScroll);
        };
    }, []);

    useEffect(() => {
        const previousOverflow = document.documentElement.style.overflow;
        if (menuOpen) {
            document.documentElement.style.overflow = 'hidden';
        }

        return () => {
            document.documentElement.style.overflow = previousOverflow;
        };
    }, [menuOpen]);

    return (
        <div className="relative min-h-full overflow-x-clip bg-[#0B0F14] text-[#E8EDF2]">
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(21,230,195,0.14),transparent_30%),radial-gradient(circle_at_80%_12%,rgba(124,255,78,0.12),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.04),transparent_45%)]" />
                <div className="landing-grid absolute inset-0 opacity-[0.08]" />
                <div className="absolute left-1/2 top-0 h-[640px] w-[640px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(22,250,201,0.12),transparent_65%)] blur-3xl" />
            </div>

            <TopNav
                menuOpen={menuOpen}
                scrolled={scrolled}
                onCloseMenu={() => setMenuOpen(false)}
                onOpenMenu={() => setMenuOpen(true)}
            />

            <main className="relative z-10">
                <HeroSection />
                <ArchitectureSection />
                <ModulesSection />
                <FlywheelSection />
                <TrainingSection />
                <GlobalNetworkSection />
                <InterfacePreviewSection />
                <DeveloperInfraSection />
                <TechStackSection />
                <FinalCTASection />
                <Footer />
            </main>
        </div>
    );
}
