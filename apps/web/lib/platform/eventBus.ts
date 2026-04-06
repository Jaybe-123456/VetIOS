import { EventEmitter } from 'events';
import type { PlatformTelemetryRecord } from '@/lib/platform/types';

declare global {
    // eslint-disable-next-line no-var
    var __vetiosPlatformEventBus: EventEmitter | undefined;
}

function getPlatformEventBus() {
    if (!globalThis.__vetiosPlatformEventBus) {
        globalThis.__vetiosPlatformEventBus = new EventEmitter();
        globalThis.__vetiosPlatformEventBus.setMaxListeners(200);
    }

    return globalThis.__vetiosPlatformEventBus;
}

export function publishPlatformTelemetry(record: PlatformTelemetryRecord) {
    getPlatformEventBus().emit(`telemetry:${record.tenant_id}`, record);
}

export function subscribePlatformTelemetry(
    tenantId: string,
    listener: (record: PlatformTelemetryRecord) => void,
) {
    const bus = getPlatformEventBus();
    const eventName = `telemetry:${tenantId}`;
    bus.on(eventName, listener);

    return () => {
        bus.off(eventName, listener);
    };
}
