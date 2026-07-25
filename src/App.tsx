const phases = [
  { name: 'League import', detail: 'Paste a Sleeper league ID, see every roster', done: false },
  { name: 'Trade calculator', detail: 'League-aware values, including draft picks', done: false },
  { name: 'Team analysis', detail: 'Strengths, weaknesses, contention window', done: false },
  { name: 'Trade suggestions', detail: 'Ranked offers, and why they say yes', done: false },
]

function App() {
  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-2xl px-6 py-20">
        <p className="text-sm font-semibold uppercase tracking-widest text-primary-600">
          Dynasty Fantasy Football
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
          A trade calculator that knows your league
        </h1>
        <p className="mt-5 text-lg text-gray-600">
          Generic calculators tell you two players are worth the same. This one knows your
          roster, your lineup, and the eleven managers you actually play against.
        </p>

        <div className="card mt-12">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Under construction
          </h2>
          <ul className="mt-4 space-y-4">
            {phases.map((phase) => (
              <li key={phase.name} className="flex gap-3">
                <span
                  className="mt-2 h-2 w-2 shrink-0 rounded-full bg-gray-300"
                  aria-hidden="true"
                />
                <div>
                  <p className="font-medium">{phase.name}</p>
                  <p className="text-sm text-gray-600">{phase.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-8 text-sm text-gray-500">
          Powered by the Sleeper, FantasyCalc, and DynastyProcess APIs.
        </p>
      </div>
    </main>
  )
}

export default App
