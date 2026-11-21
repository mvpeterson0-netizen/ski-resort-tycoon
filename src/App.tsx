import { useState } from 'react'
import { beginSeason, newGame, regionById, siteById, type GameState, type Parcel, type Region, type Site } from './sim'
import { BuildScreen } from './ui/Build'
import { SeasonScreen } from './ui/Season'
import { MapView } from './ui/MapView'
import { ParcelPicker, ResortMap } from './ui/ParcelMap'
import { PurchaseScreen, ResortHome } from './ui/Purchase'
import { RegionPicker, SiteDetail, SitePicker, TitleScreen } from './ui/Screens'
import { clearGame, loadGame, saveGame } from './ui/storage'

type Nav =
  | { screen: 'title' }
  | { screen: 'regions' }
  | { screen: 'sites'; region: Region }
  | { screen: 'site'; region: Region; site: Site }
  | { screen: 'map'; region: Region; site: Site }
  | { screen: 'parcels'; region: Region; site: Site }
  | { screen: 'buy'; region: Region; site: Site; parcel?: Parcel }
  | { screen: 'home' }
  | { screen: 'resortMap' }
  | { screen: 'build' }
  | { screen: 'season' }

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
          onBuy={() => setNav({ ...nav, screen: nav.site.terrainId ? 'parcels' : 'buy' })}
        />
      )
    case 'map':
      return <MapView terrainId={nav.site.terrainId!} onBack={() => setNav({ ...nav, screen: 'site' })} />
    case 'parcels':
      return (
        <ParcelPicker
          site={nav.site}
          region={nav.region}
          onBack={() => setNav({ ...nav, screen: 'site' })}
          onChoose={(parcel) => setNav({ ...nav, screen: 'buy', parcel })}
        />
      )
    case 'buy':
      return (
        <PurchaseScreen
          site={nav.site}
          region={nav.region}
          parcel={nav.parcel}
          onBack={() => setNav({ screen: nav.parcel ? 'parcels' : 'site', region: nav.region, site: nav.site })}
          onBuy={(plan) => {
            clearGame()
            // Seed from the clock once at game creation; everything after is deterministic.
            const g = newGame(nav.site.id, plan, Date.now(), nav.parcel?.id)
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
          onBuild={() => setNav({ screen: 'build' })}
          onSeason={() => {
            if (game.phase !== 'season') {
              const site = siteById(game.siteId)!
              const g = beginSeason(game, site)
              saveGame(g)
              setGame(g)
            }
            setNav({ screen: 'season' })
          }}
          onQuit={() => setNav({ screen: 'title' })}
        />
      )
    case 'season':
      if (!game) return null
      return (
        <SeasonScreen
          game={game}
          onChange={(g) => { saveGame(g); setGame(g) }}
          onExit={() => setNav({ screen: 'home' })}
        />
      )
    case 'build':
      if (!game) return null
      return (
        <BuildScreen
          game={game}
          onChange={(g) => { saveGame(g); setGame(g) }}
          onBack={() => setNav({ screen: 'home' })}
        />
      )
    case 'resortMap': {
      const site = game && siteById(game.siteId)
      if (!game || !site?.terrainId) return null
      if (!game.ownedParcels.length) {
        return <MapView terrainId={site.terrainId} backLabel="Back to resort" onBack={() => setNav({ screen: 'home' })} />
      }
      return <ResortMap site={site} region={regionById(site.regionId)!} owned={game.ownedParcels} onBack={() => setNav({ screen: 'home' })} />
    }
  }
}
