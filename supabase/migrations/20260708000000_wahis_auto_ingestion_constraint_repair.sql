-- VetIOS WAHIS auto-ingestion constraint repair
-- Allows public dataset/API release manifests and surveillance/literature node kinds
-- emitted by the global ontology population adapters.

alter table public.official_ontology_release_events
    drop constraint if exists official_ontology_release_events_access_check;

alter table public.official_ontology_release_events
    add constraint official_ontology_release_events_access_check
    check (access_mode in (
        'public_obo_json',
        'public_api',
        'public_dataset',
        'credentialed_api',
        'licensed_release'
    ));

alter table public.global_biomedical_ontology_node_events
    drop constraint if exists global_biomedical_ontology_node_events_kind_check;

alter table public.global_biomedical_ontology_node_events
    add constraint global_biomedical_ontology_node_events_kind_check
    check (node_kind in (
        'class',
        'phenotype',
        'relationship',
        'literature_evidence',
        'surveillance_record',
        'unknown'
    ));

comment on constraint official_ontology_release_events_access_check
    on public.official_ontology_release_events is
    'Permits public API and public dataset provider releases such as PubMed/PMC and WOAH WAHIS auto-ingestion exports.';

comment on constraint global_biomedical_ontology_node_events_kind_check
    on public.global_biomedical_ontology_node_events is
    'Permits ontology classes plus population-surveillance and literature-evidence nodes imported by global ontology adapters.';

notify pgrst, 'reload schema';
