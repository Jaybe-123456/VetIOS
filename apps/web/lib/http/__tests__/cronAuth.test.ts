import { afterEach, describe, expect, it, vi } from 'vitest';

import { authorizeCronRequest } from '../cronAuth';

const ORIGINAL_ENV = process.env;

function request(headers: Record<string, string> = {}) {
  return new Request('https://www.vetios.tech/api/cron/example', { headers });
}

describe('authorizeCronRequest', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('accepts the VETIOS_CRON_SECRET alias for direct manual cron runs', () => {
    process.env = {
      ...ORIGINAL_ENV,
      CRON_SECRET: '',
      VETIOS_CRON_SECRET: 'alias-secret',
      VETIOS_INTERNAL_API_TOKEN: '',
    };

    const result = authorizeCronRequest(
      request({ authorization: 'Bearer alias-secret' }),
      'global-ontology-ingestion',
    );

    expect(result).toEqual({
      authorized: true,
      reason: 'bearer_cron_secret',
      method: 'bearer_cron_secret',
    });
  });

  it('attributes current Vercel cron headers without bypassing bearer auth', () => {
    process.env = {
      ...ORIGINAL_ENV,
      CRON_SECRET: 'cron-secret',
      VETIOS_CRON_SECRET: '',
      VETIOS_INTERNAL_API_TOKEN: '',
    };

    const result = authorizeCronRequest(
      request({
        authorization: 'Bearer cron-secret',
        'x-vercel-cron-schedule': '35 3 * * *',
      }),
      'global-ontology-ingestion',
    );

    expect(result).toEqual({
      authorized: true,
      reason: 'vercel_cron',
      method: 'vercel_cron',
    });
  });

  it('rejects Vercel cron headers when the bearer token is missing', () => {
    process.env = {
      ...ORIGINAL_ENV,
      CRON_SECRET: 'cron-secret',
      VETIOS_CRON_SECRET: '',
      VETIOS_INTERNAL_API_TOKEN: '',
    };

    const result = authorizeCronRequest(
      request({ 'x-vercel-cron-schedule': '35 3 * * *' }),
      'global-ontology-ingestion',
    );

    expect(result.authorized).toBe(false);
    expect(result.reason).toBe('invalid_or_missing_token');
  });
});
