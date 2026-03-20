import { resolveRequestActor } from '@/lib/auth/requestActor';
import { resolveSessionTenant } from '@/lib/supabaseServer';

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface InternalApiActor {
    tenantId: string;
    userId: string | null;
    authMode: 'session' | 'internal_token';
}

export async function resolveExperimentApiActor(
    req: Request,
    options: {
        allowInternalToken?: boolean;
        tenantIdHint?: string | null;
        userIdHint?: string | null;
    } = {},
): Promise<InternalApiActor | null> {
    const session = await resolveSessionTenant();
    if (session) {
        const actor = resolveRequestActor(session);
        return {
            tenantId: actor.tenantId,
            userId: actor.userId,
            authMode: 'session',
        };
    }

    if (!options.allowInternalToken) {
        return null;
    }

    const configuredToken = process.env.VETIOS_INTERNAL_API_TOKEN?.trim();
    if (!configuredToken) {
        return null;
    }

    const authorization = req.headers.get('authorization');
    const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
    if (!bearer || bearer !== configuredToken) {
        return null;
    }

    const tenantId = normalizeUuid(
        req.headers.get('x-vetios-tenant-id') ??
        options.tenantIdHint ??
        null,
    );
    if (!tenantId) {
        return null;
    }

    return {
        tenantId,
        userId: normalizeUuid(req.headers.get('x-vetios-user-id') ?? options.userIdHint ?? null),
        authMode: 'internal_token',
    };
}

function normalizeUuid(value: string | null): string | null {
    if (!value) return null;
    const normalized = value.trim().toLowerCase();
    return UUID_PATTERN.test(normalized) ? normalized : null;
}
