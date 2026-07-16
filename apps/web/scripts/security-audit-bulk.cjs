const { spawnSync } = require('node:child_process');

const SEVERITY_ORDER = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

function collectProductionPackages() {
  const pnpmArgs = ['-r', 'list', '--prod', '--json', '--depth', 'Infinity'];
  const useNpmExecPath = Boolean(process.env.npm_execpath);
  const useWindowsShim = process.platform === 'win32' && !useNpmExecPath;
  const command = useNpmExecPath
    ? process.execPath
    : useWindowsShim
      ? process.env.ComSpec || 'cmd.exe'
      : 'pnpm';
  const args = useNpmExecPath
    ? [process.env.npm_execpath, ...pnpmArgs]
    : useWindowsShim
      ? ['/d', '/s', '/c', `pnpm ${pnpmArgs.join(' ')}`]
      : pnpmArgs;
  const result = spawnSync(
    command,
    args,
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    },
  );

  if (result.status !== 0) {
    process.stderr.write(
      result.stderr ||
        result.stdout ||
        `${result.error?.message || 'Unable to enumerate production dependencies.'}\n`,
    );
    process.exit(result.status || 1);
  }

  const workspaces = JSON.parse(result.stdout);
  const versionsByPackage = new Map();

  function visitDependencies(dependencies) {
    if (!dependencies || typeof dependencies !== 'object') return;

    for (const [name, dependency] of Object.entries(dependencies)) {
      if (!dependency || typeof dependency !== 'object') continue;

      const version = dependency.version;
      const resolved = dependency.resolved;
      const isRegistryPackage =
        typeof version === 'string' &&
        !version.startsWith('link:') &&
        !version.startsWith('workspace:') &&
        typeof resolved === 'string' &&
        /^https?:\/\//.test(resolved);

      if (isRegistryPackage) {
        if (!versionsByPackage.has(name)) versionsByPackage.set(name, new Set());
        versionsByPackage.get(name).add(version);
      }

      visitDependencies(dependency.dependencies);
      visitDependencies(dependency.optionalDependencies);
    }
  }

  for (const workspace of workspaces) {
    visitDependencies(workspace.dependencies);
    visitDependencies(workspace.optionalDependencies);
  }

  return Object.fromEntries(
    [...versionsByPackage.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, versions]) => [name, [...versions].sort()]),
  );
}

async function main() {
  const packages = collectProductionPackages();
  const packageCount = Object.keys(packages).length;

  if (packageCount === 0) {
    throw new Error('Production dependency enumeration returned no registry packages.');
  }

  const registry = (process.env.NPM_CONFIG_REGISTRY || 'https://registry.npmjs.org').replace(/\/$/, '');
  const endpoint = `${registry}/-/npm/v1/security/advisories/bulk`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent': 'vetios-security-audit/1.0',
    },
    body: JSON.stringify(packages),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Bulk advisory endpoint returned ${response.status}: ${body.slice(0, 500)}`);
  }

  const report = await response.json();
  const advisories = Object.entries(report).flatMap(([packageName, entries]) =>
    Array.isArray(entries)
      ? entries.map((entry) => ({ ...entry, packageName }))
      : [],
  );
  const thresholdName = (process.env.VETIOS_AUDIT_LEVEL || 'low').toLowerCase();
  const threshold = SEVERITY_ORDER[thresholdName];

  if (threshold === undefined) {
    throw new Error(`Unsupported VETIOS_AUDIT_LEVEL: ${thresholdName}`);
  }

  const blocking = advisories.filter(
    (advisory) => (SEVERITY_ORDER[String(advisory.severity).toLowerCase()] ?? SEVERITY_ORDER.low) >= threshold,
  );

  console.log(`Audited ${packageCount} production packages through npm bulk advisories.`);

  if (advisories.length === 0) {
    console.log('No known production dependency advisories found.');
    return;
  }

  for (const advisory of advisories) {
    console.error(
      `[${String(advisory.severity).toUpperCase()}] ${advisory.packageName}: ${advisory.title} (${advisory.url})`,
    );
  }

  if (blocking.length > 0) {
    throw new Error(
      `${blocking.length} production advisory record(s) meet the ${thresholdName} failure threshold.`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
