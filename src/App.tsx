import { lazy, Suspense, useEffect, useState } from 'react'
import { IptvApp } from './iptv/IptvApp'

const GuideApp = lazy(() => import('./guide/GuideApp'))

function isGuideRoute() {
  return location.hash.startsWith('#/grade')
}

function App() {
  const [guide, setGuide] = useState(isGuideRoute)

  useEffect(() => {
    const onHash = () => setGuide(isGuideRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (guide) {
    return (
      <Suspense fallback={null}>
        <a className="back-to-player" href="#/live">
          ← Voltar ao player IPTV
        </a>
        <GuideApp />
      </Suspense>
    )
  }
  return <IptvApp />
}

export default App
