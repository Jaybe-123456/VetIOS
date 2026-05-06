import * as React from 'react';

type PanelProps = {
    title?: string;
    className?: string;
};

type IntakePanelProps = PanelProps & {
    symptomCodes?: string[];
    differentials?: Array<{ label: string; confidence?: number }>;
};

type StatPanelProps = PanelProps & {
    stats?: Array<{ label: string; value: string | number }>;
};

type TimelinePanelProps = PanelProps & {
    items?: Array<{ label: string; detail?: string; tone?: 'neutral' | 'warning' | 'danger' }>;
};

function shellClass(className?: string) {
    return [
        'vetios-moat-panel',
        className,
    ].filter(Boolean).join(' ');
}

function PanelFrame({
    title,
    className,
    children,
}: PanelProps & { children: React.ReactNode }) {
    return (
        <section className={shellClass(className)}>
            {title ? <h3>{title}</h3> : null}
            {children}
        </section>
    );
}

function EmptyState({ label }: { label: string }) {
    return <div className="vetios-moat-empty">{label}</div>;
}

export function IntakePanel({
    title = 'Inference-at-Intake',
    symptomCodes = [],
    differentials = [],
    className,
}: IntakePanelProps) {
    return (
        <PanelFrame title={title} className={className}>
            <div className="vetios-moat-grid">
                <div>
                    <strong>Structured symptoms</strong>
                    {symptomCodes.length > 0 ? (
                        <ul>
                            {symptomCodes.map((code) => <li key={code}>{code}</li>)}
                        </ul>
                    ) : (
                        <EmptyState label="No symptom codes selected" />
                    )}
                </div>
                <div>
                    <strong>Ranked differentials</strong>
                    {differentials.length > 0 ? (
                        <ul>
                            {differentials.map((item) => (
                                <li key={item.label}>
                                    {item.label}
                                    {item.confidence != null ? ` ${(item.confidence * 100).toFixed(0)}%` : ''}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <EmptyState label="Awaiting inference" />
                    )}
                </div>
            </div>
        </PanelFrame>
    );
}

export function NetworkIntelligencePanel({
    title = 'Cross-Clinic Learning Network',
    stats = [],
    className,
}: StatPanelProps) {
    return <StatsPanel title={title} stats={stats} className={className} />;
}

export function ImagingPanel({
    title = 'Multimodal Imaging',
    items = [],
    className,
}: TimelinePanelProps) {
    return <TimelinePanel title={title} items={items} className={className} />;
}

export function LabAgentPanel({
    title = 'Autonomous Lab Agents',
    items = [],
    className,
}: TimelinePanelProps) {
    return <TimelinePanel title={title} items={items} className={className} />;
}

export function TeleconsultPanel({
    title = 'Telemedicine Inference',
    items = [],
    className,
}: TimelinePanelProps) {
    return <TimelinePanel title={title} items={items} className={className} />;
}

export function OutbreakMonitor({
    title = 'Outbreak Early Warning',
    items = [],
    className,
}: TimelinePanelProps) {
    return <TimelinePanel title={title} items={items} className={className} />;
}

export function TelemetryDashboard({
    title = 'Wearables Telemetry',
    items = [],
    className,
}: TimelinePanelProps) {
    return <TimelinePanel title={title} items={items} className={className} />;
}

function StatsPanel({ title, stats = [], className }: StatPanelProps) {
    return (
        <PanelFrame title={title} className={className}>
            {stats.length > 0 ? (
                <dl className="vetios-moat-stats">
                    {stats.map((stat) => (
                        <div key={stat.label}>
                            <dt>{stat.label}</dt>
                            <dd>{stat.value}</dd>
                        </div>
                    ))}
                </dl>
            ) : (
                <EmptyState label="No network stats available" />
            )}
        </PanelFrame>
    );
}

function TimelinePanel({ title, items = [], className }: TimelinePanelProps) {
    return (
        <PanelFrame title={title} className={className}>
            {items.length > 0 ? (
                <ol>
                    {items.map((item) => (
                        <li key={`${item.label}:${item.detail ?? ''}`} data-tone={item.tone ?? 'neutral'}>
                            <strong>{item.label}</strong>
                            {item.detail ? <span>{item.detail}</span> : null}
                        </li>
                    ))}
                </ol>
            ) : (
                <EmptyState label="No module activity yet" />
            )}
        </PanelFrame>
    );
}
