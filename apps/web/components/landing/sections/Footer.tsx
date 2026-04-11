'use client';

import { footerLinks } from '../data';
import { BrandMark, FooterLink } from '../shared';

export default function Footer() {
    return (
        <footer className="border-t border-white/8 px-6 py-8 md:px-10 xl:px-20">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-3">
                    <BrandMark compact />
                    <div>
                        <div className="text-sm font-semibold tracking-[0.28em] text-white/55">VETIOS</div>
                        <div className="text-xs text-white/32">system layer for veterinary intelligence</div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-white/48">
                    {footerLinks.map((link) => (
                        <FooterLink key={link.label} {...link} />
                    ))}
                    <span>Platform Status: Controlled access</span>
                    <span>Build: V1.0 OMEGA</span>
                </div>
            </div>
        </footer>
    );
}
