// Default hard bounds for database plugin packages and queries. The validator
// applies stricter per-dataset limits from the manifest when present; these are
// the ceilings a manifest may tighten but never exceed. Mirrors the design
// doc's "Privacy and safety rails" defaults (Story AP-1).

export const DATABASE_PLUGIN_BOUNDS = {
  /** Max compressed archive size. */
  maxCompressedBytes: 256 * 1024 * 1024, // 256 MiB
  /** Max expanded on-disk size. */
  maxExpandedBytes: 1024 * 1024 * 1024, // 1 GiB
  /** Max payload files in one bundle. */
  maxFiles: 100,
  /** Max evidence rows returned from one query. */
  maxResults: 50,
  /** Max transcript characters a single query result may contribute. */
  maxTranscriptChars: 32_000,
  /** Defensive cap on a scalar string parameter length. */
  maxParameterLength: 2_000,
  /** Defensive cap on a search query string length. */
  maxQueryLength: 2_000,
  /** Longest id / version / path string accepted. */
  maxIdentifierLength: 128,
  maxPathLength: 256,
} as const

/** Reverse-DNS-ish plugin id: lowercase segments separated by dots. */
export const PLUGIN_ID_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
/** Simplified semantic version (major.minor.patch with optional pre-release). */
export const PLUGIN_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
/** Dataset / lookup / search / parameter identifiers. */
export const PLUGIN_MEMBER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
/** Citation namespace token. */
export const PLUGIN_NAMESPACE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
/** Lowercase hex sha-256 digest (64 chars). */
export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/
