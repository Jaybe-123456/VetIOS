/**
 * PATCH: Add this at the TOP of your POST handler in apps/web/app/api/inference/route.ts
 * This intercepts errors and provides detailed debugging info
 */

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    console.log(`[${requestId}] ✅ Inference POST request received`);

    const supabase = getSupabaseServer();
    let actor: PlatformActor;
    let tenantId: string | null;

    // ✅ STEP 1: Validate platform context
    try {
        console.log(`[${requestId}] → Checking platform context...`);
        const context = await requirePlatformRequestContext(req, supabase, {
            requiredScopes: ['inference:write'],
            rateLimitKind: 'inference',
        });
        actor = context.actor;
        tenantId = context.tenantId;
        console.log(`[${requestId}] ✓ Platform context OK (tenant: ${tenantId})`);
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[${requestId}] ✗ Platform context failed:`, errorMsg);

        if (error instanceof PlatformRateLimitError) {
            return NextResponse.json(
                buildRateLimitErrorPayload(error),
                { status: error.status },
            );
        }

        return NextResponse.json(
            { 
                error: `Auth failed: ${errorMsg}`,
                request_id: requestId,
                debug: {
                    step: 'platform_context',
                    error_type: error?.constructor?.name,
                }
            },
            { status: error instanceof PlatformAuthError ? error.status : 401 },
        );
    }

    if (!tenantId) {
        console.warn(`[${requestId}] ✗ No tenant ID found`);
        return NextResponse.json(
            { error: 'tenant_id is required for inference requests.', request_id: requestId },
            { status: 400 },
        );
    }

    const userId = actor.userId;

    // ✅ STEP 2: Parse request body
    console.log(`[${requestId}] → Parsing request body...`);
    const parsed = await safeJson(req);
    if (!parsed.ok) {
        console.error(`[${requestId}] ✗ Body parsing failed:`, parsed.error);
        return NextResponse.json(
            { error: parsed.error, request_id: requestId, debug: { step: 'body_parse' } },
            { status: 400 },
        );
    }

    const rawBody = parsed.data as Record<string, unknown>;
    console.log(`[${requestId}] ✓ Body parsed:`, JSON.stringify(rawBody).substring(0, 200));

    // ✅ STEP 3: Normalize input
    console.log(`[${requestId}] → Normalizing input...`);
    if (rawBody.input && typeof rawBody.input === 'object') {
        const inp = rawBody.input as Record<string, unknown>;
        if (typeof inp.input_signature === 'string') {
            inp.input_signature = {
                species: null,
                breed: null,
                symptoms: [],
                metadata: { raw_note: inp.input_signature },
            };
        }
        if (inp.input_signature && typeof inp.input_signature === 'object') {
            const sig = inp.input_signature as Record<string, unknown>;
            if (typeof sig.symptoms === 'string') {
                sig.symptoms = (sig.symptoms as string)
                    .split(/[,;]/)
                    .map((entry: string) => entry.trim())
                    .filter(Boolean);
            }
            if (!sig.metadata || typeof sig.metadata !== 'object') {
                sig.metadata = {};
            }
        }
    }
    console.log(`[${requestId}] ✓ Input normalized`);

    // ✅ STEP 4: Validate schema
    console.log(`[${requestId}] → Validating schema...`);
    const result = InferenceRequestSchema.safeParse(rawBody);
    if (!result.success) {
        console.error(`[${requestId}] ✗ Schema validation failed:`, result.error);
        return NextResponse.json(
            { 
                error: formatZodErrors(result.error), 
                request_id: requestId,
                debug: { step: 'schema_validation' }
            },
            { status: 400 },
        );
    }
    console.log(`[${requestId}] ✓ Schema valid`);

    const body = result.data;

    // ✅ STEP 5: Governance check
    console.log(`[${requestId}] → Checking governance policy...`);
    let governanceDecision;
    try {
        governanceDecision = await evaluateGovernancePolicyForInference(supabase, {
            actor,
            tenantId,
            requestBody: rawBody,
        });
        console.log(`[${requestId}] ✓ Governance decision: ${governanceDecision.decision}`);
    } catch (error) {
        console.error(`[${requestId}] ✗ Governance check failed:`, error);
        return NextResponse.json(
            { 
                error: 'Governance check failed', 
                request_id: requestId,
                debug: { step: 'governance', error: error instanceof Error ? error.message : String(error) }
            },
            { status: 500 },
        );
    }

    if (governanceDecision.decision === 'block') {
        console.warn(`[${requestId}] ⚠ Inference blocked by governance`);
        return NextResponse.json(
            {
                blocked: true,
                reason: governanceDecision.reason,
                policy_id: governanceDecision.policyId,
                request_id: requestId,
            },
            { status: 403 },
        );
    }

    let routingPlan: Awaited<ReturnType<typeof planModelRoute>> | null = null;

    try {
        // ✅ STEP 6: Plan routing
        console.log(`[${requestId}] → Planning model route...`);
        routingPlan = await planModelRoute({
            client: supabase,
            tenantId,
            requestedModelName: body.model.name,
            requestedModelVersion: body.model.version,
            inputSignature: body.input.input_signature,
            caseId: body.case_id ?? null,
        });
        console.log(`[${requestId}] ✓ Route planned: ${routingPlan.selected_model_id}`);

        // ✅ STEP 7: Execute inference
        console.log(`[${requestId}] → Executing inference pipeline...`);
        await createRoutingDecisionRecord(supabase, routingPlan, {
            caseId: body.case_id ?? null,
        });

        const executionSample = beginTelemetryExecutionSample();
        const routingExecution = await Promise.race([
            executeRoutingPlan({
                plan: routingPlan,
                executor: async (profile) => {
                    console.log(`[${requestId}] → Running inference with model: ${profile.provider_model}`);
                    return await runInferencePipeline({
                        model: profile.provider_model,
                        rawInput: body.input,
                        inputMode: 'json',
                    });
                },
            }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('AI_TIMEOUT')), AI_TIMEOUT_MS),
            ),
        ]);

        console.log(`[${requestId}] ✓ Inference completed`);

        // ... REST OF YOUR EXISTING CODE ...
        // (Keep all the existing logic after this point)

        const inferenceResult = routingExecution.routed_output;
        // ... continue with rest of handler ...

    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[${requestId}] ✗ INFERENCE FAILED:`, {
            error: errorMsg,
            stack: err instanceof Error ? err.stack : undefined,
            stage: 'inference_execution',
        });

        if (routingPlan) {
            try {
                await failRoutingDecisionRecord(
                    supabase,
                    routingPlan.routing_decision_id,
                    errorMsg,
                );
            } catch (routingErr) {
                console.error(`[${requestId}] Failed to mark routing as failed:`, routingErr);
            }
        }

        if (err instanceof Error && err.message === 'AI_TIMEOUT') {
            return NextResponse.json(
                { 
                    error: 'AI inference timed out (50s)',
                    request_id: requestId,
                    debug: { stage: 'timeout' }
                },
                { status: 504 },
            );
        }

        // ✅ DETAILED ERROR RESPONSE
        return NextResponse.json(
            { 
                error: errorMsg,
                request_id: requestId,
                debug: {
                    error_type: err?.constructor?.name,
                    full_error: process.env.NODE_ENV === 'development' ? errorMsg : undefined,
                }
            },
            { status: 500 },
        );
    }
}