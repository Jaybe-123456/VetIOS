import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const operationsRoute = readFileSync(
    resolve(process.cwd(), 'app/api/amr/network-operations/route.ts'),
    'utf8',
);
const exchangeRoute = readFileSync(
    resolve(process.cwd(), 'app/api/amr/private-exchange/route.ts'),
    'utf8',
);
const pilotRoute = readFileSync(
    resolve(process.cwd(), 'app/api/amr/outcome-network/route.ts'),
    'utf8',
);

describe('AMR network operations route contracts', () => {
    it('binds accepted AST ingestion to the current OAuth certificate and a fresh probe', () => {
        expect(operationsRoute).toContain("input.actor.authMode !== 'oauth_client'");
        expect(operationsRoute).toContain("input.actor.tokenBindingMethod !== 'mtls'");
        expect(operationsRoute).toContain('hashAMRNetworkValue(input.actor.mtlsCertThumbprint)');
        expect(operationsRoute).toContain('isFreshProbe(probe.row)');
        expect(operationsRoute).toContain('ingest_amr_ast_packet_v1');
    });

    it('prevents human users from manufacturing connector verification', () => {
        expect(pilotRoute).toContain('connector_verification_is_system_computed');
        expect(pilotRoute).toContain('/api/amr/network-operations');
    });

    it('gates agreement and settlement writes and never claims to execute payment', () => {
        expect(exchangeRoute).toContain('amr.exchange.agreement.write');
        expect(exchangeRoute).toContain('amr.exchange.settlement.write');
        expect(exchangeRoute).toContain('payment_confirmation_hash_required');
        expect(exchangeRoute).toContain('payment_executed_by_vetios: false');
        expect(exchangeRoute).toContain('identifiable_record_exchange: false');
    });
});
