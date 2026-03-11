# VetIOS Go-Live Checklist

## 48-Hour Pre-Launch

### T-48h: Environment Setup
- [ ] Set all Vercel env vars (see table below)
- [ ] Verify env vars load at runtime (check `/api/ml/predict` GET response)
- [ ] ML server deployed and accessible from Vercel (test `ML_SERVER_URL`)
- [ ] DNS/domain configured on Vercel

### T-24h: Validation
- [ ] `pnpm lint` passes (zero warnings)
- [ ] `pnpm typecheck` passes (zero errors)
- [ ] `pnpm build` succeeds on CI
- [ ] Run `scripts/load-test.sh` against preview deployment
- [ ] Run `scripts/shadow-mode.sh` with 10 cases
- [ ] Review shadow report (drift < 0.5, calibration error < 0.1)
- [ ] Check Supabase security advisor (0 issues)
- [ ] Check Supabase performance advisor (0 WARN)

### T-2h: Final Checks
- [ ] Rollback playbook reviewed by team
- [ ] Monitoring dashboards set up (Vercel Analytics enabled)
- [ ] Error tracking configured (Sentry DSN in env vars if available)
- [ ] On-call rotation set for first 72 hours

### T-0: Deploy
- [ ] Push to main → Vercel auto-deploys
- [ ] Verify production URL loads
- [ ] Verify `/api/inference` returns 401 without session (auth enforced)
- [ ] Verify `/api/ml/predict` GET returns ML server status
- [ ] Monitor error rate for first 30 minutes

### T+1h: Post-Deploy
- [ ] Check Vercel function logs for errors
- [ ] Check Supabase dashboard for failed queries
- [ ] Verify rate limiting works (run `scripts/load-test.sh` against prod)
- [ ] If issues: execute rollback playbook

---

## Vercel Environment Variables

| Variable | Value | Scope |
|----------|-------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://yluxqcbjtvnxtrvazrwn.supabase.co` | Production + Preview |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | *(from .env.local)* | Production + Preview |
| `SUPABASE_SERVICE_ROLE_KEY` | *(from .env.local)* | Production only |
| `AI_PROVIDER_API_KEY` | Your OpenAI key | Production only |
| `ML_SERVER_URL` | `https://vetios-production.up.railway.app` | Production only |
| ⚠️ `VETIOS_DEV_BYPASS` | **DO NOT SET** | — |

---

## Tenant Rollout Strategy

### Phase 1: Internal (Day 1)
- Deploy with `VETIOS_DEV_BYPASS=true` on preview branch
- Test with internal team accounts only
- Verify full flow: login → inference → outcome → evaluation

### Phase 2: Beta Tenants (Day 3-5)
- Enable production auth (no VETIOS_DEV_BYPASS)
- Onboard 2-3 beta clinics
- Monitor per-tenant error rates and latencies

### Phase 3: General Availability (Day 7+)
- Open signups
- Monitor drift scores and model confidence
- Have rollback playbook ready

---

## Monitoring Checklist

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Error rate (5xx) | < 1% | > 5% |
| Inference latency p95 | < 5s | > 10s |
| Rate limit hits (429) | < 10/min | > 50/min |
| Model confidence avg | > 0.6 | < 0.3 |
| Drift score | < 0.3 | > 0.5 |
| Auth failures (401) | < 5/min | > 20/min |
