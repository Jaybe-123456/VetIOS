export const dynamic = 'force-dynamic';

export default function DeveloperVersioningPage() {
    return (
        <div className="space-y-6">
            <div className="space-y-3">
                <p className="text-sm uppercase tracking-[0.32em] text-teal-700">API Versioning</p>
                <h1 className="text-3xl font-semibold text-slate-950">VetIOS versioning and deprecation policy</h1>
            </div>

            <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                <p className="text-sm text-slate-700">
                    VetIOS uses URI versioning. Public developer routes are published under <code>/api/v1</code>. New
                    major versions receive new base paths, and previous versions remain supported for at least 12 months
                    after a successor release unless a clinical safety issue requires a shorter remediation window.
                </p>
                <ul className="mt-5 space-y-2 text-sm text-slate-700">
                    <li>• Every response includes <code>API-Version</code> and <code>API-Supported-Versions</code> headers.</li>
                    <li>• Deprecated versions add <code>Deprecation</code>, <code>Sunset</code>, and migration link headers.</li>
                    <li>• Breaking changes are announced on the developer changelog and RSS feed before rollout.</li>
                </ul>
            </section>
        </div>
    );
}
