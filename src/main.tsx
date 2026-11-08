import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
// Inter, self-hosted and bundled, replacing a render-blocking @import to
// fonts.googleapis.com — a third-party request on a site that is otherwise
// entirely static. The weight-axis variable font covers 400-700 in one file
// per subset, and `unicode-range` means a browser fetches only the subset it
// needs (~48 kB for latin) however many are emitted.
import '@fontsource-variable/inter/wght.css'
// The display face for verdicts and figures (#120), self-hosted the same way.
import '@fontsource-variable/plus-jakarta-sans/wght.css'
import './index.css'
import App from './App.tsx'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // These upstreams are public and rate-limited by IP; refetching on every
      // window focus buys nothing when values move on a daily cadence.
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
      // How long a league nobody is looking at stays in memory (#161).
      // react-query's default is 5 minutes, after which switching back to a
      // league reloads it from scratch: 21 requests, and every derived number
      // recomputed. Half an hour covers going back and forth between leagues
      // on a Sunday, and a stale league still refreshes in the background.
      gcTime: 30 * 60 * 1000,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
