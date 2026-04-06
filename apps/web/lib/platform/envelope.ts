import { NextResponse } from 'next/server';
import type { PlatformApiError, PlatformEnvelope, PlatformEnvelopeMeta } from '@/lib/platform/types';

export const PLATFORM_API_VERSION = '2026-04-05';

export function buildPlatformEnvelope<T>(
    tenantId: string | null,
    data: T,
    error: PlatformApiError | null = null,
    meta: Partial<PlatformEnvelopeMeta> = {},
): PlatformEnvelope<T> {
    return {
        data,
        meta: {
            tenant_id: tenantId,
            timestamp: new Date().toISOString(),
            version: PLATFORM_API_VERSION,
            ...meta,
        },
        error,
    };
}

export function jsonOk<T>(
    tenantId: string | null,
    data: T,
    init: {
        status?: number;
        meta?: Partial<PlatformEnvelopeMeta>;
    } = {},
) {
    return NextResponse.json(
        buildPlatformEnvelope(tenantId, data, null, init.meta),
        { status: init.status ?? 200 },
    );
}

export function jsonError(
    tenantId: string | null,
    status: number,
    code: string,
    message: string,
    init: {
        data?: Record<string, unknown> | null;
        meta?: Partial<PlatformEnvelopeMeta>;
    } = {},
) {
    return NextResponse.json(
        buildPlatformEnvelope(tenantId, init.data ?? null, { code, message }, init.meta),
        { status },
    );
}
