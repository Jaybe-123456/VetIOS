import Link from 'next/link';
import { CaseDetailClient } from '@/components/cases/CaseDetailClient';
import { ConsoleCard, Container, PageHeader, TerminalButton } from '@/components/ui/terminal';
import { getClinicalCaseDetail } from '@/lib/cases/caseWorkflow';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export default async function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const session = await resolveSessionTenant();
    if (!session) {
        return (
            <Container>
                <PageHeader title="Clinical Case" description="Sign in to access this case." />
                <ConsoleCard title="Authentication Required">
                    <Link href="/login">
                        <TerminalButton type="button">Sign In</TerminalButton>
                    </Link>
                </ConsoleCard>
            </Container>
        );
    }

    const { id } = await params;
    const clinicalCase = await getClinicalCaseDetail(getSupabaseServer(), session.tenantId, id);
    if (!clinicalCase) {
        return (
            <Container>
                <PageHeader title="Clinical Case" description="The requested case was not found." />
                <ConsoleCard title="Not Found">
                    <Link href="/cases">
                        <TerminalButton type="button">Back To Cases</TerminalButton>
                    </Link>
                </ConsoleCard>
            </Container>
        );
    }

    return (
        <Container>
            <PageHeader
                title={clinicalCase.patient_name ?? 'Clinical Case'}
                description={clinicalCase.presenting_complaint ?? clinicalCase.symptom_summary ?? 'Case detail and outcome closure.'}
            />
            <CaseDetailClient clinicalCase={clinicalCase} />
        </Container>
    );
}
