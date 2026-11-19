/**
 * [custom] 씬 프리셋 폴더 — 목록에 보일 묶음과 순서 계산.
 * 폴더는 프리셋에 붙은 이름표다. 묶음은 그 폴더의 첫 프리셋 자리에 놓이고, 묶음 안 순서는 프리셋 순서 그대로다.
 */

export interface PresetLike {
  id: number
  name: string
}

export interface PresetGroup<P extends PresetLike> {
  /** null = 폴더에 들지 않은 프리셋 하나 */
  folder: string | null
  presets: P[]
}

export function groupPresets<P extends PresetLike>(
  presets: P[],
  folders: Record<number, string>
): PresetGroup<P>[] {
  const groups: PresetGroup<P>[] = []
  const byFolder = new Map<string, PresetGroup<P>>()
  for (const preset of presets) {
    const folder = folders[preset.id]
    if (!folder) {
      groups.push({ folder: null, presets: [preset] })
      continue
    }
    let group = byFolder.get(folder)
    if (!group) {
      group = { folder, presets: [] }
      byFolder.set(folder, group)
      groups.push(group)
    }
    group.presets.push(preset)
  }
  return groups
}

/** 목록에 보이는 순서대로의 프리셋 id — 프리셋 순서를 여기에 맞춰 두면 ↑/↓ 넘기기도 보이는 순서를 따른다 */
export function folderOrder<P extends PresetLike>(
  presets: P[],
  folders: Record<number, string>
): number[] {
  return groupPresets(presets, folders).flatMap((g) => g.presets.map((p) => p.id))
}

/**
 * 한 칸 옮기기 — 폴더 안의 프리셋은 그 폴더 안에서, 폴더 밖 프리셋과 폴더 묶음은 묶음 단위로 자리를 바꾼다.
 * id = 프리셋 id, 또는 폴더 이름(묶음째 옮기기). 옮길 수 없으면 null.
 */
export function moveInFolders<P extends PresetLike>(
  presets: P[],
  folders: Record<number, string>,
  target: number | string,
  dir: -1 | 1
): number[] | null {
  const groups = groupPresets(presets, folders)
  if (typeof target === 'number' && folders[target]) {
    const group = groups.find((g) => g.folder === folders[target])
    if (!group) return null
    const from = group.presets.findIndex((p) => p.id === target)
    const to = from + dir
    if (from < 0 || to < 0 || to >= group.presets.length) return null
    group.presets.splice(to, 0, ...group.presets.splice(from, 1))
  } else {
    const from = groups.findIndex((g) =>
      typeof target === 'number'
        ? g.folder === null && g.presets[0].id === target
        : g.folder === target
    )
    const to = from + dir
    if (from < 0 || to < 0 || to >= groups.length) return null
    groups.splice(to, 0, ...groups.splice(from, 1))
  }
  return groups.flatMap((g) => g.presets.map((p) => p.id))
}

/**
 * 폴더에 넣을 때의 순서 — 넣는 프리셋을 그 폴더의 마지막 프리셋 뒤로 보낸다
 * (폴더가 프리셋 자리로 끌려오지 않고, 프리셋이 폴더로 간다). 새 폴더면 순서는 그대로.
 */
export function joinOrder<P extends PresetLike>(
  presets: P[],
  folders: Record<number, string>,
  joining: number[],
  folder: string
): number[] {
  const moving = new Set(joining)
  const rest = presets.map((p) => p.id).filter((id) => !moving.has(id))
  const last = rest.findLastIndex((id) => folders[id] === folder)
  if (last < 0) return presets.map((p) => p.id)
  const moved = presets.map((p) => p.id).filter((id) => moving.has(id))
  return [...rest.slice(0, last + 1), ...moved, ...rest.slice(last + 1)]
}

/** 이름의 첫 낱말 (띄어쓰기·밑줄·붙임표 앞까지) — 자동 묶기의 폴더 이름 */
export function namePrefix(name: string): string {
  return name.trim().split(/[\s_-]+/)[0] ?? ''
}

/**
 * 이름으로 자동 묶기 — 아직 폴더에 없는 프리셋 가운데 이름의 첫 낱말이 같은 것이 둘 이상이면 그 낱말의 폴더로.
 * 이미 그 이름의 폴더가 있으면 하나뿐이어도 거기에 넣는다. 돌려주는 값: 폴더 이름 → 넣을 프리셋 id들
 */
export function autoFolders<P extends PresetLike>(
  presets: P[],
  folders: Record<number, string>
): Record<string, number[]> {
  const existing = new Set(Object.values(folders))
  const found = new Map<string, number[]>()
  for (const preset of presets) {
    if (folders[preset.id]) continue
    const prefix = namePrefix(preset.name)
    if (!prefix || prefix === preset.name.trim()) continue // 한 낱말짜리 이름은 묶을 기준이 없다
    found.set(prefix, [...(found.get(prefix) ?? []), preset.id])
  }
  return Object.fromEntries(
    [...found].filter(([prefix, ids]) => ids.length >= 2 || existing.has(prefix))
  )
}
