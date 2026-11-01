import { useState } from 'react'
import './App.css'

function App() {
  const [question, setQuestion] = useState('')

  return (
    <main>
      <p>GOVERNMENT OPEN DATA DISCOVERY</p>
      <h1>MetaFabric</h1>
      <p>Turn a question into a plan with the right public data.</p>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          alert(`Your question: ${question}`)
        }}
      >
        <label htmlFor="question">What would you like to investigate?</label>

        <textarea
          id="question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Which datasets could help me study pedestrian safety near schools?"
          rows={4}
          required
          style={{
            display: 'block',
            width: '100%',
            boxSizing: 'border-box',
            margin: '16px 0',
            padding: '12px',
            font: 'inherit',
          }}
        />

        <button type="submit">Discover datasets</button>
      </form>

      <p>Prototype: dataset discovery is not connected yet.</p>
    </main>
  )
}

export default App
