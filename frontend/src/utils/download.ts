/** Download in-memory text as a file (used for JSON/Markdown exports). */
export function downloadTextFile(
  filename: string,
  text: string,
  mime: string,
): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
