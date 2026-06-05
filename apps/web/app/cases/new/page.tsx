import Link from 'next/link';
import { ClinicalCaseEntryClient } from '@/components/clinical/ClinicalCaseEntryClient';
import { ConsoleCard, Container, PageHeader, TerminalButton } from '@/components/ui/terminal';
import { resolveSessionTenant } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export default async function NewCasePage({
    searchParams,
}: {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
    const session = await resolveSessionTenant();
    const params = await searchParams;
    const template = readSearchParam(params?.template);
    const firstCase = readSearchParam(params?.first_case);
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
                description="Run the first useful diagnosis with only species and clinical signs, then improve it with age, duration, labs, or voice."
            />
            <ClinicalCaseEntryClient firstCaseMode={firstCase === '1' || template === 'demo'} useDemoDraft={template === 'demo'} />
        </Container>
    );
}

function readSearchParam(value: string | string[] | undefined): string | null {
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
}
