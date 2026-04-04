import type { InferenceRequest } from './types';
import { getRegionalPriorMap, normalizeRegionKey } from './regional-priors';

export function computeExposurePriors(request: InferenceRequest): Map<string, number> {
    const priors = getRegionalPriorMap(request);
    const vectorExposure = request.preventive_history?.vector_exposure;
    const region = normalizeRegionKey(request.region ?? request.history?.geographic_region);
    const heartwormPrevention = request.preventive_history?.heartworm_prevention ?? 'unknown';
    const ectoparasitePrevention = request.preventive_history?.ectoparasite_prevention ?? 'unknown';

    if (heartwormPrevention === 'none' && vectorExposure?.mosquito_endemic) {
        priors.set('Dirofilariosis', Math.max(priors.get('Dirofilariosis') ?? 0, 0.15));
    } else if (heartwormPrevention === 'consistent') {
        priors.set('Dirofilariosis', Math.min(priors.get('Dirofilariosis') ?? 0.001, 0.001));
    } else if (vectorExposure?.mosquito_endemic) {
        priors.set('Dirofilariosis', Math.max(priors.get('Dirofilariosis') ?? 0, 0.08));
        priors.set('Leishmaniosis', Math.max(priors.get('Leishmaniosis') ?? 0, 0.05));
    }

    if (vectorExposure?.wildlife_contact) {
        priors.set('Leptospirosis', Math.max(priors.get('Leptospirosis') ?? 0, 0.08));
        priors.set('Rabies', Math.max(priors.get('Rabies') ?? 0, 0.06));
        priors.set('Capnocytophaga infection', Math.max(priors.get('Capnocytophaga infection') ?? 0, 0.04));
    }

    if (vectorExposure?.tick_endemic && (ectoparasitePrevention === 'none' || ectoparasitePrevention === 'inconsistent')) {
        priors.set('Ehrlichiosis', Math.max(priors.get('Ehrlichiosis') ?? 0, 0.12));
        priors.set('Anaplasmosis', Math.max(priors.get('Anaplasmosis') ?? 0, 0.10));
        priors.set('Babesiosis', Math.max(priors.get('Babesiosis') ?? 0, 0.09));
        priors.set('Hepatozoonosis', Math.max(priors.get('Hepatozoonosis') ?? 0, 0.05));
    }

    if (region === 'sub_saharan_africa' || region === 'east_africa' || region === 'nairobi_ke') {
        priors.set('Ehrlichiosis', Math.max(priors.get('Ehrlichiosis') ?? 0, 0.10));
        priors.set('Babesiosis', Math.max(priors.get('Babesiosis') ?? 0, 0.10));
        priors.set('Hepatozoonosis', Math.max(priors.get('Hepatozoonosis') ?? 0, 0.05));
        priors.set('Dirofilariosis', Math.max(priors.get('Dirofilariosis') ?? 0, 0.08));
        priors.set('Trypanosomiasis', Math.max(priors.get('Trypanosomiasis') ?? 0, 0.05));
        priors.set('Rift Valley Fever', Math.max(priors.get('Rift Valley Fever') ?? 0, 0.10));
    }

    if (region === 'mediterranean' || region === 'southern_europe') {
        priors.set('Leishmaniosis', Math.max(priors.get('Leishmaniosis') ?? 0, 0.15));
        priors.set('Ehrlichiosis', Math.max(priors.get('Ehrlichiosis') ?? 0, 0.08));
        priors.set('Hepatozoonosis', Math.max(priors.get('Hepatozoonosis') ?? 0, 0.06));
    }

    return priors;
}
