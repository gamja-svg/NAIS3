import type { FolderGroup, FolderGroupLink, ListFolder } from '@shared/types'
import {
  canonicalize,
  DIVIDER_KEY,
  moveRow,
  rowKey,
  type DisplayRow,
  type FolderListItem
} from './folder-list'

/**
 * [custom] 상위 폴더(폴더 묶음) — 폴더 리스트 모델 위에 한 단계를 더 얹는다.
 * - 표시 순서: [상위 폴더 밖 폴더들..., 상위 폴더1, 그 폴더들..., 상위 폴더2, ..., 미분류 구분선, 미분류 카드...]
 * - 폴더의 소속은 "바로 위 상위 폴더 행"에서 파생 — 카드가 바로 위 폴더 행에 속하는 원본 규칙과 같다.
 *   그래서 첫 상위 폴더 행보다 위 = 상위 폴더 밖
 * - 상위 폴더가 없으면 행 구성이 원본 buildDisplayRows와 같다
 */

/** 폴더 id → 상위 폴더 id */
export type GroupLinks = ReadonlyMap<number, number>

/** 상위 폴더를 아는 행 — 원본 DisplayRow에 상위 폴더 행, 깊이, 소속 상위 폴더를 더했다 */
export type GroupedRow<T extends FolderListItem> =
  | { type: 'group'; group: FolderGroup; folderCount: number }
  | { type: 'folder'; folder: ListFolder; hidden?: boolean; groupId?: number | null }
  | { type: 'item'; item: T; hidden: boolean; depth?: number; groupId?: number | null }
  | { type: 'divider' }

export interface GroupedState<T extends FolderListItem> {
  groups: FolderGroup[]
  links: GroupLinks
  folders: ListFolder[]
  items: T[]
}

export function groupedRowKey<T extends FolderListItem>(row: GroupedRow<T>): string {
  return row.type === 'group' ? `g-${row.group.id}` : rowKey(row as DisplayRow<T>)
}

export function linksFrom(list: FolderGroupLink[]): Map<number, number> {
  return new Map(list.map((l) => [l.folderId, l.groupId]))
}

export function linksTo(links: GroupLinks, folders: ListFolder[]): FolderGroupLink[] {
  return folders.flatMap((f) => {
    const groupId = links.get(f.id)
    return groupId == null ? [] : [{ folderId: f.id, groupId }]
  })
}

/** 폴더의 상위 폴더 — 없거나 사라진 상위 폴더면 null */
function groupResolver(
  groups: FolderGroup[],
  links: GroupLinks
): (folderId: number) => number | null {
  const ids = new Set(groups.map((g) => g.id))
  return (folderId) => {
    const groupId = links.get(folderId)
    return groupId != null && ids.has(groupId) ? groupId : null
  }
}

/** 표시 순서대로 폴더 정렬 — 상위 폴더 밖 먼저, 그다음 상위 폴더 순서대로 (안에서는 원래 순서) */
export function orderFoldersByGroup(
  groups: FolderGroup[],
  links: GroupLinks,
  folders: ListFolder[]
): ListFolder[] {
  const groupOf = groupResolver(groups, links)
  return [
    ...folders.filter((f) => groupOf(f.id) == null),
    ...groups.flatMap((g) => folders.filter((f) => groupOf(f.id) === g.id))
  ]
}

