import Link from 'next/link';
import { ClinicalCaseListClient } from '@/components/clinical/ClinicalCaseListClient';
import { ConsoleCard, Container, PageHeader, TerminalButton } from '@/components/ui/terminal';
import { listClinicalCases } from '@/lib/cases/caseWorkflow';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export default async function CasesPage() {
    const session = await resolveSessionTenant();
    if (!session) {
        return (
            <Container>
                <PageHeader title="Clinical Cases" description="Sign in to access clinician case entry." />
                <ConsoleCard title="Authentication Required">
                    <Link href="/login">
                        <TerminalButton type="button">Sign In</TerminalButton>
                    </Link>
                </ConsoleCard>
            </Container>
        );
    }

    const cases = await listClinicalCases(getSupabaseServer(), session.tenantId);

    return (
        <Container>
            <PageHeader
                title="My Cases"
                description="Review recent patients, open a case, or start a new diagnosis."
            />
            <ClinicalCaseListClient cases={cases} />
        </Container>
    );
}
