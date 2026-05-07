export interface PMCFigure {
    pmcid: string;
    pmid: string;
    doi: string;
    article_title: string;
    journal: string;
    pub_year: number;
    figure_url: string;
    figure_caption: string;
    license: string;
    pubmed_url: string;
}

export interface PMCFigureResolverOptions {
    eutilsBaseUrl?: string;
    retmax?: number;
    email?: string;
    fetchImpl?: typeof fetch;
}

interface PmcSearchPayload {
    esearchresult?: {
        idlist?: string[];
    };
}

export async function resolvePMCFigures(query: string, options: PMCFigureResolverOptions = {}): Promise<PMCFigure[]> {
    const fetcher = options.fetchImpl ?? fetch;
    const baseUrl = options.eutilsBaseUrl ?? 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
    const searchUrl = new URL(`${baseUrl.replace(/\/$/, '')}/esearch.fcgi`);
    searchUrl.searchParams.set('db', 'pmc');
    searchUrl.searchParams.set('term', `${query} AND open access[filter]`);
    searchUrl.searchParams.set('retmax', String(options.retmax ?? 10));
    searchUrl.searchParams.set('retmode', 'json');
    searchUrl.searchParams.set('tool', 'VetIOS');
    if (options.email) searchUrl.searchParams.set('email', options.email);

    const response = await fetcher(searchUrl.toString(), { cache: 'no-store' });
    if (!response.ok) return [];
    const payload = await response.json() as PmcSearchPayload;
    const pmcids = payload.esearchresult?.idlist ?? [];
    const figureGroups = await Promise.all(pmcids.map((pmcid) => fetchPmcOaFigures(pmcid, options)));
    return figureGroups.flat().slice(0, options.retmax ?? 10);
}

async function fetchPmcOaFigures(pmcid: string, options: PMCFigureResolverOptions): Promise<PMCFigure[]> {
    const fetcher = options.fetchImpl ?? fetch;
    const oaUrl = new URL('https://www.ncbi.nlm.nih.gov/pmc/utils/oa/oa.fcgi');
    oaUrl.searchParams.set('id', pmcid.startsWith('PMC') ? pmcid : `PMC${pmcid}`);
    if (options.email) oaUrl.searchParams.set('email', options.email);

    const response = await fetcher(oaUrl.toString(), { cache: 'no-store' });
    if (!response.ok) return [];
    const xml = await response.text();
    const license = readXmlAttr(xml, 'license') ?? 'PMC Open Access';
    const doi = readXmlAttr(xml, 'doi') ?? '';
    const pmid = readXmlAttr(xml, 'pmid') ?? '';
    const normalizedPmcid = readXmlAttr(xml, 'id') ?? (pmcid.startsWith('PMC') ? pmcid : `PMC${pmcid}`);
    const articleTitle = readXmlTag(xml, 'title') ?? `PMC ${normalizedPmcid}`;
    const journal = readXmlTag(xml, 'journal') ?? 'PubMed Central';
    const year = Number((readXmlTag(xml, 'year') ?? '').match(/\d{4}/)?.[0] ?? 0);
    const links = Array.from(xml.matchAll(/<link\b[^>]*href="([^"]+)"[^>]*>/gi))
        .map((match) => match[1])
        .filter((href): href is string => Boolean(href));
    const imageLinks = links.filter((href) => /\.(?:jpg|jpeg|png|tif|tiff)(?:$|\?)/i.test(href));

    return imageLinks.slice(0, 4).map((href, index) => ({
        pmcid: normalizedPmcid,
        pmid,
        doi,
        article_title: articleTitle,
        journal,
        pub_year: year,
        figure_url: absolutizePmcUrl(href),
        figure_caption: `Open-access figure ${index + 1} from ${articleTitle}`,
        license,
        pubmed_url: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : '',
    }));
}

function readXmlAttr(xml: string, attr: string) {
    const match = xml.match(new RegExp(`\\b${attr}="([^"]+)"`, 'i'));
    return match?.[1] ?? null;
}

function readXmlTag(xml: string, tag: string) {
    const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, 'i'));
    return match?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
}

function absolutizePmcUrl(href: string) {
    if (/^https?:\/\//i.test(href)) return href;
    if (href.startsWith('/')) return `https://www.ncbi.nlm.nih.gov${href}`;
    return `https://www.ncbi.nlm.nih.gov/pmc/${href}`;
}