export function buildGroupedRows<T extends FolderListItem>(
  groups: FolderGroup[],
  links: GroupLinks,
  folders: ListFolder[],
  items: T[]
): GroupedRow<T>[] {
  const groupOf = groupResolver(groups, links)
  const folderIds = new Set(folders.map((f) => f.id))
  const byFolder = new Map<number, T[]>()
  const loose: T[] = []
  for (const item of items) {
    if (item.folderId != null && folderIds.has(item.folderId)) {
      const list = byFolder.get(item.folderId)
      if (list) list.push(item)
      else byFolder.set(item.folderId, [item])
    } else loose.push(item) // 사라진 폴더를 가리키는 카드도 미분류로 (원본과 같다)
  }

  const rows: GroupedRow<T>[] = []
  const pushFolder = (
    folder: ListFolder,
    groupId: number | null,
    groupCollapsed: boolean
  ): void => {
    rows.push({ type: 'folder', folder, hidden: groupCollapsed, groupId })
    for (const item of byFolder.get(folder.id) ?? []) {
      rows.push({
        type: 'item',
        item,
        hidden: groupCollapsed || folder.collapsed,
        depth: groupId == null ? 1 : 2,
        groupId
      })
    }
  }
  for (const folder of folders) if (groupOf(folder.id) == null) pushFolder(folder, null, false)
  for (const group of groups) {
    const inside = folders.filter((f) => groupOf(f.id) === group.id)
    rows.push({ type: 'group', group, folderCount: inside.length })
    for (const folder of inside) pushFolder(folder, group.id, group.collapsed)
  }
  // 폴더나 상위 폴더가 있으면 미분류 경계 (여기로 놓으면 폴더에서 빠짐)
  if (folders.length > 0 || groups.length > 0) rows.push({ type: 'divider' })
  for (const item of loose)
    rows.push({ type: 'item', item, hidden: false, depth: 0, groupId: null })
  return rows
}

/** 키에서 종류와 id ("g-3" → ['g', 3], "divider" → ['d', NaN]) */
function parseKey(key: string): [string, number] {
  if (key === DIVIDER_KEY) return ['d', NaN]
  const [kind, id] = key.split('-')
  return [kind, Number(id)]
}

/**
 * 끌어 놓기 결과 반영 (activeKey/overKey는 groupedRowKey 형식).
 * - 카드: 원본 규칙 그대로. 상위 폴더 행 위에 놓으면 그 상위 폴더의 첫 폴더 행에 놓은 것으로 본다
 * - 폴더: 소속 카드와 함께 블록으로 이동하고, 놓인 자리의 바로 위 상위 폴더 행에 들어간다
 * - 상위 폴더: 안의 폴더·카드와 함께 상위 폴더끼리 순서만 바뀐다
 * 결과의 folders는 항상 표시 순서다 (그대로 저장하면 원본 폴더 순서가 화면과 같아진다).
 */
