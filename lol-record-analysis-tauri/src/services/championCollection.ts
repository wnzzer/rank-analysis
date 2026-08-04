import { invoke } from '@tauri-apps/api/core'
import type {
  ChampionCollection,
  OwnedChromaCollection
} from '@renderer/types/domain/championCollection'

export function getChampionCollection(): Promise<ChampionCollection> {
  return invoke<ChampionCollection>('get_champion_collection')
}

export function getOwnedChromas(): Promise<OwnedChromaCollection> {
  return invoke<OwnedChromaCollection>('get_owned_chromas')
}
