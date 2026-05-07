/**
 * @vetios/inference-schema
 *
 * Shared types and validation for the V2 multisystemic panel-based inference payload.
 */

export {
    type Species,
    type SystemType,
    type TestValue,
    type SystemPanel,
    type PanelDefinition,
    type PanelTestDefinition,
    type SpeciesPanelEntry,
    type Sex,
    type MMColour,
    type PatientV2,
    type VitalsV2,
    type HistoryV2,
    type EncounterDataV2,
    type EncounterMetadataV2,
    type EncounterPayloadV2,
    ALL_SPECIES,
    ALL_SYSTEM_TYPES,
    SPECIES_PANEL_MAP,
    PANEL_TEST_DEFINITIONS,
} from './types';

export {
    EncounterPayloadV2Schema,
    SystemPanelSchema,
    validateEncounterPayloadV2,
    validateSpeciesPanelGating,
    flattenPanelsToStructuredText,
    extractActiveSystems,
    buildCrossPanelSystemPromptBlock,
} from './validation';
