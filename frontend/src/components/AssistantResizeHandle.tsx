import { useCallback, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ASSISTANT_MIN_WIDTH } from '../state/workspaceReducer'

interface ResizeHandleProps {
  width: number
  maxWidth: number
  onChange: (width: number) => void
}

const KEYBOARD_STEP = 20
const KEYBOARD_LARGE_STEP = 60

/**
 * Visible drag handle on the assistant panel edge. Pointer drags resize
 * continuously; keyboard arrows resize in steps (Shift for larger steps,
 * Home/End for min/max). Hidden on stacked narrow layouts via CSS.
 */
function AssistantResizeHandle({ width, maxWidth, onChange }: ResizeHandleProps) {
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  const clamp = useCallback(
    (next: number) =>
      Math.min(maxWidth, Math.max(ASSISTANT_MIN_WIDTH, Math.round(next))),
    [maxWidth],
  )

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? KEYBOARD_LARGE_STEP : KEYBOARD_STEP
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      onChange(clamp(width + step))
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      onChange(clamp(width - step))
    } else if (event.key === 'Home') {
      event.preventDefault()
      onChange(ASSISTANT_MIN_WIDTH)
    } else if (event.key === 'End') {
      event.preventDefault()
      onChange(maxWidth)
    }
  }

  return (
    <div
      className="assistant-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize assistant panel"
      aria-valuenow={Math.round(width)}
      aria-valuemin={ASSISTANT_MIN_WIDTH}
      aria-valuemax={Math.round(maxWidth)}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        // Only the primary button starts a drag.
        if (event.button !== 0) return
        startXRef.current = event.clientX
        startWidthRef.current = width
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        const delta = startXRef.current - event.clientX
        onChange(clamp(startWidthRef.current + delta))
      }}
    >
      <span className="assistant-resize-grip" aria-hidden="true" />
    </div>
  )
}

export default AssistantResizeHandle
