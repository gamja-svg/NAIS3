import { create } from 'zustand'

/**
 * [custom] 조각의 네거 짝 — 조각 id → 네거 조각 id, 그리고 네거 짝을 붙이지 않는 씬.
 * 붙이는 일 자체는 뽑을 때 메인 프로세스가 한다. 여기는 지정·확인용.
 */
interface FragmentNegativeState {
  pairs: Record<number, number>
  offScenes: number[]
  hydrate: () => Promise<void>
  /** negativeId null = 짝 없애기 */
  setPair: (fragmentId: number, negativeId: number | null) => Promise<void>
  setSceneOff: (sceneId: number, off: boolean) => Promise<void>
}

export const useFragmentNegativeStore = create<FragmentNegativeState>((set, get) => ({
  pairs: {},
  offScenes: [],
  hydrate: async () => {
    try {
      set(await window.nais.invoke('custom:fragmentNegatives', undefined))
    } catch {
      // 없어도 화면은 뜬다
    }
  },
  setPair: async (fragmentId, negativeId) => {
    const pairs = { ...get().pairs }
    if (negativeId == null || negativeId === fragmentId) delete pairs[fragmentId]
    else pairs[fragmentId] = negativeId
    set({ pairs })
    await window.nais.invoke('custom:fragmentNegativeSet', { fragmentId, negativeId })
  },
  setSceneOff: async (sceneId, off) => {
    const rest = get().offScenes.filter((id) => id !== sceneId)
    set({ offScenes: off ? [...rest, sceneId] : rest })
    await window.nais.invoke('custom:sceneNegativeOff', { id: sceneId, off })
  }
}))
