import type { Metadata } from 'next';
import { PetPassInviteClient } from '@/components/petpass/PetPassInviteClient';

export const metadata: Metadata = {
    title: 'PetPass Invite',
    description: 'Accept a VetIOS PetPass clinic invitation.',
};

export const dynamic = 'force-dynamic';

export default async function PetPassInvitePage({
    searchParams,
}: {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
    const params = await searchParams;
    const token = readSearchParam(params?.token);

    return <PetPassInviteClient token={token} />;
}

function readSearchParam(value: string | string[] | undefined): string | null {
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
}
