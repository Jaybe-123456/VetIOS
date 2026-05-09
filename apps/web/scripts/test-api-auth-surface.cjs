const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');
const apiRoot = path.join(appRoot, 'app', 'api');

const EXPLICIT_AUTH_MARKERS = [
    'apiGuard(',
    'runPartnerV1Route(',
    'authenticatePartnerRequest(',
    'resolvePartnerApiKeyAccess(',
    'resolveDeveloperRouteAccess(',
    'resolveSessionTenant(',
    'resolveClinicalApiActor(',
    'resolveExperimentApiActor(',
    'requirePlatformRequestContext(',
    'requireDebugToolsRouteAccess(',
    'authorizeCronRequest(',
    'resolvePresentedControlPlaneKey(',
    'requirePublicPlatformDetailAccess(',
    'authorizeOperator(',
    'checkOrigin(',
    'stripe.webhooks.constructEvent(',
];

const INTENTIONAL_PUBLIC_ROUTE_PATTERNS = [
    /^health\/route\.ts$/,
    /^public\//,
    /^developer\/changelog(\.xml)?\/route\.ts$/,
    /^auth\/(login|signup|callback)\/route\.ts$/,
    /^auth\/email-verification\/(confirm|resend)\/route\.ts$/,
    /^webhooks\/stripe\/route\.ts$/,
];

const ROUTES_WITH_LOCAL_PROTECTION = new Map([
    ['ask-vetios/clinical-images/route.ts', 'Ask VetIOS route performs local request validation and only uses provider keys server-side.'],
    ['ask-vetios/drug-formulary/route.ts', 'Ask VetIOS route exposes formulary lookup with server-side validation.'],
    ['ask-vetios/feedback/route.ts', 'Ask VetIOS feedback accepts bounded feedback payloads.'],
    ['ask-vetios/similar-cases/route.ts', 'Ask VetIOS route returns bounded similar-case context.'],
    ['audit/case/[case_id]/route.ts', 'Audit route validates case access through audit service lookups.'],
    ['audit/report/[case_id]/route.ts', 'Audit report route validates case access through audit service lookups.'],
    ['labs/recommendations/[inference_event_id]/route.ts', 'Lab recommendation route resolves by inference event context.'],
    ['teleconsult/stream/[session_id]/route.ts', 'Teleconsult stream route is session-scoped by session id.'],
    ['telemetry/patient/[patient_id]/history/route.ts', 'Patient telemetry route is scoped by patient id.'],
    ['telemetry/patient/[patient_id]/live/route.ts', 'Patient telemetry route is scoped by patient id.'],
]);

function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(fullPath);
        return entry.isFile() && entry.name === 'route.ts' ? [fullPath] : [];
    });
}

function toRouteKey(filePath) {
    return path.relative(apiRoot, filePath).replace(/\\/g, '/');
}

function exportsHttpHandler(contents) {
    return /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS)\s*\(/.test(contents);
}

function isIntentionalPublicRoute(routeKey) {
    return INTENTIONAL_PUBLIC_ROUTE_PATTERNS.some((pattern) => pattern.test(routeKey));
}

function hasExplicitAuthMarker(contents) {
    return EXPLICIT_AUTH_MARKERS.some((marker) => contents.includes(marker));
}

function main() {
    const failures = [];

    for (const filePath of walk(apiRoot)) {
        const contents = fs.readFileSync(filePath, 'utf8');
        if (!exportsHttpHandler(contents)) continue;

        const routeKey = toRouteKey(filePath);
        if (hasExplicitAuthMarker(contents)) continue;
        if (isIntentionalPublicRoute(routeKey)) continue;
        if (ROUTES_WITH_LOCAL_PROTECTION.has(routeKey)) continue;

        failures.push(routeKey);
    }

    if (failures.length > 0) {
        throw new Error([
            'API routes must declare an explicit auth/protection marker or be documented in test-api-auth-surface.cjs:',
            ...failures.map((route) => ` - ${route}`),
        ].join('\n'));
    }

    console.log('[PASS] API route auth surface is explicitly classified');
}

main();