export function moveGroupedRow<T extends FolderListItem>(
  state: GroupedState<T>,
  activeKey: string,
  overKey: string
): GroupedState<T> {
  if (activeKey === overKey || activeKey === DIVIDER_KEY) return state
  const { groups, links, folders, items } = state
  const keys = buildGroupedRows(groups, links, folders, items).map(groupedRowKey)
  const fromRow = keys.indexOf(activeKey)
  const overRow = keys.indexOf(overKey)
  if (fromRow < 0 || overRow < 0) return state
  const down = overRow > fromRow
  const groupOf = groupResolver(groups, links)
  const ordered = orderFoldersByGroup(groups, links, folders)
  const folderIds = new Set(folders.map((f) => f.id))
  const [activeKind, activeId] = parseKey(activeKey)
  const [overKind, overId] = parseKey(overKey)
  /** 놓인 자리가 속한 폴더 (미분류 카드·구분선이면 null) */
  const folderAt = (): number | null => {
    const folderId =
      overKind === 'f'
        ? overId
        : overKind === 'i'
          ? (items.find((i) => i.id === overId)?.folderId ?? null)
          : null
    return folderId != null && folderIds.has(folderId) ? folderId : null
  }

  if (activeKind === 'i') {
    let target = overKey
    if (overKind === 'g') {
      const first = ordered.find((f) => groupOf(f.id) === overId)
      if (!first) return state // 빈 상위 폴더에는 카드를 바로 넣을 수 없다
      target = `f-${first.id}`
    }
    const next = moveRow(ordered, items, activeKey, target)
    return { ...state, folders: next.folders, items: next.items }
  }

  if (activeKind === 'f') {
    // 폴더·상위 폴더 행만 남긴 순서에서 블록을 옮긴 뒤, 바로 위 상위 폴더 행으로 소속을 다시 정한다
    type Token = { group: number } | { folder: number }
    const seq: Token[] = [
      ...ordered.filter((f) => groupOf(f.id) == null).map((f) => ({ folder: f.id })),
      ...groups.flatMap((g) => [
        { group: g.id },
        ...ordered.filter((f) => groupOf(f.id) === g.id).map((f) => ({ folder: f.id }))
      ])
    ]
    const from = seq.findIndex((t) => 'folder' in t && t.folder === activeId)
    if (from < 0) return state
    seq.splice(from, 1)
    let to: number
    if (overKind === 'g') {
      const at = seq.findIndex((t) => 'group' in t && t.group === overId)
      if (at < 0) return state
      to = down ? at + 1 : at
    } else {
      const target = folderAt()
      if (target == null)
        to = seq.length // 구분선·미분류 카드 위 = 폴더 영역 끝
      else {
        const at = seq.findIndex((t) => 'folder' in t && t.folder === target)
        if (at < 0) return state
        to = down ? at + 1 : at
      }
    }
    seq.splice(to, 0, { folder: activeId })

    const nextLinks = new Map<number, number>()
    const order: number[] = []
    let current: number | null = null
    for (const token of seq) {
      if ('group' in token) current = token.group
      else {
        order.push(token.folder)
        if (current != null) nextLinks.set(token.folder, current)
      }
    }
    const byId = new Map(folders.map((f) => [f.id, f]))
    const nextFolders = order.flatMap((id) => {
      const folder = byId.get(id)
      return folder ? [folder] : []
    })
    return {
      ...state,
      links: nextLinks,
      folders: nextFolders,
      items: canonicalize(nextFolders, items)
    }
  }

  if (activeKind === 'g') {
    const order = groups.map((g) => g.id)
    if (!order.includes(activeId)) return state
    let target: number | null | 'end'
    if (overKind === 'g') target = overId
    else {
      const folder = folderAt()
      target = folder == null ? 'end' : groupOf(folder) // 상위 폴더 밖 폴더 위 = 맨 앞
    }
    if (target === activeId) return state
    const rest = order.filter((id) => id !== activeId)
    let to: number
    if (target === 'end') to = rest.length
    else if (target == null) to = 0
    else {
      const at = rest.indexOf(target)
      if (at < 0) return state
      to = down ? at + 1 : at
    }
    rest.splice(to, 0, activeId)
    const byId = new Map(groups.map((g) => [g.id, g]))
    const nextGroups = rest.flatMap((id) => {
      const group = byId.get(id)
      return group ? [group] : []
    })
    const nextFolders = orderFoldersByGroup(nextGroups, links, folders)
    return {
      ...state,
      groups: nextGroups,
      folders: nextFolders,
      items: canonicalize(nextFolders, items)
    }
  }

  return state
}

/** 폴더를 상위 폴더에 넣거나(맨 끝으로) 뺀다 (null = 상위 폴더 밖, 그 영역 맨 끝) */
export function setFolderGroup<T extends FolderListItem>(
  state: GroupedState<T>,
  folderId: number,
  groupId: number | null
): GroupedState<T> {
  const folder = state.folders.find((f) => f.id === folderId)
  if (!folder) return state
  const links = new Map(state.links)
  if (groupId == null) links.delete(folderId)
  else links.set(folderId, groupId)
  // 옮긴 폴더를 원래 순서의 맨 뒤로 보내면 새 자리(상위 폴더 안 / 밖)에서 마지막이 된다
  const ordered = orderFoldersByGroup(state.groups, state.links, state.folders)
  const nextFolders = orderFoldersByGroup(state.groups, links, [
    ...ordered.filter((f) => f.id !== folderId),
    folder
  ])
  return { ...state, links, folders: nextFolders, items: canonicalize(nextFolders, state.items) }
}

/** [custom] 상위 폴더 행 동작 */
export interface GroupActions {
  rename: (id: number, name: string) => void
  toggleCollapse: (id: number) => void
  setColor: (id: number, color: string | null) => void
  remove: (id: number) => void
  addFolder: (id: number) => void
}

export const NO_GROUP_ACTIONS: GroupActions = {
  rename: () => {},
  toggleCollapse: () => {},
  setColor: () => {},
  remove: () => {},
  addFolder: () => {}
}
