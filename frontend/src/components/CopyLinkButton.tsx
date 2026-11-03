import { useState } from 'react'

async function copyText(text: string): Promise<boolean> {
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard?.writeText !== undefined
    ) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the legacy path below.
  }
  try {
    if (typeof document === 'undefined') return false
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

interface CopyLinkButtonProps {
  /** Validated URL to copy, or null when the catalog provided none. */
  url: string | null
  /** Dataset title for the accessible button name. */
  itemLabel: string
}

/**
 * Copy-link button with inline success/failure feedback. The feedback message
 * persists until the next copy attempt — no timers, nothing announced twice.
 */
function CopyLinkButton({ url, itemLabel }: CopyLinkButtonProps) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')

  if (url === null) {
    return (
      <span className="copy-link">
        <button
          type="button"
          className="secondary small"
          disabled
          title="No link available to copy"
        >
          Copy link
        </button>
      </span>
    )
  }

  async function handleCopy() {
    setStatus('idle')
    setStatus((await copyText(url)) ? 'copied' : 'failed')
  }

  return (
    <span className="copy-link">
      <button
        type="button"
        className="secondary small"
        onClick={() => void handleCopy()}
        aria-label={`Copy link to ${itemLabel}`}
      >
        Copy link
      </button>
      {status !== 'idle' && (
        <span className={`copy-feedback ${status}`} role="status">
          {status === 'copied'
            ? 'Link copied.'
            : 'Copy failed — copy the address manually.'}
        </span>
      )}
    </span>
  )
}

export default CopyLinkButton
