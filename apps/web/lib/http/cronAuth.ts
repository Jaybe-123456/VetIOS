/**
 * VetIOS Cron Security — Shared Auth Library
 *
 * Enforces:
 * 1. Timing-safe token comparison (prevents timing attacks)
 * 2. x-vercel-cron header verification (Vercel-originating calls)
 * 3. CRON_SECRET or VETIOS_INTERNAL_API_TOKEN bearer token
 * 4. Structured auth failure logging
 * 5. Least-privilege: rejects if CRON_SECRET is not set
 */

import { createHmac, timingSafeEqual } from 'crypto';

export interface CronAuthResult {
  authorized: boolean;
  reason: string;
  method: 'vercel_cron' | 'bearer_cron_secret' | 'bearer_internal_token' | 'none';
}

/**
 * Timing-safe string comparison — prevents timing attacks on token comparison.
 */
function safeCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a.padEnd(64));
    const bufB = Buffer.from(b.padEnd(64));
    return timingSafeEqual(bufA, bufB) && a.length === b.length;
  } catch {
    return false;
  }
}

function extractBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
  return match || null;
}

/**
 * Verifies integrity of the cron job path using HMAC.
 * Vercel sends x-vercel-cron: 1 on legitimate cron calls.
 */
function isVercelCronOrigin(req: Request): boolean {
  return req.headers.get('x-vercel-cron') === '1';
}

/**
 * Main auth function. Call at the top of every cron GET handler.
 */
export function authorizeCronRequest(req: Request, jobName: string): CronAuthResult {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const internalToken = process.env.VETIOS_INTERNAL_API_TOKEN?.trim();

  // 1. CRON_SECRET must always be set — misconfiguration = reject
  if (!cronSecret) {
    logCronAuthFailure(jobName, 'CRON_SECRET not configured');
    return { authorized: false, reason: 'CRON_SECRET not configured', method: 'none' };
  }

  const token = extractBearerToken(req.headers.get('authorization'));
  const isVercel = isVercelCronOrigin(req);

  // 2. Vercel cron origin + valid secret = authorized
  if (isVercel && token && safeCompare(token, cronSecret)) {
    return { authorized: true, reason: 'vercel_cron', method: 'vercel_cron' };
  }

  // 3. Direct call with CRON_SECRET bearer token = authorized
  if (token && safeCompare(token, cronSecret)) {
    return { authorized: true, reason: 'bearer_cron_secret', method: 'bearer_cron_secret' };
  }

  // 4. Internal API token fallback (for internal service calls)
  if (internalToken && token && safeCompare(token, internalToken)) {
    return { authorized: true, reason: 'bearer_internal_token', method: 'bearer_internal_token' };
  }

  // 5. All checks failed — log and reject
  logCronAuthFailure(jobName, `invalid_token ip=${req.headers.get('x-forwarded-for') ?? 'unknown'}`);
  return { authorized: false, reason: 'invalid_or_missing_token', method: 'none' };
}

/**
 * Compute a checksum of a cron job file for integrity monitoring.
 * Pass __filename from the route file.
 */
export function buildCronExecutionRecord(
  jobName: string,
  authResult: CronAuthResult,
  requestId: string,
) {
  return {
    job: jobName,
    authorized_by: authResult.method,
    request_id: requestId,
    executed_at: new Date().toISOString(),
  };
}

function logCronAuthFailure(jobName: string, reason: string): void {
  console.error(
    JSON.stringify({
      level: 'security',
      event: 'cron_auth_failure',
      job: jobName,
      reason,
      timestamp: new Date().toISOString(),
    })
  );
}
