const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const url = 'http://127.0.0.1:54321';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const client = createClient(url, key);

async function run() {
    const { error } = await client.rpc('exec_sql', {
        query: `CREATE TABLE IF NOT EXISTS public.ai_inference_events (
            id uuid primary key default gen_random_uuid(),
            tenant_id text not null,
            clinic_id text,
            case_id text,
            model_name text not null,
            model_version text not null,
            input_signature jsonb not null,
            output_payload jsonb not null,
            confidence_score float not null,
            uncertainty_metrics jsonb,
            inference_latency_ms integer,
            created_at timestamp with time zone default timezone('utc'::text, now()) not null
        );`
    });

    if (error) {
        console.error("Migration failed via RPC:", error);
    } else {
        console.log("Migration executed successfully!");
    }
}

run();
