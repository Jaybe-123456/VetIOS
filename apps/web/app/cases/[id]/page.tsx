import Link from 'next/link';
import { ClinicalCaseDetailClient } from '@/components/clinical/ClinicalCaseDetailClient';
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
    let clinicalCase: Awaited<ReturnType<typeof getClinicalCaseDetail>>;
    try {
        clinicalCase = await getClinicalCaseDetail(getSupabaseServer(), session.tenantId, id);
    } catch {
        return (
            <Container>
                <PageHeader title="Clinical Case" description="We couldn't load this case right now." />
                <ConsoleCard title="Case Unavailable">
                    <div className="space-y-4 text-sm text-[hsl(0_0%_72%)]">
                        <p>Reload the page in a moment. If it still does not load, open My Cases and try the case again.</p>
                        <Link href="/cases">
                            <TerminalButton type="button">Back To Cases</TerminalButton>
                        </Link>
                    </div>
                </ConsoleCard>
            </Container>
        );
    }

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
                description={clinicalCase.presenting_complaint ?? clinicalCase.symptom_summary ?? 'Diagnosis results and confirmation.'}
            />
            <ClinicalCaseDetailClient clinicalCase={clinicalCase} />
        </Container>
    );
}
