import { create } from 'zustand'
import type { CharacterCard, FolderGroup, ListFolder } from '@shared/types'
import {
  linksFrom,
  linksTo,
  moveGroupedRow,
  orderFoldersByGroup,
  setFolderGroup,
  type GroupedState,
  type GroupLinks
} from '../lib/custom-folder-groups'
import { canonicalize, toOrderEntries } from '../lib/folder-list'
import { t } from '../lib/i18n'
import { useCharactersStore } from './characters-store'

/**
 * [custom] 캐릭터 프롬프트 상위 폴더 — 상위 폴더 목록과 폴더 소속을 들고 있고,
 * 끌어 놓기를 상위 폴더까지 알고 처리한다. 폴더·카드 자체는 원본 캐릭터 스토어에 있다
 * (여기서는 그 순서만 같이 바꿔 저장한다).
 */
interface FolderGroupsState {
  groups: FolderGroup[]
  links: GroupLinks
  load: () => Promise<void>
  /** 새 상위 폴더 — folderId를 주면 그 폴더를 바로 넣는다 */
  createGroup: (folderId?: number) => Promise<void>
  renameGroup: (id: number, name: string) => void
  toggleGroup: (id: number) => void
  setGroupColor: (id: number, color: string | null) => void
  /** 상위 폴더만 지운다 — 안의 폴더는 상위 폴더 밖으로 나온다 */
  removeGroup: (id: number) => void
  setFolderGroup: (folderId: number, groupId: number | null) => void
  /** 상위 폴더 안에 새 폴더 */
  addFolderToGroup: (groupId: number) => Promise<void>
  move: (activeKey: string, overKey: string) => void
}

function current(groups: FolderGroup[], links: GroupLinks): GroupedState<CharacterCard> {
  const { folders, items } = useCharactersStore.getState()
  return { groups, links, folders, items }
}

/** 바뀐 순서·소속을 두 스토어에 반영하고 저장한다 */
function apply(
  next: GroupedState<CharacterCard>,
  set: (s: Partial<FolderGroupsState>) => void
): void {
  useCharactersStore.setState({ folders: next.folders, items: next.items })
  set({ groups: next.groups, links: next.links })
  void window.nais.invoke('chars:reorder', { order: toOrderEntries(next.folders, next.items) })
  void window.nais.invoke('custom:folderGroups:arrange', {
    kind: 'chars',
    groupIds: next.groups.map((g) => g.id),
    links: linksTo(next.links, next.folders)
  })
}

export const useFolderGroupsStore = create<FolderGroupsState>((set, get) => ({
  groups: [],
  links: new Map(),

  load: async () => {
    const { groups, links } = await window.nais.invoke('custom:folderGroups:list', {
      kind: 'chars'
    })
    set({ groups, links: linksFrom(links) })
  },

  createGroup: async (folderId) => {
    const name = t('ui.customNewFolderGroup')
    const { id } = await window.nais.invoke('custom:folderGroups:create', { kind: 'chars', name })
    set({ groups: [...get().groups, { id, name, collapsed: false, color: null }] })
    if (folderId != null) get().setFolderGroup(folderId, id)
  },

  renameGroup: (id, name) => {
    set({ groups: get().groups.map((g) => (g.id === id ? { ...g, name } : g)) })
    void window.nais.invoke('custom:folderGroups:update', { id, patch: { name } })
  },

  toggleGroup: (id) => {
    const group = get().groups.find((g) => g.id === id)
    if (!group) return
    const collapsed = !group.collapsed
    set({ groups: get().groups.map((g) => (g.id === id ? { ...g, collapsed } : g)) })
    void window.nais.invoke('custom:folderGroups:update', { id, patch: { collapsed } })
  },

  setGroupColor: (id, color) => {
    set({ groups: get().groups.map((g) => (g.id === id ? { ...g, color } : g)) })
    void window.nais.invoke('custom:folderGroups:update', { id, patch: { color } })
  },

  removeGroup: (id) => {
    const groups = get().groups.filter((g) => g.id !== id)
    const links = new Map([...get().links].filter(([, groupId]) => groupId !== id))
    const { folders, items } = useCharactersStore.getState()
    // 안에 있던 폴더는 상위 폴더 밖 영역 끝으로 (화면 순서 = 저장 순서 유지)
    const nextFolders = orderFoldersByGroup(
      groups,
      links,
      orderFoldersByGroup(get().groups, get().links, folders)
    )
    useCharactersStore.setState({ folders: nextFolders, items: canonicalize(nextFolders, items) })
    set({ groups, links })
    void window.nais.invoke('custom:folderGroups:delete', { id })
    void window.nais.invoke('chars:reorder', {
      order: toOrderEntries(nextFolders, useCharactersStore.getState().items)
    })
  },

  setFolderGroup: (folderId, groupId) => {
    const { groups, links } = get()
    const next = setFolderGroup(current(groups, links), folderId, groupId)
    // 접힌 상위 폴더에 넣었으면 펼쳐서 어디로 갔는지 보이게
    if (groupId != null && groups.find((g) => g.id === groupId)?.collapsed)
      get().toggleGroup(groupId)
    apply({ ...next, groups: get().groups }, set)
  },

  addFolderToGroup: async (groupId) => {
    const name = t('ui.newFolder')
    const { id } = await window.nais.invoke('chars:folderCreate', { name })
    const folder: ListFolder = { id, name, collapsed: false, color: null }
    useCharactersStore.setState({ folders: [...useCharactersStore.getState().folders, folder] })
    get().setFolderGroup(id, groupId)
  },

  move: (activeKey, overKey) => {
    const { groups, links } = get()
    const state = current(groups, links)
    const next = moveGroupedRow(state, activeKey, overKey)
    if (next !== state) apply(next, set)
  }
}))
