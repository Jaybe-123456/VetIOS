import type { CaseDetail } from '@/lib/cases/caseWorkflow';
import type { PatientTimelineEvent } from '@/lib/clinicalMemory/patientTimeline';
import { formatClinicalLabel } from './clinicalTypes';

export function PatientTimelinePanel({ clinicalCase }: { clinicalCase: CaseDetail }) {
    const timeline = clinicalCase.patient_timeline;
    const events = timeline.events ?? [];

    return (
        <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <TimelineMetric label="Timeline events" value={timeline.total_events} />
                <TimelineMetric label="Confirmed signals" value={timeline.confirmed_diagnoses} />
                <TimelineMetric label="Longitudinal visits" value={timeline.longitudinal_visits} />
                <TimelineMetric label="Last event" value={timeline.last_event_at ? formatDate(timeline.last_event_at) : 'Pending'} />
            </div>

            <div className="rounded-md border border-accent/25 bg-accent/[0.04] p-4 text-sm leading-relaxed text-white/72">
                {timeline.timeline_summary}
            </div>

            {timeline.active_conditions.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                    {timeline.active_conditions.map((condition) => (
                        <span key={condition} className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-white/70">
                            {formatClinicalLabel(condition)}
                        </span>
                    ))}
                </div>
            ) : null}

            {events.length > 0 ? (
                <div className="rounded-md border border-white/10 bg-white/[0.025]">
                    <div className="border-b border-white/8 p-4">
                        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/48">
                            Clinical memory timeline
                        </div>
                        <p className="mt-2 text-sm text-white/60">
                            Encounters, inferences, confirmed diagnoses, and longitudinal records tied to this patient.
                        </p>
                    </div>
                    <div className="divide-y divide-white/8">
                        {events.slice(0, 10).map((event) => (
                            <TimelineEventRow key={event.event_key} event={event} />
                        ))}
                    </div>
                </div>
            ) : (
                <div className="rounded-md border border-white/10 bg-white/[0.025] p-4 text-sm leading-relaxed text-white/62">
                    This case has no reusable patient timeline yet. Confirming the outcome will start the longitudinal memory for future visits.
                </div>
            )}
        </div>
    );
}

function TimelineMetric({ label, value }: { label: string; value: number | string }) {
    return (
        <div className="rounded-md border border-white/10 bg-white/[0.025] p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/48">{label}</div>
            <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
        </div>
    );
}

function TimelineEventRow({ event }: { event: PatientTimelineEvent }) {
    return (
        <div className="grid gap-3 p-4 text-sm md:grid-cols-[0.8fr_1.2fr_0.5fr] md:items-center">
            <div>
                <div className="font-semibold text-white">{event.event_title}</div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">
                    {formatEventType(event.event_type)}
                </div>
            </div>
            <div className="text-white/68">{event.event_summary}</div>
            <div className="md:text-right">
                <div className="text-white/54">{formatDate(event.occurred_at)}</div>
                <div className={event.persisted ? 'text-accent' : 'text-white/38'}>
                    {event.persisted ? 'Stored' : 'Current case'}
                </div>
            </div>
        </div>
    );
}

function formatEventType(value: PatientTimelineEvent['event_type']): string {
    switch (value) {
        case 'case_created':
            return 'Case';
        case 'inference_recorded':
            return 'Inference';
        case 'confirmed_diagnosis':
            return 'Outcome';
        case 'lab_result':
            return 'Labs';
        case 'imaging_result':
            return 'Imaging';
        case 'treatment_started':
            return 'Treatment';
        case 'follow_up':
            return 'Follow-up';
        case 'petpass_update':
            return 'PetPass';
        case 'external_record':
        default:
            return 'Record';
    }
}

function formatDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString();
}
