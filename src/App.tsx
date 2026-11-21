import { useState } from 'react'
import type { Region, Site } from './sim'
import { MapView } from './ui/MapView'
import { RegionPicker, SiteDetail, SitePicker, TitleScreen } from './ui/Screens'

type Nav =
  | { screen: 'title' }
  | { screen: 'regions' }
  | { screen: 'sites'; region: Region }
  | { screen: 'site'; region: Region; site: Site }
  | { screen: 'map'; region: Region; site: Site }

export default function App() {
  const [nav, setNav] = useState<Nav>({ screen: 'title' })
  switch (nav.screen) {
    case 'title':
      return <TitleScreen onNew={() => setNav({ screen: 'regions' })} />
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
          onBack={() => setNav({ screen: 'sites', region: nav.region })}
          onMap={() => setNav({ ...nav, screen: 'map' })}
        />
      )
    case 'map':
      return <MapView terrainId={nav.site.terrainId!} onBack={() => setNav({ ...nav, screen: 'site' })} />
  }
}
