import { describe, expect, it } from 'vitest'
import {
  buildDisplayRows,
  canonicalize,
  rowKey,
  toOrderEntries
} from '../src/renderer/src/lib/folder-list'
import {
  buildGroupedRows,
  groupedRowKey,
  moveGroupedRow,
  orderFoldersByGroup,
  setFolderGroup,
  type GroupedState
} from '../src/renderer/src/lib/custom-folder-groups'
import type { FolderGroup, ListFolder } from '../src/shared/types'

// [custom] 상위 폴더: 행 구성, 끌어 놓기, 메뉴로 넣고 빼기
const folder = (id: number, name: string, collapsed = false): ListFolder => ({
  id,
  name,
  collapsed,
  color: null
})
const group = (id: number, name: string, collapsed = false): FolderGroup => ({
  id,
  name,
  collapsed,
  color: null
})
type Item = { id: number; folderId: number | null }

/** 화면 순서를 짧게: 상위 폴더 'G1', 폴더 'F1', 카드 '11', 구분선 '--' (숨은 행은 괄호) */
function view(state: GroupedState<Item>): string {
  return buildGroupedRows(state.groups, state.links, state.folders, state.items)
    .map((r) => {
      const label =
        r.type === 'group'
          ? `G${r.group.id}`
          : r.type === 'folder'
            ? `F${r.folder.id}`
            : r.type === 'item'
              ? String(r.item.id)
              : '--'
      return (r.type === 'folder' && r.hidden) || (r.type === 'item' && r.hidden)
        ? `(${label})`
        : label
    })
    .join(' ')
}

// 폴더 F1·F2·F3·F4, 상위 폴더 G1(F2·F3)·G2(F4), F1은 상위 폴더 밖
function sample(): GroupedState<Item> {
  const folders = [folder(1, 'A'), folder(2, 'B'), folder(3, 'C'), folder(4, 'D')]
  const items: Item[] = [
    { id: 11, folderId: 1 },
    { id: 21, folderId: 2 },
    { id: 22, folderId: 2 },
    { id: 31, folderId: 3 },
    { id: 41, folderId: 4 },
    { id: 90, folderId: null }
  ]
  return {
    groups: [group(1, 'G1'), group(2, 'G2')],
    links: new Map([
      [2, 1],
      [3, 1],
      [4, 2]
    ]),
    folders,
    items: canonicalize(folders, items)
  }
}

describe('custom: grouped folder rows', () => {
  it('matches the original rows exactly when there are no groups', () => {
    const folders = [folder(1, 'A'), folder(2, 'B', true)]
    const items: Item[] = [
      { id: 10, folderId: null },
      { id: 11, folderId: 1 },
      { id: 21, folderId: 2 },
      { id: 99, folderId: 7 } // 사라진 폴더 → 미분류
    ]
    const grouped = buildGroupedRows([], new Map(), folders, items).map((r) =>
      r.type === 'group' ? 'group' : [groupedRowKey(r), r.type === 'item' ? r.hidden : null]
    )
    const original = buildDisplayRows(folders, items).map((r) => [
      rowKey(r),
      r.type === 'item' ? r.hidden : null
    ])
    expect(grouped).toEqual(original)
  })

  it('shows loose folders first, then each group with its folders, then uncategorized', () => {
    expect(view(sample())).toBe('F1 11 G1 F2 21 22 F3 31 G2 F4 41 -- 90')
  })

  it('hides everything inside a collapsed group but keeps the group row', () => {
    const state = sample()
    state.groups = [group(1, 'G1', true), group(2, 'G2')]
    expect(view(state)).toBe('F1 11 G1 (F2) (21) (22) (F3) (31) G2 F4 41 -- 90')
  })

  it('treats links to missing groups as loose and shows empty groups', () => {
    const state = sample()
    state.groups = [group(2, 'G2'), group(5, 'empty')]
    expect(view(state)).toBe('F1 11 F2 21 22 F3 31 G2 F4 41 G5 -- 90')
  })

  it('orders folders for saving in display order', () => {
    const s = sample()
    s.folders = [folder(4, 'D'), folder(3, 'C'), folder(1, 'A'), folder(2, 'B')]
    expect(orderFoldersByGroup(s.groups, s.links, s.folders).map((f) => f.id)).toEqual([1, 3, 2, 4])
  })
})

