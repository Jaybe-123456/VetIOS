import { EventEmitter } from 'events';
import type { PlatformTelemetryRecord } from '@/lib/platform/types';

type SimulationSignal = {
    tenant_id: string;
    simulation_id: string;
    event_type?: string | null;
    status?: string | null;
};

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

export function publishSimulationSignal(signal: SimulationSignal) {
    getPlatformEventBus().emit(`simulation:${signal.tenant_id}:${signal.simulation_id}`, signal);
}

export function subscribeSimulationSignal(
    tenantId: string,
    simulationId: string,
    listener: (signal: SimulationSignal) => void,
) {
    const bus = getPlatformEventBus();
    const eventName = `simulation:${tenantId}:${simulationId}`;
    bus.on(eventName, listener);

    return () => {
        bus.off(eventName, listener);
    };
}
