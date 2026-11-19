import { create } from 'zustand'
import { autoFolders, folderOrder, joinOrder, moveInFolders } from '../lib/custom-preset-folders'
import { useScenesStore } from './scenes-store'

/**
 * [custom] 씬 프리셋 폴더 — 프리셋 목록을 묶어 본다.
 * 폴더는 프리셋에 붙는 이름표(DB)이고, 접어 둔 폴더는 설정에 남긴다. 폴더가 바뀌면 프리셋 순서를
 * 목록에 보이는 순서(묶음째)로 맞춰 둔다 — 그래야 ↑/↓ 프리셋 넘기기가 보이는 순서대로 간다.
 */
const COLLAPSED_KEY = 'custom_preset_folders_collapsed'

interface PresetFolderState {
  /** 프리셋 id → 폴더 이름 */
  folders: Record<number, string>
  /** 접어 둔 폴더 이름 */
  collapsed: string[]
  hydrate: () => Promise<void>
  /** 프리셋들을 폴더에 넣는다 (folder가 null이면 뺀다) */
  setFolder: (presetIds: number[], folder: string | null) => Promise<void>
  rename: (from: string, to: string) => Promise<void>
  toggle: (folder: string) => void
  /** 한 칸 옮기기 — 프리셋 id(폴더 안에서는 그 안에서만) 또는 폴더 이름(묶음째) */
  move: (target: number | string, dir: -1 | 1) => Promise<void>
  /** 끌어서 바꾼 순서를 받아, 폴더 묶음이 흩어지지 않게 맞춰 저장한다 */
  reorder: (ids: number[]) => Promise<void>
  /** 이름의 첫 낱말이 같은 프리셋끼리 폴더로 묶는다. 묶은 프리셋 수를 돌려준다 */
  autoGroup: () => Promise<number>
}

export const usePresetFolderStore = create<PresetFolderState>((set, get) => {
  /** 폴더를 다시 읽고, 프리셋 순서를 묶음 순서로 맞춘다 */
  const refresh = async (): Promise<void> => {
    const { folders } = await window.nais.invoke('custom:presetFolders', undefined)
    set({ folders })
    const scenes = useScenesStore.getState()
    const ids = folderOrder(scenes.presets, folders)
    if (ids.some((id, i) => id !== scenes.presets[i]?.id)) await scenes.reorderPresets(ids)
  }
  const saveCollapsed = (collapsed: string[]): void => {
    set({ collapsed })
    void window.nais.invoke('settings:set', {
      key: COLLAPSED_KEY,
      value: JSON.stringify(collapsed)
    })
  }
  return {
    folders: {},
    collapsed: [],
    hydrate: async () => {
      const [{ folders }, setting] = await Promise.all([
        window.nais.invoke('custom:presetFolders', undefined),
        window.nais.invoke('settings:get', { key: COLLAPSED_KEY })
      ])
      let collapsed: string[] = []
      try {
        const parsed: unknown = JSON.parse(setting.value ?? '[]')
        if (Array.isArray(parsed)) collapsed = parsed.filter((v) => typeof v === 'string')
      } catch {
        // 깨진 값이면 다 펼친다
      }
      set({ folders, collapsed })
    },
    setFolder: async (presetIds, folder) => {
      const name = folder?.replace(/\s+/g, ' ').trim()
      if (name) {
        // 폴더가 프리셋 자리로 끌려오지 않게, 넣는 프리셋을 먼저 그 폴더 끝으로 보낸다
        const scenes = useScenesStore.getState()
        const ids = joinOrder(scenes.presets, get().folders, presetIds, name)
        if (ids.some((id, i) => id !== scenes.presets[i]?.id)) await scenes.reorderPresets(ids)
      }
      await window.nais.invoke('custom:presetFolderSet', { presetIds, folder })
      await refresh()
    },
    rename: async (from, to) => {
      const name = to.replace(/\s+/g, ' ').trim()
      if (!name || name === from) return
      await window.nais.invoke('custom:presetFolderRename', { from, to: name })
      if (get().collapsed.includes(from))
        saveCollapsed(get().collapsed.map((f) => (f === from ? name : f)))
      await refresh()
    },
    toggle: (folder) => {
      const { collapsed } = get()
      saveCollapsed(
        collapsed.includes(folder) ? collapsed.filter((f) => f !== folder) : [...collapsed, folder]
      )
    },
    move: async (target, dir) => {
      const scenes = useScenesStore.getState()
      const ids = moveInFolders(scenes.presets, get().folders, target, dir)
      if (ids) await scenes.reorderPresets(ids)
    },
    reorder: async (ids) => {
      const scenes = useScenesStore.getState()
      const byId = new Map(scenes.presets.map((p) => [p.id, p]))
      const dragged = ids.map((id) => byId.get(id)).filter((p) => p !== undefined)
      await scenes.reorderPresets(folderOrder(dragged, get().folders))
    },
    autoGroup: async () => {
      const groups = autoFolders(useScenesStore.getState().presets, get().folders)
      let count = 0
      for (const [folder, presetIds] of Object.entries(groups)) {
        await get().setFolder(presetIds, folder)
        count += presetIds.length
      }
      return count
    }
  }
})
