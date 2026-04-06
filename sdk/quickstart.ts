import { VetiosClient } from './client';

const client = new VetiosClient({ baseUrl: 'https://app.vetios.ai', apiKey: 'YOUR_API_KEY', tenantId: 'tenant_123' });
const inference = await client.inference.create({ model: { name: 'gpt-4o-mini', version: 'gpt-4o-mini' }, input: { input_signature: { species: 'canine', symptoms: ['vomiting', 'lethargy'], metadata: { raw_note: 'Dog vomiting for 12h' } } } });
if (!('inference_event_id' in inference)) throw new Error('Inference did not complete successfully.');
const evaluation = await client.evaluation.create({ inference_event_id: inference.inference_event_id, model_name: 'gpt-4o-mini', model_version: 'gpt-4o-mini' });
const outcome = await client.outcome.create({ inference_event_id: inference.inference_event_id, outcome: { type: 'clinical_diagnosis', payload: { actual_diagnosis: 'pancreatitis' }, timestamp: new Date().toISOString() } });
const rateLimits = await client.rateLimits.get();
console.log(inference.inference_event_id);
console.log(evaluation.data);
console.log(outcome.outcome_event_id, rateLimits.data.simulate_requests_per_minute);
