// Minimal semantic-version comparison for host-compatibility checks. Pre-release
// tags are ignored (a build satisfies `minHostVersion` on core version match).
export function compareVersions(a: string, b: string): number {
  const pa = core(a)
  const pb = core(b)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  }
  return 0
}

function core(version: string): [number, number, number] {
  const main = version.split('-')[0]
  const parts = main.split('.').map(n => Number.parseInt(n, 10))
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0]
}

/** True when `hostVersion` satisfies the plugin's `minHostVersion` (if any). */
export function hostSatisfiesMinimum(hostVersion: string, minHostVersion?: string): boolean {
  if (!minHostVersion) return true
  return compareVersions(hostVersion, minHostVersion) >= 0
}
