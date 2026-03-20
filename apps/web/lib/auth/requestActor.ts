const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SessionActorContext {
    tenantId: string;
    userId: string;
}

export interface RequestActor {
    tenantId: string;
    userId: string | null;
}

export function resolveRequestActor(session: SessionActorContext | null): RequestActor {
    const tenantId = session?.tenantId || process.env.VETIOS_DEV_TENANT_ID || 'dev_tenant_001';
    const candidateUserId = session?.userId || process.env.VETIOS_DEV_USER_ID || tenantId;

    return {
        tenantId,
        userId: UUID_PATTERN.test(candidateUserId) ? candidateUserId.toLowerCase() : null,
    };
}
