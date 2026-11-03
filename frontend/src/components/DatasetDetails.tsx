import { useState } from 'react'
import type { ReactNode } from 'react'
import type { LiveRecord } from '../services/api'
import { authoritativeLinks } from '../utils/datasetLinks'
import CopyLinkButton from './CopyLinkButton'

export function ExternalLink({
  href,
  children,
}: {
  href: string
  children: ReactNode
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  const shown =
    value === null || value === undefined || value === '' ? (
      <span className="not-provided">Not provided</span>
    ) : (
      value
    )
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>{shown}</dd>
    </div>
  )
}

function TechnicalMetadata({ raw }: { raw: Record<string, unknown> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="tech-metadata">
      <button
        type="button"
        className="secondary small"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Hide technical metadata' : 'Technical metadata'}
      </button>
      {open && (
        <pre className="raw-json">{JSON.stringify(raw, null, 2)}</pre>
      )}
    </div>
  )
}

/**
 * Full metadata sections shared by every View-details surface (cards,
 * collection review, recipe datasets). Link rows distinguish the source page,
 * the service endpoint, and the download file; each available link gets a
 * Copy button, and missing links say so instead of inventing a URL.
 */
export function DatasetDetailSections({ record }: { record: LiveRecord }) {
  const links = authoritativeLinks(record)
  const title = record.title ?? 'this dataset'
  return (
    <>
      <section className="detail-section" aria-label="Overview">
        <h5>Overview</h5>
        <dl>
          <DetailRow label="Summary" value={record.summary} />
          <DetailRow label="Description" value={record.description} />
        </dl>
      </section>
      <section className="detail-section" aria-label="Source and access">
        <h5>Source and access</h5>
        <dl>
          <DetailRow label="Publisher" value={record.organization_name} />
          <DetailRow label="Portal" value={record.portal_name} />
          <DetailRow
            label="Source page"
            value={
              links.sourcePage ? (
                <span className="detail-link">
                  <ExternalLink href={links.sourcePage}>
                    Open source page
                  </ExternalLink>{' '}
                  <CopyLinkButton url={links.sourcePage} itemLabel={title} />
                </span>
              ) : undefined
            }
          />
          <DetailRow
            label="Service endpoint"
            value={
              links.serviceEndpoint ? (
                <span className="detail-link">
                  <ExternalLink href={links.serviceEndpoint}>
                    Open service endpoint
                  </ExternalLink>{' '}
                  <CopyLinkButton
                    url={links.serviceEndpoint}
                    itemLabel={title}
                  />
                </span>
              ) : undefined
            }
          />
          <DetailRow
            label="Download"
            value={
              links.download ? (
                <span className="detail-link">
                  <ExternalLink href={links.download}>
                    Open download
                  </ExternalLink>{' '}
                  <CopyLinkButton url={links.download} itemLabel={title} />
                </span>
              ) : undefined
            }
          />
        </dl>
      </section>
      <section className="detail-section" aria-label="Coverage and updates">
        <h5>Coverage and updates</h5>
        <dl>
          <DetailRow
            label="Temporal coverage"
            value={record.temporal_range}
          />
          <DetailRow label="Record modified" value={record.modified_date} />
          <DetailRow label="Record updated" value={record.update_date} />
        </dl>
      </section>
      <section className="detail-section" aria-label="Structure">
        <h5>Structure</h5>
        <dl>
          <DetailRow label="Type" value={record.item_type} />
          <DetailRow
            label="Layers"
            value={record.layer_names?.join(', ')}
          />
          <DetailRow
            label="Coordinate system"
            value={record.coordinate_system}
          />
        </dl>
      </section>
      <section className="detail-section" aria-label="Limitations">
        <h5>Limitations</h5>
        <dl>
          <DetailRow
            label="Use limitations"
            value={record.use_limitations}
          />
          <DetailRow
            label="Access constraints"
            value={record.access_constraints}
          />
        </dl>
      </section>
      <TechnicalMetadata raw={record.raw} />
    </>
  )
}
