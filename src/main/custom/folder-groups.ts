import type {
  FolderGroup,
  FolderGroupKind,
  FolderGroupLink,
  FolderGroupPatch
} from '../../shared/types'
import { getDb } from '../db'

/**
 * [custom] 상위 폴더 — 폴더 여러 개를 묶는다 (지금은 캐릭터 프롬프트만).
 * 원본 표는 건드리지 않고 전용 표 두 개에 둔다. 원본 마이그레이션 번호와 겹치지 않게 처음 쓸 때 만든다.
 * - custom_folder_groups: 상위 폴더 (종류별 순서·접힘·색)
 * - custom_folder_group_links: 폴더 → 상위 폴더 (행이 없으면 상위 폴더 밖)
 * 폴더끼리의 순서는 원본 폴더 표의 순서를 그대로 쓴다.
 */

/** 종류별 원본 폴더 표 — SQL에 이름을 넣으므로 여기 있는 값만 받는다 */
const FOLDER_TABLES: Record<FolderGroupKind, string> = { chars: 'character_folders' }

function folderTable(kind: FolderGroupKind): string {
  const table = FOLDER_TABLES[kind]
  if (!table) throw new Error(`unknown folder group kind: ${String(kind)}`)
  return table
}

const ready = new WeakSet<object>()
function groupsDb(): ReturnType<typeof getDb> {
  const db = getDb()
  if (!ready.has(db)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS custom_folder_groups (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        collapsed INTEGER NOT NULL DEFAULT 0,
        color TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS custom_folder_group_links (
        kind TEXT NOT NULL,
        folder_id INTEGER NOT NULL,
        group_id INTEGER NOT NULL,
        PRIMARY KEY (kind, folder_id)
      );
    `)
    ready.add(db)
  }
  return db
}

export function listFolderGroups(kind: FolderGroupKind): {
  groups: FolderGroup[]
  links: FolderGroupLink[]
} {
  const table = folderTable(kind)
  const db = groupsDb()
  // 지워진 폴더나 상위 폴더를 가리키는 연결은 치운다
  db.prepare(
    `DELETE FROM custom_folder_group_links
     WHERE kind = ?
       AND (folder_id NOT IN (SELECT id FROM ${table})
            OR group_id NOT IN (SELECT id FROM custom_folder_groups WHERE kind = ?))`
  ).run(kind, kind)
  const groups = (
    db
      .prepare(
        `SELECT id, name, collapsed, color FROM custom_folder_groups
         WHERE kind = ? ORDER BY sort_order, id`
      )
      .all(kind) as { id: number; name: string; collapsed: number; color: string | null }[]
  ).map((r) => ({ id: r.id, name: r.name, collapsed: r.collapsed === 1, color: r.color ?? null }))
  const links = db
    .prepare(
      `SELECT folder_id AS folderId, group_id AS groupId
       FROM custom_folder_group_links WHERE kind = ?`
    )
    .all(kind) as FolderGroupLink[]
  return { groups, links }
}

export function createFolderGroup(kind: FolderGroupKind, name: string): number {
  folderTable(kind)
  const db = groupsDb()
  const { m } = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM custom_folder_groups WHERE kind = ?')
    .get(kind) as { m: number }
  return Number(
    db
      .prepare('INSERT INTO custom_folder_groups (kind, name, sort_order) VALUES (?, ?, ?)')
      .run(kind, name, m + 1).lastInsertRowid
  )
}

export function updateFolderGroup(id: number, patch: FolderGroupPatch): void {
  const db = groupsDb()
  if (patch.name !== undefined)
    db.prepare('UPDATE custom_folder_groups SET name = ? WHERE id = ?').run(patch.name, id)
  if (patch.collapsed !== undefined)
    db.prepare('UPDATE custom_folder_groups SET collapsed = ? WHERE id = ?').run(
      patch.collapsed ? 1 : 0,
      id
    )
  if (patch.color !== undefined)
    db.prepare('UPDATE custom_folder_groups SET color = ? WHERE id = ?').run(patch.color, id)
}

/** 상위 폴더만 지운다 — 안의 폴더·카드는 그대로 남아 상위 폴더 밖으로 나온다 */
export function deleteFolderGroup(id: number): void {
  const db = groupsDb()
  db.transaction(() => {
    db.prepare('DELETE FROM custom_folder_group_links WHERE group_id = ?').run(id)
    db.prepare('DELETE FROM custom_folder_groups WHERE id = ?').run(id)
  })()
}

/** 상위 폴더 순서와 폴더 소속을 한 번에 저장 (끌어 놓기·메뉴로 옮긴 뒤) */
export function arrangeFolderGroups(
  kind: FolderGroupKind,
  groupIds: number[],
  links: FolderGroupLink[]
): void {
  const table = folderTable(kind)
  const db = groupsDb()
  const setOrder = db.prepare(
    'UPDATE custom_folder_groups SET sort_order = ? WHERE id = ? AND kind = ?'
  )
  const insert = db.prepare(
    `INSERT OR REPLACE INTO custom_folder_group_links (kind, folder_id, group_id)
     SELECT ?, ?, ?
     WHERE EXISTS (SELECT 1 FROM ${table} WHERE id = ?)
       AND EXISTS (SELECT 1 FROM custom_folder_groups WHERE id = ? AND kind = ?)`
  )
  db.transaction(() => {
    groupIds.forEach((id, i) => setOrder.run(i, id, kind))
    db.prepare('DELETE FROM custom_folder_group_links WHERE kind = ?').run(kind)
    for (const link of links) {
      insert.run(kind, link.folderId, link.groupId, link.folderId, link.groupId, kind)
    }
  })()
}
