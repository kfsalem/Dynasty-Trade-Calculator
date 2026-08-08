import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
// Inter, self-hosted and bundled, replacing a render-blocking @import to
// fonts.googleapis.com — a third-party request on a site that is otherwise
// entirely static. The weight-axis variable font covers 400-700 in one file
// per subset, and `unicode-range` means a browser fetches only the subset it
// needs (~48 kB for latin) however many are emitted.
import '@fontsource-variable/inter/wght.css'
import './index.css'
import App from './App.tsx'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // These upstreams are public and rate-limited by IP; refetching on every
      // window focus buys nothing when values move on a daily cadence.
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
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
