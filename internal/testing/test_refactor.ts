import { runInferencePipeline } from '../../apps/web/lib/ai/inferenceOrchestrator';

async function runTests() {
    console.log("=== Running VetIOS Inference Pipeline Tests ===\n");

    const tests = [
        {
            name: "Test 1: GDV Emergency Override",
            input: "Dog, 8 years old, eating rocks, unproductive retching, abdominal distension, collapse."
        },
        {
            name: "Test 2: Contradictory Metadata (350 year old dog)",
            input: "Golden Retriever, 350 years old, normal checkup, no symptoms."
        },
        {
            name: "Test 3: Toxin Ingestion",
            input: "Cat, 2 years old, ate a lily plant 2 hours ago. Currently vomiting."
        },
        {
            name: "Test 4: Mild Infection",
            input: "Dog, 1 year old, coughing for 3 days, eating and drinking normally."
        }
    ];

    for (const t of tests) {
        console.log(`\n\n--- Running ${t.name} ---`);
        try {
            const res = await runInferencePipeline({
                model: 'gpt-4-turbo',
                rawInput: t.input,
                inputMode: 'freetext'
            });

            console.log("Normalized Input:", JSON.stringify(res.normalizedInput, null, 2));
            console.log("Contradiction Analysis:", JSON.stringify(res.contradiction_analysis, null, 2));
            
            const payload = res.output_payload as Record<string, unknown>;
            const diag = payload.diagnosis as Record<string, unknown>;
            const risk = payload.risk_assessment as Record<string, unknown>;

            console.log("\nDiagnosis Class:", diag?.primary_condition_class);
            console.log("Top Differential:", (diag?.top_differentials as any[])?.[0]?.name);
            console.log("Confidence Score:", diag?.confidence_score);
            
            console.log("\nSeverity Score:", risk?.severity_score);
            console.log("Emergency Level:", risk?.emergency_level);
            console.log("Rule Overrides:", payload.rule_overrides);
            console.log("Abstain Recommendation:", payload.abstain_recommendation);
        } catch (e) {
            console.error(`Error in test ${t.name}:`, e);
        }
    }
}

// To run this script:
// npx ts-node internal/testing/test_refactor.ts
runTests();
