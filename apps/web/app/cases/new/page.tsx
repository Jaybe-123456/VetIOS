import Link from 'next/link';
import { CaseIntakeClient } from '@/components/cases/CaseIntakeClient';
import { ConsoleCard, Container, PageHeader, TerminalButton } from '@/components/ui/terminal';
import { resolveSessionTenant } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export default async function NewCasePage() {
    const session = await resolveSessionTenant();
    if (!session) {
        return (
            <Container>
                <PageHeader title="New Clinical Case" description="Sign in to create a clinician case." />
                <ConsoleCard title="Authentication Required">
                    <Link href="/login">
                        <TerminalButton type="button">Sign In</TerminalButton>
                    </Link>
                </ConsoleCard>
            </Container>
        );
    }

    return (
        <Container>
            <PageHeader
                title="New Clinical Case"
                description="Capture signalment, complaint, exam findings, labs, and run VetIOS inference."
            />
            <CaseIntakeClient />
        </Container>
    );
}
