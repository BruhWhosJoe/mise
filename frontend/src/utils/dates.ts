/**
 * Human-readable record dates for cards. Falls back to the exact value
 * (never blank) when parsing fails; details always show the exact value.
 */
export function formatRecordDate(value: string | null): string | null {
  if (value === null) return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return trimmed
  return parsed.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
