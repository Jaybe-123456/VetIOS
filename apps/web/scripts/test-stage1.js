/**
 * VetIOS Stage 1 Local Test Suite (v2 - with timeouts)
 */

const http = require('http');

const TESTS = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
    TESTS.push({ name, fn });
}

async function httpRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            req.destroy();
            reject(new Error('Request timed out (5s)'));
        }, 5000);

        const parsed = new URL(url);
        const opts = {
            hostname: parsed.hostname,
            port: parsed.port,
            path: parsed.pathname + parsed.search,
            method: options.method || 'GET',
            headers: options.headers || {},
        };

        const req = http.request(opts, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                clearTimeout(timeout);
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body,
                    json: () => { try { return JSON.parse(body); } catch { return null; } },
                });
            });
        });
        req.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
        if (options.body) req.write(options.body);
        req.end();
    });
}

// ── Test 1: Root redirects to /login ─────────────────────────────────────
test('Root (/) redirects to /login', async () => {
    const res = await httpRequest('http://localhost:3000/');
    if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.location || '';
        if (loc.includes('/login')) return `PASS: ${res.status} -> ${loc}`;
        return `FAIL: Redirect to wrong location: ${loc}`;
    }
    // Next.js may internally redirect and serve the login page content at root
    if (res.status === 200 && res.body.includes('login')) return 'PASS: Served login content at root';
    return `FAIL: Got ${res.status}`;
});

// ── Test 2: API inference 401 ────────────────────────────────────────────
test('POST /api/inference returns 401', async () => {
    const res = await httpRequest('http://localhost:3000/api/inference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: { name: 'test', version: '1.0' }, input: { input_signature: {} } }),
    });
    if (res.status === 401) return `PASS: 401 ${res.body.substring(0, 60)}`;
    return `FAIL: Got ${res.status}: ${res.body.substring(0, 100)}`;
});

// ── Test 3: API outcome 401 ──────────────────────────────────────────────
test('POST /api/outcome returns 401', async () => {
    const res = await httpRequest('http://localhost:3000/api/outcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inference_event_id: 'x', outcome: { type: 'test', payload: {}, timestamp: new Date().toISOString() } }),
    });
    if (res.status === 401) return `PASS: 401`;
    return `FAIL: Got ${res.status}`;
});

// ── Test 4: API simulate 401 ─────────────────────────────────────────────
test('POST /api/simulate returns 401', async () => {
    const res = await httpRequest('http://localhost:3000/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simulation: { type: 'test', parameters: {} }, inference: { model: 'test', input_signature: {} } }),
    });
    if (res.status === 401) return `PASS: 401`;
    return `FAIL: Got ${res.status}`;
});

// ── Test 5: API evaluation 401 ───────────────────────────────────────────
test('GET /api/evaluation returns 401', async () => {
    const res = await httpRequest('http://localhost:3000/api/evaluation');
    if (res.status === 401) return `PASS: 401`;
    return `FAIL: Got ${res.status}`;
});

// ── Test 6: DB table: ai_inference_events ────────────────────────────────
test('DB: ai_inference_events table', async () => {
    const svcKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
    const res = await httpRequest('http://127.0.0.1:54321/rest/v1/ai_inference_events?select=id&limit=0', {
        headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}` },
    });
    if (res.status === 200) return 'PASS: table exists';
    return `FAIL: ${res.status} ${res.body.substring(0, 100)}`;
});

// ── Test 7: DB table: model_evaluation_events ────────────────────────────
test('DB: model_evaluation_events table', async () => {
    const svcKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
    const res = await httpRequest('http://127.0.0.1:54321/rest/v1/model_evaluation_events?select=id&limit=0', {
        headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}` },
    });
    if (res.status === 200) return 'PASS: table exists';
    return `FAIL: ${res.status} ${res.body.substring(0, 100)}`;
});

// ── Test 8: DB RLS: anon key cannot read data ────────────────────────────
test('RLS: anon key gets empty result (no auth.uid)', async () => {
    const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WO_o0BQBhMLL6sQ_z3ERdQGn6moUib9RoJhs';
    const res = await httpRequest('http://127.0.0.1:54321/rest/v1/ai_inference_events?select=id', {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
    if (res.status === 401) return 'PASS: anon gets 401 (RLS + no auth.uid blocks access entirely)';
    if (res.status === 200) {
        const data = JSON.parse(res.body);
        if (Array.isArray(data) && data.length === 0) return 'PASS: anon gets empty array (RLS blocks)';
        return `FAIL: anon got ${data.length} rows (RLS leak!)`;
    }
    return `FAIL: unexpected ${res.status}`;
});

// ── Run ──────────────────────────────────────────────────────────────────
async function run() {
    console.log('');
    console.log('=== VetIOS Stage 1 - Local Test Suite ===');
    console.log('');

    for (const t of TESTS) {
        try {
            const result = await t.fn();
            const isPass = result.startsWith('PASS');
            if (isPass) passed++; else failed++;
            console.log(`  ${isPass ? '[OK]' : '[!!]'} ${t.name}: ${result}`);
        } catch (err) {
            failed++;
            console.log(`  [!!] ${t.name}: ERROR: ${err.message}`);
        }
    }

    console.log('');
    console.log(`  Results: ${passed} passed, ${failed} failed, ${TESTS.length} total`);
    console.log('');

    process.exit(failed > 0 ? 1 : 0);
}

run();