describe('custom: moving rows with groups', () => {
  it('moves a folder down into another group (below its header)', () => {
    const next = moveGroupedRow(sample(), 'f-1', 'g-2')
    expect(view(next)).toBe('G1 F2 21 22 F3 31 G2 F1 11 F4 41 -- 90')
    expect(next.links.get(1)).toBe(2)
  })

  it('moves a folder up above a group header into the previous section', () => {
    const next = moveGroupedRow(sample(), 'f-4', 'g-2')
    expect(view(next)).toBe('F1 11 G1 F2 21 22 F3 31 F4 41 G2 -- 90')
    expect(next.links.get(4)).toBe(1)
  })

  it('takes a folder out of every group when dropped above the first group', () => {
    const next = moveGroupedRow(sample(), 'f-3', 'g-1')
    expect(view(next)).toBe('F1 11 F3 31 G1 F2 21 22 G2 F4 41 -- 90')
    expect(next.links.has(3)).toBe(false)
  })

  it('joins the group of the folder it is dropped on', () => {
    const next = moveGroupedRow(sample(), 'f-1', 'f-3')
    expect(view(next)).toBe('G1 F2 21 22 F3 31 F1 11 G2 F4 41 -- 90')
    expect(next.links.get(1)).toBe(1)
  })

  it('drops a folder at the end of the folder area on the divider or an uncategorized card', () => {
    for (const over of ['divider', 'i-90']) {
      const next = moveGroupedRow(sample(), 'f-2', over)
      expect(view(next)).toBe('F1 11 G1 F3 31 G2 F4 41 F2 21 22 -- 90')
      expect(next.links.get(2)).toBe(2)
    }
  })

  it('moves a whole group with its folders and cards', () => {
    const down = moveGroupedRow(sample(), 'g-1', 'g-2')
    expect(view(down)).toBe('F1 11 G2 F4 41 G1 F2 21 22 F3 31 -- 90')
    const up = moveGroupedRow(down, 'g-1', 'f-4')
    expect(view(up)).toBe('F1 11 G1 F2 21 22 F3 31 G2 F4 41 -- 90')
    expect(up.links).toEqual(sample().links)
  })

  it('keeps groups after loose folders when a group is dropped on one', () => {
    const next = moveGroupedRow(sample(), 'g-2', 'f-1')
    expect(view(next)).toBe('F1 11 G2 F4 41 G1 F2 21 22 F3 31 -- 90')
  })

  it('puts a card dropped on a group header into that group', () => {
    const down = moveGroupedRow(sample(), 'i-11', 'g-1')
    expect(view(down)).toBe('F1 G1 F2 11 21 22 F3 31 G2 F4 41 -- 90')
    expect(down.items.find((i) => i.id === 11)?.folderId).toBe(2)
    const up = moveGroupedRow(sample(), 'i-41', 'g-2')
    expect(view(up)).toBe('F1 11 G1 F2 21 22 F3 31 41 G2 F4 -- 90')
    expect(up.items.find((i) => i.id === 41)?.folderId).toBe(3)
  })

  it('ignores a card dropped on an empty group', () => {
    const state = sample()
    state.groups = [...state.groups, group(5, 'empty')]
    expect(moveGroupedRow(state, 'i-11', 'g-5')).toBe(state)
  })

  it('moves cards between folders in different groups like the original list', () => {
    const next = moveGroupedRow(sample(), 'i-90', 'i-31')
    expect(view(next)).toBe('F1 11 G1 F2 21 22 F3 90 31 G2 F4 41 --')
    expect(next.items.find((i) => i.id === 90)?.folderId).toBe(3)
  })

  it('saves an order that the main process reads back to the same folders', () => {
    const next = moveGroupedRow(sample(), 'f-1', 'g-2')
    // 원본 저장 규약: 미분류 먼저, 그다음 폴더 순서대로 [폴더, 그 카드들...]
    expect(toOrderEntries(next.folders, next.items)).toEqual([
      { type: 'char', id: 90 },
      { type: 'folder', id: 2 },
      { type: 'char', id: 21 },
      { type: 'char', id: 22 },
      { type: 'folder', id: 3 },
      { type: 'char', id: 31 },
      { type: 'folder', id: 1 },
      { type: 'char', id: 11 },
      { type: 'folder', id: 4 },
      { type: 'char', id: 41 }
    ])
  })
})

describe('custom: putting folders into groups from the menu', () => {
  it('appends the folder at the end of the group', () => {
    const next = setFolderGroup(sample(), 1, 1)
    expect(view(next)).toBe('G1 F2 21 22 F3 31 F1 11 G2 F4 41 -- 90')
  })

  it('takes the folder out to the end of the loose folders', () => {
    const next = setFolderGroup(sample(), 2, null)
    expect(view(next)).toBe('F1 11 F2 21 22 G1 F3 31 G2 F4 41 -- 90')
    expect(next.links.has(2)).toBe(false)
  })
})
