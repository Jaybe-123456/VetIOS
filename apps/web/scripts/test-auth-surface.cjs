const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const appRoot = path.resolve(__dirname, '..');
const generatedDir = path.join(appRoot, '.generated-tests');
const siteSourcePath = path.join(appRoot, 'lib', 'site.ts');
const generatedSitePath = path.join(generatedDir, 'site.cjs');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function compileSiteModule() {
    fs.mkdirSync(generatedDir, { recursive: true });
    const source = fs.readFileSync(siteSourcePath, 'utf8');
    const transpiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
        },
        fileName: siteSourcePath,
    });
    fs.writeFileSync(generatedSitePath, transpiled.outputText, 'utf8');
    delete require.cache[generatedSitePath];
    return require(generatedSitePath);
}

function cleanupGeneratedArtifacts() {
    fs.rmSync(generatedDir, { recursive: true, force: true });
}

function assertFileContains(filePath, snippet) {
    const contents = fs.readFileSync(filePath, 'utf8');
    assert(contents.includes(snippet), `${path.relative(appRoot, filePath)} is missing expected snippet: ${snippet}`);
}

function main() {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.vetios.example';
    process.env.SITE_URL = 'https://app.vetios.example';
    process.env.VERCEL_ENV = 'production';

    const site = compileSiteModule();

    assert(site.shouldRedirectPreviewAuthHost('vet-ios-preview.vercel.app', '/login') === true, 'Preview login host should redirect to canonical domain.');
    assert(site.shouldRedirectPreviewAuthHost('vet-ios-preview.vercel.app', '/dashboard') === false, 'Non-auth routes should not be forced to canonical auth host.');
    assert(site.shouldRedirectPreviewAuthHost('app.vetios.example', '/login') === false, 'Canonical host should not redirect.');
    assert(site.isPublicAuthPath('/verify-email') === true, 'Verify-email route should stay publicly accessible.');
    assert(site.isPublicMarketingPath('/platform') === true, 'Platform overview should stay publicly accessible.');
    assert(site.isPublicMarketingPath('/platform/developers') === false, 'Detailed platform docs should not stay public.');
    assert(site.isShelllessPublicPath('/platform/developers') === true, 'Detailed platform routes should remain shellless for authenticated users.');
    assert(site.buildClientAuthCallbackUrl('https://vet-ios-preview.vercel.app', '/inference') === 'https://app.vetios.example/auth/callback?next=%2Finference', 'Client auth callback should prefer the configured public origin.');
    assert(site.sanitizeInternalPath('//evil.example', '/inference') === '/inference', 'Double-slash redirect targets must be rejected.');
    assert(site.shouldIndexSite() === true, 'Configured production site should allow indexing.');

    process.env.VERCEL_ENV = 'preview';
    assert(site.shouldIndexSite() === false, 'Preview deployments must not be indexed.');

    assertFileContains(path.join(appRoot, 'middleware.ts'), 'shouldRedirectPreviewAuthHost');
    assertFileContains(path.join(appRoot, 'lib', 'auth', 'pageGuard.ts'), "redirect(`/login?next=${encodeURIComponent(nextPath)}`)");
    assertFileContains(path.join(appRoot, 'app', 'dashboard', 'layout.tsx'), "requirePageSession('/dashboard')");
    assertFileContains(path.join(appRoot, 'app', '(console)', 'layout.tsx'), "requirePageSession('/inference')");
    assertFileContains(path.join(appRoot, 'app', 'auth', 'callback', 'route.ts'), 'sanitizeInternalPath');
    assertFileContains(path.join(appRoot, 'app', 'login', 'page.tsx'), 'buildClientAuthCallbackUrl');
    assertFileContains(path.join(appRoot, 'app', 'signup', 'page.tsx'), 'AuthDomainNotice');
    assertFileContains(path.join(appRoot, 'app', 'robots.ts'), "disallow: '/'");

    console.log('[PASS] auth surface uses canonical-domain and preview-host safeguards');
}

try {
    main();
} finally {
    cleanupGeneratedArtifacts();
}
