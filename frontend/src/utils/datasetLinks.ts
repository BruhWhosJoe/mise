import { isHttpUrl } from '../services/api'

/**
 * Anything carrying the authoritative metadata URLs: a full LiveRecord or a
 * recipe dataset reference. URLs come from the backend's normalized catalog
 * metadata (stage B snapshot enrichment) — never manufactured here.
 */
export interface DatasetLinkSource {
  access_url: string | null
  service_endpoint_url?: string | null
  download_url?: string | null
}

/** Validated http(s) links, or null where the catalog gave us nothing usable. */
export interface AuthoritativeLinks {
  sourcePage: string | null
  serviceEndpoint: string | null
  download: string | null
}

function validated(value: string | null | undefined): string | null {
  return typeof value === 'string' && isHttpUrl(value) ? value : null
}

/** Keep only real http(s) URLs; missing or non-http values become null. */
export function authoritativeLinks(
  source: DatasetLinkSource,
): AuthoritativeLinks {
  return {
    sourcePage: validated(source.access_url),
    serviceEndpoint: validated(source.service_endpoint_url ?? null),
    download: validated(source.download_url ?? null),
  }
}

/** The single link Copy-link shares: source page first, then endpoint, file. */
export function preferredShareLink(links: AuthoritativeLinks): string | null {
  return links.sourcePage ?? links.serviceEndpoint ?? links.download
}

export function hasAnyLink(links: AuthoritativeLinks): boolean {
  return preferredShareLink(links) !== null
}
