import { Routes, Route } from 'react-router-dom'

function Home() {
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h1>Shepherd My Sheep</h1>
      <p>Running on Web (React + TypeScript)</p>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
    </Routes>
  )
}
