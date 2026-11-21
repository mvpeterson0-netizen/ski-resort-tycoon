import { useState } from 'react'
import { newGame, regionById, siteById, type GameState, type Region, type Site } from './sim'
import { MapView } from './ui/MapView'
import { PurchaseScreen, ResortHome } from './ui/Purchase'
import { RegionPicker, SiteDetail, SitePicker, TitleScreen } from './ui/Screens'
import { clearGame, loadGame, saveGame } from './ui/storage'

type Nav =
  | { screen: 'title' }
  | { screen: 'regions' }
  | { screen: 'sites'; region: Region }
  | { screen: 'site'; region: Region; site: Site }
  | { screen: 'map'; region: Region; site: Site }
  | { screen: 'buy'; region: Region; site: Site }
  | { screen: 'home' }
  | { screen: 'resortMap' }

export default function App() {
  const [nav, setNav] = useState<Nav>({ screen: 'title' })
  const [game, setGame] = useState<GameState | null>(() => loadGame())

  switch (nav.screen) {
    case 'title':
      return (
        <TitleScreen
          canContinue={!!game}
          onContinue={() => setNav({ screen: 'home' })}
          onNew={() => {
            if (game && !window.confirm('Start a new game? Your current resort will be lost.')) return
            setNav({ screen: 'regions' })
          }}
        />
      )
    case 'regions':
      return (
        <RegionPicker
          onPick={(region) => setNav({ screen: 'sites', region })}
          onBack={() => setNav({ screen: 'title' })}
        />
      )
    case 'sites':
      return (
        <SitePicker
          region={nav.region}
          onPick={(site) => setNav({ screen: 'site', region: nav.region, site })}
          onBack={() => setNav({ screen: 'regions' })}
        />
      )
    case 'site':
      return (
        <SiteDetail
          site={nav.site}
          region={nav.region}
          onBack={() => setNav({ screen: 'sites', region: nav.region })}
          onMap={() => setNav({ ...nav, screen: 'map' })}
          onBuy={() => setNav({ ...nav, screen: 'buy' })}
        />
      )
    case 'map':
      return <MapView terrainId={nav.site.terrainId!} onBack={() => setNav({ ...nav, screen: 'site' })} />
    case 'buy':
      return (
        <PurchaseScreen
          site={nav.site}
          region={nav.region}
          onBack={() => setNav({ ...nav, screen: 'site' })}
          onBuy={(plan) => {
            clearGame()
            // Seed from the clock once at game creation; everything after is deterministic.
            const g = newGame(nav.site.id, plan, Date.now())
            saveGame(g)
            setGame(g)
            setNav({ screen: 'home' })
          }}
        />
      )
    case 'home':
      if (!game) return <TitleScreen canContinue={false} onContinue={() => {}} onNew={() => setNav({ screen: 'regions' })} />
      return (
        <ResortHome
          game={game}
          onMap={() => setNav({ screen: 'resortMap' })}
          onQuit={() => setNav({ screen: 'title' })}
        />
      )
    case 'resortMap': {
      const site = game && siteById(game.siteId)
      if (!site?.terrainId || !regionById(site.regionId)) return null
      return <MapView terrainId={site.terrainId} backLabel="Back to resort" onBack={() => setNav({ screen: 'home' })} />
    }
  }
}
