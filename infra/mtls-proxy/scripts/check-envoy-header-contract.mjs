import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const templatePath = fileURLToPath(new URL('../envoy.yaml.template', import.meta.url));
const template = readFileSync(templatePath, 'utf8');
const removalBlock = template.match(
    /request_headers_to_remove:\s*\r?\n((?:\s+- [^\r\n]+\r?\n)+)/,
)?.[1] ?? '';

assert.ok(removalBlock, 'request_headers_to_remove block is missing');

for (const canonicalHeader of [
    'x-vetios-mtls-proxy-secret',
    'x-vetios-client-cert-sha256',
]) {
    assert.ok(
        !removalBlock.includes(`- ${canonicalHeader}`),
        `${canonicalHeader} must not be removed after trusted header mutation`,
    );
}

for (const spoofableAlias of [
    'x-mtls-proxy-secret',
    'x-client-cert-sha256',
    'x-forwarded-client-cert-sha256',
    'ssl-client-fingerprint-sha256',
]) {
    assert.ok(
        removalBlock.includes(`- ${spoofableAlias}`),
        `${spoofableAlias} must be stripped from inbound requests`,
    );
}

assert.match(
    template,
    /key: x-vetios-mtls-proxy-secret\s*\r?\n\s+value: "\$\{VETIOS_MTLS_PROXY_SECRET\}"\s*\r?\n\s+append_action: OVERWRITE_IF_EXISTS_OR_ADD/,
    'trusted proxy secret must overwrite any inbound canonical value',
);
assert.match(
    template,
    /key: x-vetios-client-cert-sha256\s*\r?\n\s+value: "%DOWNSTREAM_PEER_FINGERPRINT_256%"\s*\r?\n\s+append_action: OVERWRITE_IF_EXISTS_OR_ADD/,
    'verified downstream certificate fingerprint must overwrite any inbound canonical value',
);

assert.match(
    template,
    /path: "\/api\/amr\/network-operations"\s*\r?\n\s+route:\s*\r?\n\s+cluster: vetios_app/,
    'the exact AMR network operations path must be forwarded through the mTLS boundary',
);
assert.doesNotMatch(
    template,
    /prefix: "\/api\/amr\/"/,
    'the mTLS proxy must not forward the entire AMR route namespace',
);
assert.match(
    template,
    /prefix: "\/"\s*\r?\n\s+direct_response:\s*\r?\n\s+status: 404/,
    'the mTLS proxy must retain its default-deny catchall',
);

console.log('envoy_header_and_route_contract_ok');
