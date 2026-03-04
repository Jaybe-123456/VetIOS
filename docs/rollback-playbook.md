# VetIOS Rollback Playbook

## Quick Reference

| Scenario | Action | Time |
|----------|--------|------|
| Bad Vercel deploy | Revert to previous deployment in Vercel dashboard | 30s |
| Bad DB migration | Run rollback SQL below | 2 min |
| ML model regression | Switch `ML_SERVER_URL` to previous container | 1 min |
| Auth/RLS issue | Enable `VETIOS_DEV_BYPASS=true` in Vercel env vars (temporary) | 1 min |

---

## 1. Vercel Web App Rollback

```bash
# Option A: Instant rollback via Vercel dashboard
# → Project → Deployments → select previous deployment → Promote to Production

# Option B: Git revert
git revert HEAD --no-edit
git push origin main
# Vercel auto-deploys from main
```

## 2. Database Migration Rollback

### Check current migrations
```sql
SELECT version, name FROM supabase_migrations.schema_migrations
ORDER BY version DESC LIMIT 10;
```

### Rollback: RLS performance fix
```sql
-- Undo (select auth.uid()) → revert to auth.uid()
DROP POLICY IF EXISTS tenant_isolation_on_clinical_outcome_events ON public.clinical_outcome_events;
CREATE POLICY tenant_isolation_on_clinical_outcome_events ON public.clinical_outcome_events
    FOR ALL USING (tenant_id = auth.uid());

DROP POLICY IF EXISTS tenant_isolation_on_edge_simulation_events ON public.edge_simulation_events;
CREATE POLICY tenant_isolation_on_edge_simulation_events ON public.edge_simulation_events
    FOR ALL USING (
        COALESCE(
            (SELECT aie.tenant_id FROM public.ai_inference_events aie WHERE aie.id = triggered_inference_id),
            NULL::uuid
        ) = auth.uid()
    );

DROP POLICY IF EXISTS tenant_isolation_on_network_intelligence_metrics ON public.network_intelligence_metrics;
CREATE POLICY tenant_isolation_on_network_intelligence_metrics ON public.network_intelligence_metrics
    FOR ALL USING (metric_scope = auth.uid()::text);
```

### Rollback: Duplicate index removal
```sql
-- Re-create dropped indexes if needed
CREATE INDEX IF NOT EXISTS ai_inference_events_case_idx ON public.ai_inference_events(case_id);
CREATE INDEX IF NOT EXISTS ai_inference_events_clinic_created_at_idx ON public.ai_inference_events(clinic_id, created_at);
CREATE INDEX IF NOT EXISTS ai_inference_events_model_idx ON public.ai_inference_events(model_name, model_version);
CREATE INDEX IF NOT EXISTS ai_inference_events_tenant_created_at_idx ON public.ai_inference_events(tenant_id, created_at);
```

## 3. ML Server Rollback

```bash
# If using Docker/Cloud Run, roll back to previous image tag
docker pull ghcr.io/your-org/vetios-ml:previous-tag
docker run -d -p 8000:8000 ghcr.io/your-org/vetios-ml:previous-tag

# Update ML_SERVER_URL in Vercel to point to previous version
# Vercel Dashboard → Settings → Environment Variables → ML_SERVER_URL
```

## 4. Emergency Procedures

### Complete system frozen
```bash
# 1. Pause the Vercel deployment (stops serving traffic)
# 2. Set maintenance mode:
#    Add MAINTENANCE_MODE=true to Vercel env vars
# 3. Investigate logs:
#    Vercel Dashboard → Logs → filter by error
#    Supabase Dashboard → Database → Logs
```

### Data integrity issue
```bash
# 1. NEVER delete production data
# 2. Create a backup first:
#    Supabase Dashboard → Database → Backups → Create backup
# 3. Fix data with targeted UPDATE statements
# 4. Document the fix in a post-mortem
```

---

## Rollback Decision Matrix

| Signal | Severity | Auto-rollback? | Contact |
|--------|----------|----------------|---------|
| Build failure | P0 | Yes (CI blocks) | — |
| 5xx error rate > 5% | P0 | Manual | On-call eng |
| Auth bypass detected | P0 | Manual + rotate keys | Security lead |
| Model confidence < 0.3 avg | P1 | Manual (ML) | ML eng |
| Drift score > 0.5 | P1 | Manual (ML) | ML eng |
| Slow queries > 5s | P2 | No | DBA |
