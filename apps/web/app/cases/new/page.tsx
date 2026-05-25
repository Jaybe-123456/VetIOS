import Link from 'next/link';
import { ClinicalCaseEntryClient } from '@/components/clinical/ClinicalCaseEntryClient';
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
                title="New Case"
                description="Describe the patient in plain language and get ranked diagnoses."
            />
            <ClinicalCaseEntryClient />
        </Container>
    );
}
