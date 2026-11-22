/**
 * Shared setup for screens that draw the resort on the painted map (home and build):
 * roads, sprites, the base village layout and the forest with clearings for what's built.
 */
import { useMemo } from 'react'
import type { GameState, Terrain } from '../../sim'
import { paintTreeLayer, plantTrees } from './art'
import type { ResortScene } from './drawResort'
import { clearTrees, useRoads, useSprites, villageFrame, villageItems } from './layout'

export function useResortScene(terrainId: string, game: GameState, t: Terrain | null) {
  const roads = useRoads(terrainId)
  const sprites = useSprites()
  const frame = useMemo(() => (t && game.base ? villageFrame(t, game.base) : null), [t, game.base])
  const vi = useMemo(() => (t && frame ? villageItems(t, frame, game.amenities, game.lifts) : null), [t, frame, game.amenities, game.lifts])
  const trees = useMemo(() => (t ? plantTrees(t) : null), [t])
  const layer = useMemo(() => (t && trees ? paintTreeLayer(t, trees) : null), [t, trees])
  const kept = useMemo(() => (t && trees && roads
    ? clearTrees(t, trees, roads, game.trails, game.lifts, frame && vi ? { F: frame, ...vi, parking: game.amenities.parking } : null)
    : null), [t, trees, roads, game.trails, game.lifts, frame, vi, game.amenities.parking])
  const ready = !!(t && layer && kept && sprites && roads)

  /** The scene to hand to drawResortScene, or null while assets load. */
  const scene = (fullness: number, selected?: ResortScene['selected']): ResortScene | null =>
    ready
      ? {
          t: t!, roads: roads!, trails: game.trails, lifts: game.lifts, amenities: game.amenities,
          village: frame && vi ? { F: frame, ...vi } : null, forest: { layer: layer!, kept: kept! }, sprites: sprites!,
          fullness, selected,
        }
      : null

  return { roads, sprites, frame, vi, ready, scene }
}
