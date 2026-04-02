'use client';

import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import {
    BellRing,
    HeartHandshake,
    Link2,
    PawPrint,
    RefreshCw,
    Users,
} from 'lucide-react';
import {
    ConsoleCard,
    Container,
    DataRow,
    PageHeader,
    TerminalButton,
    TerminalInput,
    TerminalLabel,
    TerminalTextarea,
} from '@/components/ui/terminal';
import type {
    OwnerAccountRecord,
    PetPassControlPlaneSnapshot,
    PetPassNotificationDeliveryRecord,
    PetPassPetProfileRecord,
    PetPassTimelineEntryRecord,
} from '@/lib/petpass/service';

export default function PetPassOperationsClient({
    initialSnapshot,
    tenantId,
}: {
    initialSnapshot: PetPassControlPlaneSnapshot;
    tenantId: string;
}) {
    const [snapshot, setSnapshot] = useState(initialSnapshot);
    const [refreshing, setRefreshing] = useState(false);
    const [ownerDraft, setOwnerDraft] = useState({
        full_name: '',
        preferred_name: '',
        email: '',
        phone: '',
    });
    const [petDraft, setPetDraft] = useState({
        pet_name: '',
        species: 'Canine',
        breed: '',
        age_display: '',
        clinic_name: '',
        risk_state: 'watch',
    });
    const [linkDraft, setLinkDraft] = useState({
        owner_account_id: initialSnapshot.owners[0]?.id ?? '',
        pet_profile_id: initialSnapshot.pet_profiles[0]?.id ?? '',
        clinic_name: initialSnapshot.pet_profiles[0]?.clinic_name ?? '',
    });
    const [timelineDraft, setTimelineDraft] = useState({
        pet_profile_id: initialSnapshot.pet_profiles[0]?.id ?? '',
        owner_account_id: initialSnapshot.owners[0]?.id ?? '',
        entry_type: 'alert',
        title: 'Recheck reminder created',
        detail: 'Owner reminder and follow-up instructions were staged from the clinic console.',
    });
    const [notificationDraft, setNotificationDraft] = useState({
        owner_account_id: initialSnapshot.owners[0]?.id ?? '',
        pet_profile_id: initialSnapshot.pet_profiles[0]?.id ?? '',
        channel: 'push',
        notification_type: 'follow_up_reminder',
        title: 'Follow-up reminder',
        body: 'Recheck timing and escalation guidance are now available in PetPass.',
    });
    const [actionState, setActionState] = useState<{
        status: 'idle' | 'running' | 'success' | 'error';
        message: string;
    }>({ status: 'idle', message: '' });

    const latestOwner = useMemo(() => snapshot.owners[0] ?? null, [snapshot.owners]);
    const latestPet = useMemo(() => snapshot.pet_profiles[0] ?? null, [snapshot.pet_profiles]);

    async function refreshSnapshot() {
        setRefreshing(true);
        try {
            const res = await fetch('/api/platform/petpass?limit=24', { cache: 'no-store' });
            const data = await res.json() as { snapshot?: PetPassControlPlaneSnapshot; error?: string };
            if (!res.ok || !data.snapshot) {
                throw new Error(data.error ?? 'Failed to refresh PetPass snapshot.');
            }
            setSnapshot(data.snapshot);
        } catch (error) {
            setActionState({
                status: 'error',
                message: error instanceof Error ? error.message : 'Failed to refresh PetPass snapshot.',
            });
        } finally {
            setRefreshing(false);
        }
    }

    async function runAction(body: Record<string, unknown>, successMessage: string, applyDefaults = true) {
        setActionState({ status: 'running', message: 'Running PetPass operation...' });
        try {
            const res = await fetch('/api/platform/petpass', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json() as { snapshot?: PetPassControlPlaneSnapshot; error?: string };
            if (!res.ok || !data.snapshot) {
                throw new Error(data.error ?? 'PetPass operation failed.');
            }
            setSnapshot(data.snapshot);
            if (applyDefaults) {
                syncDraftIds(data.snapshot);
            }
            setActionState({ status: 'success', message: successMessage });
        } catch (error) {
            setActionState({
                status: 'error',
                message: error instanceof Error ? error.message : 'PetPass operation failed.',
            });
        }
    }

    function syncDraftIds(nextSnapshot: PetPassControlPlaneSnapshot) {
        const ownerId = nextSnapshot.owners[0]?.id ?? '';
        const petId = nextSnapshot.pet_profiles[0]?.id ?? '';
        setLinkDraft((current) => ({
            ...current,
            owner_account_id: current.owner_account_id || ownerId,
            pet_profile_id: current.pet_profile_id || petId,
            clinic_name: current.clinic_name || nextSnapshot.pet_profiles[0]?.clinic_name || '',
        }));
        setTimelineDraft((current) => ({
            ...current,
            owner_account_id: current.owner_account_id || ownerId,
            pet_profile_id: current.pet_profile_id || petId,
        }));
        setNotificationDraft((current) => ({
            ...current,
            owner_account_id: current.owner_account_id || ownerId,
            pet_profile_id: current.pet_profile_id || petId,
        }));
    }

    return (
        <Container className="max-w-[1600px]">
            <PageHeader
                title="PETPASS OPERATIONS"
                description="Provision the owner network, clinic links, consents, timeline entries, and owner alert deliveries that turn PetPass from a preview into a real moat substrate."
            />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
                <SummaryCard icon={<Users className="h-4 w-4" />} label="Owners" value={snapshot.summary.owner_accounts} />
                <SummaryCard icon={<PawPrint className="h-4 w-4" />} label="Linked Pets" value={snapshot.summary.linked_pets} />
                <SummaryCard icon={<HeartHandshake className="h-4 w-4" />} label="Consents" value={snapshot.summary.granted_consents} />
                <SummaryCard icon={<BellRing className="h-4 w-4" />} label="Alerts" value={snapshot.summary.active_alerts} tone={snapshot.summary.active_alerts > 0 ? 'warning' : 'neutral'} />
            </div>

            <ConsoleCard title="PetPass Control" className="mt-6">
                <div className="flex flex-wrap gap-2">
                    <TerminalButton variant="secondary" onClick={() => void refreshSnapshot()} disabled={refreshing}>
                        <RefreshCw className="mr-2 h-3 w-3" />
                        {refreshing ? 'Refreshing...' : 'Refresh Snapshot'}
                    </TerminalButton>
                    <div className="font-mono text-xs text-muted self-center">
                        Tenant: {tenantId}
                    </div>
                </div>
                <ActionStatePanel state={actionState} />
            </ConsoleCard>

            <div className="mt-6 grid gap-6 xl:grid-cols-2">
                <ConsoleCard title="Create Owner Account">
                    <div className="grid gap-4 md:grid-cols-2">
                        <FormField label="Full Name" value={ownerDraft.full_name} onChange={(value) => setOwnerDraft((current) => ({ ...current, full_name: value }))} />
                        <FormField label="Preferred Name" value={ownerDraft.preferred_name} onChange={(value) => setOwnerDraft((current) => ({ ...current, preferred_name: value }))} />
                        <FormField label="Email" value={ownerDraft.email} onChange={(value) => setOwnerDraft((current) => ({ ...current, email: value }))} />
                        <FormField label="Phone" value={ownerDraft.phone} onChange={(value) => setOwnerDraft((current) => ({ ...current, phone: value }))} />
                    </div>
                    <div className="pt-4">
                        <TerminalButton
                            onClick={() => void runAction({
                                action: 'create_owner_account',
                                ...ownerDraft,
                            }, 'Owner account created.')}
                        >
                            Create Owner
                        </TerminalButton>
                    </div>
                </ConsoleCard>

                <ConsoleCard title="Create Pet Profile">
                    <div className="grid gap-4 md:grid-cols-2">
                        <FormField label="Pet Name" value={petDraft.pet_name} onChange={(value) => setPetDraft((current) => ({ ...current, pet_name: value }))} />
                        <FormField label="Species" value={petDraft.species} onChange={(value) => setPetDraft((current) => ({ ...current, species: value }))} />
                        <FormField label="Breed" value={petDraft.breed} onChange={(value) => setPetDraft((current) => ({ ...current, breed: value }))} />
                        <FormField label="Age Display" value={petDraft.age_display} onChange={(value) => setPetDraft((current) => ({ ...current, age_display: value }))} />
                        <FormField label="Clinic Name" value={petDraft.clinic_name} onChange={(value) => setPetDraft((current) => ({ ...current, clinic_name: value }))} />
                        <div>
                            <TerminalLabel>Risk State</TerminalLabel>
                            <select
                                value={petDraft.risk_state}
                                onChange={(event) => setPetDraft((current) => ({ ...current, risk_state: event.target.value }))}
                                className="w-full border border-grid bg-dim p-3 font-mono text-sm text-foreground"
                            >
                                <option value="stable">stable</option>
                                <option value="watch">watch</option>
                                <option value="urgent">urgent</option>
                            </select>
                        </div>
                    </div>
                    <div className="pt-4">
                        <TerminalButton
                            onClick={() => void runAction({
                                action: 'create_pet_profile',
                                ...petDraft,
                            }, 'Pet profile created.')}
                        >
                            Create Pet
                        </TerminalButton>
                    </div>
                </ConsoleCard>
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-2">
                <ConsoleCard title="Link Owner, Pet, and Clinic">
                    <div className="grid gap-4 md:grid-cols-2">
                        <FormField label="Owner Account ID" value={linkDraft.owner_account_id} onChange={(value) => setLinkDraft((current) => ({ ...current, owner_account_id: value }))} />
                        <FormField label="Pet Profile ID" value={linkDraft.pet_profile_id} onChange={(value) => setLinkDraft((current) => ({ ...current, pet_profile_id: value }))} />
                        <FormField label="Clinic Name" value={linkDraft.clinic_name} onChange={(value) => setLinkDraft((current) => ({ ...current, clinic_name: value }))} />
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                        <TerminalButton
                            onClick={() => void runAction({
                                action: 'link_owner_pet',
                                owner_account_id: linkDraft.owner_account_id,
                                pet_profile_id: linkDraft.pet_profile_id,
                                relationship_type: 'owner',
                                primary_owner: true,
                            }, 'Owner-pet link created.')}
                        >
                            <Link2 className="mr-2 h-3 w-3" />
                            Link Owner To Pet
                        </TerminalButton>
                        <TerminalButton
                            variant="secondary"
                            onClick={() => void runAction({
                                action: 'create_clinic_owner_link',
                                owner_account_id: linkDraft.owner_account_id,
                                clinic_name: linkDraft.clinic_name,
                            }, 'Clinic-owner link created.')}
                        >
                            <HeartHandshake className="mr-2 h-3 w-3" />
                            Link Clinic
                        </TerminalButton>
                        <TerminalButton
                            variant="secondary"
                            onClick={() => void runAction({
                                action: 'record_consent',
                                owner_account_id: linkDraft.owner_account_id,
                                pet_profile_id: linkDraft.pet_profile_id,
                                consent_type: 'timeline_and_alerts',
                                status: 'granted',
                            }, 'Consent recorded.')}
                        >
                            Record Consent
                        </TerminalButton>
                    </div>
                </ConsoleCard>

                <ConsoleCard title="Publish Timeline and Alert">
                    <div className="grid gap-4 md:grid-cols-2">
                        <FormField label="Owner Account ID" value={timelineDraft.owner_account_id} onChange={(value) => setTimelineDraft((current) => ({ ...current, owner_account_id: value }))} />
                        <FormField label="Pet Profile ID" value={timelineDraft.pet_profile_id} onChange={(value) => setTimelineDraft((current) => ({ ...current, pet_profile_id: value }))} />
                        <div>
                            <TerminalLabel>Entry Type</TerminalLabel>
                            <select
                                value={timelineDraft.entry_type}
                                onChange={(event) => setTimelineDraft((current) => ({ ...current, entry_type: event.target.value }))}
                                className="w-full border border-grid bg-dim p-3 font-mono text-sm text-foreground"
                            >
                                <option value="alert">alert</option>
                                <option value="visit">visit</option>
                                <option value="result">result</option>
                                <option value="medication">medication</option>
                                <option value="referral">referral</option>
                                <option value="message">message</option>
                            </select>
                        </div>
                        <FormField label="Title" value={timelineDraft.title} onChange={(value) => setTimelineDraft((current) => ({ ...current, title: value }))} />
                    </div>
                    <div className="mt-4">
                        <TerminalLabel>Detail</TerminalLabel>
                        <TerminalTextarea value={timelineDraft.detail} onChange={(event) => setTimelineDraft((current) => ({ ...current, detail: event.target.value }))} />
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                        <TerminalButton
                            onClick={() => void runAction({
                                action: 'create_timeline_entry',
                                ...timelineDraft,
                                visibility: 'owner_safe',
                            }, 'Timeline entry created.', false)}
                        >
                            Create Timeline Entry
                        </TerminalButton>
                        <TerminalButton
                            variant="secondary"
                            onClick={() => void runAction({
                                action: 'create_notification_delivery',
                                ...notificationDraft,
                            }, 'Notification delivery queued.', false)}
                        >
                            Queue Notification
                        </TerminalButton>
                    </div>
                </ConsoleCard>
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
                <ConsoleCard title="Recent Owners & Pets">
                    <div className="space-y-4">
                        {snapshot.owners.slice(0, 4).map((owner) => (
                            <OwnerRow key={owner.id} owner={owner} petProfiles={snapshot.pet_profiles} links={snapshot.owner_pet_links} />
                        ))}
                        {snapshot.owners.length === 0 && (
                            <div className="font-mono text-xs text-muted">No owner accounts have been created yet.</div>
                        )}
                    </div>
                </ConsoleCard>

                <ConsoleCard title="Recent Timeline & Notifications">
                    <div className="space-y-4">
                        {snapshot.timeline_entries.slice(0, 4).map((entry) => (
                            <TimelineRow key={entry.id} entry={entry} />
                        ))}
                        {snapshot.notification_deliveries.slice(0, 4).map((delivery) => (
                            <DeliveryRow key={delivery.id} delivery={delivery} />
                        ))}
                        {snapshot.timeline_entries.length === 0 && snapshot.notification_deliveries.length === 0 && (
                            <div className="font-mono text-xs text-muted">No owner-facing events have been created yet.</div>
                        )}
                    </div>
                </ConsoleCard>
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-2">
                <ConsoleCard title="Latest Owner">
                    {latestOwner ? (
                        <>
                            <DataRow label="Name" value={latestOwner.full_name} />
                            <DataRow label="Email" value={latestOwner.email ?? 'NO DATA'} />
                            <DataRow label="Phone" value={latestOwner.phone ?? 'NO DATA'} />
                            <DataRow label="Status" value={latestOwner.status.toUpperCase()} />
                        </>
                    ) : (
                        <div className="font-mono text-xs text-muted">No owner account selected yet.</div>
                    )}
                </ConsoleCard>
                <ConsoleCard title="Latest Pet">
                    {latestPet ? (
                        <>
                            <DataRow label="Pet" value={latestPet.pet_name} />
                            <DataRow label="Species" value={latestPet.species ?? 'NO DATA'} />
                            <DataRow label="Breed" value={latestPet.breed ?? 'NO DATA'} />
                            <DataRow label="Risk" value={latestPet.risk_state.toUpperCase()} />
                            <DataRow label="Clinic" value={latestPet.clinic_name ?? 'NO DATA'} />
                        </>
                    ) : (
                        <div className="font-mono text-xs text-muted">No pet profile selected yet.</div>
                    )}
                </ConsoleCard>
            </div>
        </Container>
    );
}

function SummaryCard({
    icon,
    label,
    value,
    tone = 'neutral',
}: {
    icon: ReactNode;
    label: string;
    value: number;
    tone?: 'neutral' | 'warning';
}) {
    return (
        <ConsoleCard className={tone === 'warning' ? 'border-warning/30 text-warning' : undefined}>
            <div className="flex items-center justify-between">
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">{label}</div>
                <div>{icon}</div>
            </div>
            <div className="font-mono text-3xl">{value}</div>
        </ConsoleCard>
    );
}

function FormField({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <div>
            <TerminalLabel>{label}</TerminalLabel>
            <TerminalInput value={value} onChange={(event) => onChange(event.target.value)} />
        </div>
    );
}

function OwnerRow({
    owner,
    petProfiles,
    links,
}: {
    owner: OwnerAccountRecord;
    petProfiles: PetPassPetProfileRecord[];
    links: PetPassControlPlaneSnapshot['owner_pet_links'];
}) {
    const linkedPetIds = links.filter((link) => link.owner_account_id === owner.id).map((link) => link.pet_profile_id);
    const petNames = petProfiles.filter((pet) => linkedPetIds.includes(pet.id)).map((pet) => pet.pet_name);

    return (
        <div className="border border-grid p-4">
            <div className="font-mono text-sm text-foreground">{owner.full_name}</div>
            <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
                {owner.status} · {petNames.length > 0 ? petNames.join(', ') : 'no pets linked'}
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
                <DataRow label="Email" value={owner.email ?? 'NO DATA'} />
                <DataRow label="Phone" value={owner.phone ?? 'NO DATA'} />
            </div>
        </div>
    );
}

function TimelineRow({ entry }: { entry: PetPassTimelineEntryRecord }) {
    return (
        <div className="border border-grid p-4">
            <div className="font-mono text-sm text-foreground">{entry.title}</div>
            <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
                {entry.entry_type} · {formatTimestamp(entry.occurred_at)}
            </div>
            <div className="mt-2 text-sm text-muted">{entry.detail}</div>
        </div>
    );
}

function DeliveryRow({ delivery }: { delivery: PetPassNotificationDeliveryRecord }) {
    return (
        <div className="border border-grid p-4">
            <div className="font-mono text-sm text-foreground">{delivery.title}</div>
            <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
                {delivery.channel} · {delivery.delivery_status} · {formatTimestamp(delivery.scheduled_at)}
            </div>
            <div className="mt-2 text-sm text-muted">{delivery.body}</div>
        </div>
    );
}

function ActionStatePanel({
    state,
}: {
    state: {
        status: 'idle' | 'running' | 'success' | 'error';
        message: string;
    };
}) {
    if (state.status === 'idle' || !state.message) {
        return null;
    }

    const tone = state.status === 'error'
        ? 'border-danger/30 bg-danger/10 text-danger'
        : state.status === 'success'
            ? 'border-accent/30 bg-accent/10 text-accent'
            : 'border-warning/30 bg-warning/10 text-warning';

    return <div className={`mt-4 border px-4 py-3 font-mono text-xs ${tone}`}>{state.message}</div>;
}

function formatTimestamp(value: string): string {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}
