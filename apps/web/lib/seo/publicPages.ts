export const PUBLIC_SEO_PAGES = [
    {
        path: '/',
        title: 'VetIOS | AI-Native Veterinary Intelligence Infrastructure',
        description: 'Closed-loop veterinary AI infrastructure for inference, outcome learning, simulation, observability, and quantum-ready clinical intelligence.',
        priority: 1,
    },
    {
        path: '/about',
        title: 'About VetIOS',
        description: 'Learn what VetIOS is: AI-native veterinary intelligence infrastructure for inference, outcomes, graph intelligence, simulation, and AMR research.',
        priority: 0.92,
    },
    {
        path: '/veterinary-ai',
        title: 'Veterinary AI Platform',
        description: 'VetIOS is veterinary AI infrastructure for clinical inference, outcome learning, simulation, and auditable decision support.',
        priority: 0.95,
    },
    {
        path: '/veterinary-diagnostic-ai',
        title: 'Veterinary Diagnostic AI',
        description: 'AI-assisted veterinary differential diagnosis with structured inputs, graph priors, CIRE reliability signals, and outcome feedback.',
        priority: 0.94,
    },
    {
        path: '/quantum-veterinary-ai',
        title: 'Quantum Veterinary AI',
        description: 'Quantum-ready veterinary intelligence using Gaussian boson sampling for graph ranking, QIVS screening, and AMR RNA folding research.',
        priority: 0.9,
    },
    {
        path: '/platform',
        title: 'VetIOS Platform',
        description: 'Platform overview for veterinary inference, outcomes, simulation, graph intelligence, and quantum-ready infrastructure.',
        priority: 0.88,
    },
    {
        path: '/docs',
        title: 'VetIOS Documentation',
        description: 'API reference and platform documentation for VetIOS veterinary AI infrastructure.',
        priority: 0.82,
    },
    {
        path: '/demo',
        title: 'VetIOS Demo',
        description: 'Try a VetIOS veterinary diagnosis demo case without creating an account.',
        priority: 0.78,
    },
    {
        path: '/support',
        title: 'VetIOS Support',
        description: 'Support and contact information for VetIOS platform operators and integration partners.',
        priority: 0.65,
    },
    {
        path: '/contact',
        title: 'Contact VetIOS',
        description: 'Contact VetIOS for platform access, veterinary AI partnerships, security reports, and integrations.',
        priority: 0.65,
    },
    {
        path: '/privacy',
        title: 'VetIOS Privacy Policy',
        description: 'Privacy policy for VetIOS veterinary clinical intelligence infrastructure.',
        priority: 0.45,
    },
    {
        path: '/terms',
        title: 'VetIOS Terms',
        description: 'Terms of service for VetIOS veterinary intelligence infrastructure.',
        priority: 0.45,
    },
] as const;

export const PUBLIC_SEO_PATHS = PUBLIC_SEO_PAGES.map((page) => page.path);
