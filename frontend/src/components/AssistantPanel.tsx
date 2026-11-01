interface AssistantPanelProps {
  onCollapse: () => void
}

function AssistantPanel({ onCollapse }: AssistantPanelProps) {
  return (
    <div className="assistant-inner">
      <div className="assistant-header">
        <h2>Assistant</h2>
        <button type="button" className="secondary small" onClick={onCollapse}>
          Hide panel
        </button>
      </div>

      <p className="assistant-status">
        The live assistant is not connected in this demo.
      </p>

      <h3>How MetaFabric works</h3>
      <ol className="assistant-steps">
        <li>
          <strong>Ask a question.</strong> Describe what you want to
          investigate about your community.
        </li>
        <li>
          <strong>Review datasets.</strong> Compare sample datasets and select
          the ones that fit your question.
        </li>
        <li>
          <strong>Build a recipe.</strong> Assemble your selection into a Data
          Recipe that explains how each dataset helps.
        </li>
      </ol>

      <p className="assistant-note">
        Guided help will appear here once the assistant is connected in a
        later stage.
      </p>
    </div>
  )
}

export default AssistantPanel
