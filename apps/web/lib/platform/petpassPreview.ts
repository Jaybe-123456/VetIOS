export interface PetPassProfile {
    pet_name: string;
    species: string;
    breed: string;
    age_display: string;
    clinic_name: string;
    risk_state: 'stable' | 'watch' | 'urgent';
}

export interface PetPassAlert {
    id: string;
    title: string;
    severity: 'info' | 'watch' | 'urgent';
    detail: string;
    action: string;
}

export interface PetPassTimelineItem {
    id: string;
    title: string;
    at: string;
    type: 'visit' | 'result' | 'medication' | 'alert';
    detail: string;
}

export interface PetPassPreviewData {
    profile: PetPassProfile;
    alerts: PetPassAlert[];
    timeline: PetPassTimelineItem[];
    features: Array<{
        title: string;
        summary: string;
        readiness: 'preview' | 'planned';
    }>;
}

export const petPassPreview: PetPassPreviewData = {
    profile: {
        pet_name: 'Milo',
        species: 'Canine',
        breed: 'Dachshund',
        age_display: '6 years',
        clinic_name: 'VetIOS Neurology Partners',
        risk_state: 'watch',
    },
    alerts: [
        {
            id: 'alert-follow-up',
            title: 'Follow-up neurologic check due',
            severity: 'watch',
            detail: 'Clinic asked for a recheck within 48 hours to monitor hindlimb strength and pain response.',
            action: 'Book recheck',
        },
        {
            id: 'alert-medication',
            title: 'Pain-management refill approaching',
            severity: 'info',
            detail: 'Medication supply is projected to run out in 3 days if current dosing stays unchanged.',
            action: 'Request refill',
        },
        {
            id: 'alert-referral',
            title: 'Referral escalation threshold',
            severity: 'urgent',
            detail: 'If walking worsens or bladder function changes, clinic instructions escalate to emergency referral.',
            action: 'View emergency guidance',
        },
    ],
    timeline: [
        {
            id: 'visit-1',
            title: 'Acute neurologic visit',
            at: 'Today, 8:20 AM',
            type: 'visit',
            detail: 'Clinic documented back pain, hindlimb weakness, and ataxia after a jump.',
        },
        {
            id: 'result-1',
            title: 'Imaging impression posted',
            at: 'Today, 10:05 AM',
            type: 'result',
            detail: 'Disc extrusion impression shared to the owner timeline as a clinician-approved summary.',
        },
        {
            id: 'med-1',
            title: 'Medication plan updated',
            at: 'Today, 10:40 AM',
            type: 'medication',
            detail: 'Pain-management plan and crate-rest instructions were synced from the clinic workflow.',
        },
        {
            id: 'alert-1',
            title: 'Recheck reminder created',
            at: 'Today, 10:42 AM',
            type: 'alert',
            detail: 'Owner reminder and escalation triggers staged for the next 48 hours.',
        },
    ],
    features: [
        {
            title: 'Owner health history',
            summary: 'A consumer timeline for clinician-approved visit summaries, imaging impressions, and care milestones.',
            readiness: 'preview',
        },
        {
            title: 'Actionable alerts',
            summary: 'Reminder, deterioration, and refill alerts that turn clinic workflows into owner-facing follow-through.',
            readiness: 'preview',
        },
        {
            title: 'Clinic sync',
            summary: 'Planned bidirectional sync for appointments, rechecks, referrals, and medication changes.',
            readiness: 'planned',
        },
    ],
};
