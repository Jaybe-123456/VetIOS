import { NextResponse } from 'next/server';
import { runInference } from '@/lib/ai/provider';
import { shouldUseAiHeuristicFallback } from '@/lib/ai/config';

export async function POST(req: Request) {
  try {
    const { message } = await req.json();
    const content = message.toLowerCase();

    // ── Real AI Inference (If not in bypass) ──
    if (!shouldUseAiHeuristicFallback()) {
        const inferenceResult = await runInference({
          input_signature: {
            raw_consultation: message,
            platform_context: "Ask VetIOS Assistant"
          }
        });

        const diagnosis = inferenceResult.output_payload.diagnosis as any;
        return NextResponse.json({
          content: diagnosis?.analysis || inferenceResult.raw_content,
          metadata: {
            diagnosis_ranked: diagnosis?.top_differentials || [],
            urgency_level: (inferenceResult.output_payload.risk_assessment as any)?.emergency_level?.toLowerCase() || "medium",
            recommended_tests: (inferenceResult.output_payload as any).recommended_tests || [],
            explanation: diagnosis?.ranking_shift_explanation || "Clinical analysis complete."
          }
        });
    }

    // Mock thinking delay
    await new Promise(resolve => setTimeout(resolve, 1500));

    let response = {
      content: "I've analyzed the information provided. Based on the clinical signs, here is my preliminary assessment.",
      metadata: {
        diagnosis_ranked: [
          { disease: "General Inflammatory Process", probability: 0.65 },
          { disease: "Infectious Agent (Unspecified)", probability: 0.25 }
        ],
        urgency_level: "medium",
        recommended_tests: ["Complete Blood Count (CBC)", "Diagnostic Ultrasound"],
        explanation: "The clinical presentation suggests an active systemic response. Further diagnostics are required to narrow the etiology."
      }
    };

    // Specific logic for common symptoms
    if (content.includes('vomit') || content.includes('lethargy') || content.includes('anorexia') || content.includes('appetite')) {
      response = {
        content: "The combination of gastrointestinal signs and systemic lethargy in a mature patient is clinically significant. Differential priority is shifted towards metabolic and obstructive etiologies.",
        metadata: {
          diagnosis_ranked: [
            { disease: "Acute Gastroenteritis", probability: 0.45 },
            { disease: "Pancreatitis", probability: 0.35 },
            { disease: "Foreign Body Obstruction", probability: 0.15 },
            { disease: "Chronic Kidney Disease (CKD)", probability: 0.05 }
          ],
          urgency_level: "medium",
          recommended_tests: ["Abdominal Radiographs", "Spec cPL / fPL Test", "Chemistry Panel", "Urinalysis"],
          explanation: "Acute onset of GI distress with lethargy requires immediate stabilization and imaging to rule out surgical emergencies like obstruction or GDV."
        }
      };
    }

    if (content.includes('pu/pd') || content.includes('drinking') || content.includes('urination')) {
        response = {
            content: "Polydipsia and polyuria (PU/PD) are hallmark signs of endocrine or renal dysfunction. Immediate evaluation of urine specific gravity is recommended.",
            metadata: {
                diagnosis_ranked: [
                    { disease: "Diabetes Mellitus", probability: 0.40 },
                    { disease: "Hyperadrenocorticism (Cushings)", probability: 0.30 },
                    { disease: "Chronic Kidney Disease", probability: 0.25 }
                ],
                urgency_level: "low",
                recommended_tests: ["Blood Glucose Curve", "ACTH Stim", "Urinalysis (SG & Sediment)"],
                explanation: "Endocrine signaling disruption is highly likely. We need to differentiate between pancreatic insulin production failure and adrenal hyper-secretion."
            }
        };
    }

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to process intelligence request' }, { status: 500 });
  }
}
