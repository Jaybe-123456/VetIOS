/** @type {import('next').NextConfig} */
function assertProductionSecurityEnvironment() {
    const isProductionDeployment = process.env.VERCEL_ENV === 'production';
    const devBypassEnabled = process.env.VETIOS_DEV_BYPASS === 'true'
        || process.env.NEXT_PUBLIC_VETIOS_DEV_BYPASS === 'true';

    if (isProductionDeployment && devBypassEnabled) {
        throw new Error('Refusing production build with VETIOS_DEV_BYPASS enabled.');
    }
}

assertProductionSecurityEnvironment();

const nextConfig = {
    transpilePackages: ['@vetios/cire-engine', '@vetios/inference-schema'],
    // ── Security Headers ──────────────────────────────────────────────────────
    async headers() {
        return [
            {
                source: '/(.*)',
                headers: [
                    {
                        key: 'X-Frame-Options',
                        value: 'DENY',
                    },
                    {
                        key: 'X-Content-Type-Options',
                        value: 'nosniff',
                    },
                    {
                        key: 'Referrer-Policy',
                        value: 'same-origin',
                    },
                    {
                        key: 'X-XSS-Protection',
                        value: '1; mode=block',
                    },
                    {
                        key: 'Strict-Transport-Security',
                        value: 'max-age=63072000; includeSubDomains; preload',
                    },
                    {
                        key: 'Permissions-Policy',
                        value: 'camera=(), microphone=(self), geolocation=()',
                    },
                    {
                        key: 'Content-Security-Policy',
                        value: [
                            "default-src 'self'",
                            "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://challenges.cloudflare.com",
                            "style-src 'self' 'unsafe-inline'",
                            "img-src 'self' data: blob: https:",
                            "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com",
                            "font-src 'self' https://fonts.gstatic.com",
                            "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://challenges.cloudflare.com",
                            "frame-ancestors 'none'",
                        ].join('; '),
                    },
                ],
            },
        ];
    },
};

module.exports = nextConfig;
