import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../password-reset-complete/route';

const mocks = vi.hoisted(() => ({
    getSupabaseServer: vi.fn(),
    resolveSessionTenant: vi.fn(),
}));

vi.mock('@/lib/supabaseServer', () => ({
    getSupabaseServer: mocks.getSupabaseServer,
    resolveSessionTenant: mocks.resolveSessionTenant,
}));

describe('password reset completion route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('rejects unauthenticated requests', async () => {
        mocks.resolveSessionTenant.mockResolvedValue(null);

        const response = await POST(new Request('http://localhost/api/auth/password-reset-complete', {
            method: 'POST',
        }));
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body.error).toBe('Unauthorized');
    });

    it('records password change metadata for the current user', async () => {
        const updateUserById = vi.fn().mockResolvedValue({ data: { user: { id: 'user_1' } }, error: null });
        mocks.resolveSessionTenant.mockResolvedValue({
            userId: 'user_1',
            tenantId: 'user_1',
            email: 'clinician@example.test',
            supabase: {
                auth: {
                    getUser: vi.fn().mockResolvedValue({
                        data: {
                            user: {
                                id: 'user_1',
                                app_metadata: { existing: true },
                            },
                        },
                        error: null,
                    }),
                },
            },
        });
        mocks.getSupabaseServer.mockReturnValue({
            auth: {
                admin: {
                    updateUserById,
                },
            },
        });

        const response = await POST(new Request('http://localhost/api/auth/password-reset-complete', {
            method: 'POST',
        }));
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(updateUserById).toHaveBeenCalledWith('user_1', {
            app_metadata: expect.objectContaining({
                existing: true,
                password_changed_at: expect.any(String),
                session_revocation_reason: 'password_reset',
            }),
        });
        expect(response.headers.get('cache-control')).toContain('no-store');
    });
});
