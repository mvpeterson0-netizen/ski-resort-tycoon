import { useState } from 'react'
import { beginSeason, newGame, regionById, setDifficulty, siteById, type GameState, type Parcel, type Region, type Site } from './sim'
import { BuildScreen } from './ui/Build'
import { SeasonScreen } from './ui/Season'
import { SettingsScreen } from './ui/Settings'
import { BankruptScreen, FinanceScreen, YearEndScreen } from './ui/Finance'
import { MapView } from './ui/MapView'
import { ParcelPicker, ResortMap } from './ui/ParcelMap'
import { PurchaseScreen, ResortHome } from './ui/Purchase'
import { RegionPicker, SiteDetail, SitePicker, TitleScreen } from './ui/Screens'
import { clearGame, loadDefaultDifficulty, loadGame, saveDefaultDifficulty, saveGame } from './ui/storage'

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
  | { screen: 'finance' }
  | { screen: 'report' }
  | { screen: 'settings'; back: 'title' | 'home' }

export default function App() {
  const [nav, setNav] = useState<Nav>({ screen: 'title' })
  const [game, setGame] = useState<GameState | null>(() => loadGame())

  const persist = (g: GameState) => { saveGame(g); setGame(g) }

  // A bankrupt resort can only be reviewed and restarted.
  if (game?.bankrupt && ['home', 'build', 'finance', 'resortMap'].includes(nav.screen)) {
    return (
      <BankruptScreen
        game={game}
        onNewGame={() => { clearGame(); setGame(null); setNav({ screen: 'regions' }) }}
      />
    )
  }

  switch (nav.screen) {
    case 'title':
      return (
        <TitleScreen
          canContinue={!!game}
          onContinue={() => setNav({ screen: 'home' })}
          onSettings={() => setNav({ screen: 'settings', back: 'title' })}
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
            const g = newGame(nav.site.id, plan, Date.now(), nav.parcel?.id, loadDefaultDifficulty())
            saveGame(g)
            setGame(g)
            setNav({ screen: 'home' })
          }}
        />
      )
    case 'home':
      if (!game) return <TitleScreen canContinue={false} onContinue={() => {}} onSettings={() => setNav({ screen: 'settings', back: 'title' })} onNew={() => setNav({ screen: 'regions' })} />
      return (
        <ResortHome
          game={game}
          onMap={() => setNav({ screen: 'resortMap' })}
          onBuild={() => setNav({ screen: 'build' })}
          onSettings={() => setNav({ screen: 'settings', back: 'home' })}
          onFinance={() => setNav({ screen: 'finance' })}
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
    case 'settings':
      return (
        <SettingsScreen
          difficulty={game?.difficulty ?? loadDefaultDifficulty()}
          inGame={!!game}
          onChange={(d) => {
            saveDefaultDifficulty(d)
            if (game) {
              const g = setDifficulty(game, d)
              saveGame(g)
              setGame(g)
            } else {
              setNav({ ...nav }) // re-render with the new defaults
            }
          }}
          onBack={() => setNav({ screen: game && nav.back === 'home' ? 'home' : 'title' })}
        />
      )
    case 'season':
      if (!game) return null
      return (
        game.phase === 'season' ? (
          <SeasonScreen game={game} onChange={persist} onExit={() => setNav({ screen: 'home' })} />
        ) : (
          <YearEndScreen game={game} onContinue={() => setNav({ screen: 'home' })} />
        )
      )
    case 'finance':
      if (!game) return null
      return (
        <FinanceScreen
          game={game}
          onChange={persist}
          onReport={() => setNav({ screen: 'report' })}
          onBack={() => setNav({ screen: 'home' })}
        />
      )
    case 'report':
      if (!game || !game.reports.length) return null
      return <YearEndScreen game={game} onContinue={() => setNav({ screen: 'finance' })} />
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
