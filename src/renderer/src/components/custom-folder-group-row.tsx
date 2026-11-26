import { useSortable } from '@dnd-kit/sortable'
import {
  Check,
  ChevronDown,
  ChevronRight,
  FolderInput,
  FolderOutput,
  FolderPlus,
  Folders,
  Palette,
  Pencil,
  Trash2,
  X
} from 'lucide-react'
import { memo, useState } from 'react'
import { FOLDER_COLORS, type FolderGroup } from '@shared/types'
import { useT } from '../lib/i18n'
import { cn } from '../lib/utils'
import type { GroupActions } from '../lib/custom-folder-groups'
import { useFolderGroupsStore } from '../stores/custom-folder-groups-store'
import { Button } from './ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from './ui/context-menu'
import { Input } from './ui/input'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

// dnd-kit은 useSortable 반환값으로 콜백 ref와 렌더 시점 상태를 함께 준다 (원본 폴더 행과 같은 사정)
/* eslint-disable react-hooks/refs */
/**
 * [custom] 상위 폴더 행 — 폴더 행과 같은 동작(접기·이름·색·삭제, 통째로 끌기)에
 * 폴더 행과 헷갈리지 않게 테두리와 묶음 아이콘을 둔다.
 */
export const FolderGroupRow = memo(
  FolderGroupRowInner,
  // actions는 부모가 매 렌더 새로 만들지만 동작만 담으므로 비교에서 제외 (원본 폴더 행과 같다)
  (a, b) => a.group === b.group && a.folderCount === b.folderCount && a.searching === b.searching
) as typeof FolderGroupRowInner

function FolderGroupRowInner({
  group,
  folderCount,
  actions,
  searching
}: {
  group: FolderGroup
  folderCount: number
  actions: GroupActions
  searching: boolean
}): React.JSX.Element {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const sortable = useSortable({ id: `g-${group.id}`, disabled: searching || editing })
  const move = sortable.transform
  const style: React.CSSProperties = {
    transform: move ? `translate3d(0, ${Math.round(move.y)}px, 0)` : undefined,
    transition: sortable.transition,
    ...(group.color
      ? {
          borderColor: group.color,
          backgroundColor: `color-mix(in srgb, ${group.color} 16%, var(--surface))`
        }
      : {})
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={sortable.setNodeRef}
          style={style}
          className={cn(
            'group flex h-10 items-center gap-1.5 rounded-lg border-2 border-line bg-surface px-1.5',
            sortable.isDragging && 'relative z-20 opacity-75'
          )}
          {...(searching || editing ? {} : sortable.attributes)}
          {...(searching || editing ? {} : sortable.listeners)}
        >
          <button className="text-muted" onClick={() => actions.toggleCollapse(group.id)}>
            {group.collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
          </button>
          <Folders
            size={15}
            className="shrink-0 text-muted"
            style={group.color ? { color: group.color } : undefined}
          />
          {editing ? (
            <Input
              autoFocus
              className="h-7 w-0 flex-1 text-[13px]"
              defaultValue={group.name}
              onPointerDown={(e) => e.stopPropagation()}
              onBlur={(e) => {
                if (e.target.value.trim()) actions.rename(group.id, e.target.value.trim())
                setEditing(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') setEditing(false)
              }}
            />
          ) : (
            // 이름 클릭 = 접기/펼치기 (이름 변경은 연필 버튼/우클릭으로만)
            <button
              className="min-w-0 flex-1 truncate text-left text-[13.5px] font-semibold text-ink"
              onClick={() => actions.toggleCollapse(group.id)}
            >
              {group.name}
              <span className="ml-1.5 font-mono text-[10.5px] font-normal text-faint">
                {folderCount}
              </span>
            </button>
          )}
          {/* opacity로 숨김(display 아님) — 팝오버 앵커 유지 (원본 폴더 행과 같다) */}
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              title={t('ui.customAddFolderToGroup')}
              onClick={() => actions.addFolder(group.id)}
            >
              <FolderPlus size={14} />
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  title={t('ui.folderColor')}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <Palette size={13} />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-1.5" onPointerDown={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-1">
                  <button
                    className="grid size-6 place-items-center rounded-md border border-line text-faint hover:text-ink"
                    title={t('ui.noColor')}
                    onClick={() => actions.setColor(group.id, null)}
                  >
                    <X size={13} />
                  </button>
                  {FOLDER_COLORS.map((c) => (
                    <button
                      key={c}
                      className={cn(
                        'size-6 rounded-md border transition-transform hover:scale-110',
                        group.color === c ? 'border-ink' : 'border-transparent'
                      )}
                      style={{ backgroundColor: c }}
                      onClick={() => actions.setColor(group.id, c)}
                    />
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              title={t('ui.rename.d3f4cb8')}
              onClick={() => setEditing(true)}
            >
              <Pencil size={13} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 hover:text-danger-ink"
              title={t('ui.customDeleteFolderGroup')}
              onClick={() => actions.remove(group.id)}
            >
              <Trash2 size={13} />
            </Button>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => actions.addFolder(group.id)}>
          <FolderPlus size={13} /> {t('ui.customAddFolderToGroup')}
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            // 우클릭 메뉴가 닫힌 뒤 인라인 편집 시작
            setTimeout(() => setEditing(true), 0)
          }}
        >
          <Pencil size={13} /> {t('ui.rename')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem danger onSelect={() => actions.remove(group.id)}>
          <Trash2 size={13} /> {t('ui.customDeleteFolderGroup')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
/* eslint-enable react-hooks/refs */

/**
 * [custom] 폴더 우클릭 메뉴의 '상위 폴더로 이동' — 메뉴를 열 때마다 최신 상위 폴더 목록을 읽는다
 * (폴더 행은 memo라 다시 그려지지 않아도 이 부분은 스토어를 직접 구독한다)
 */
export function FolderGroupMenu({ folderId }: { folderId: number }): React.JSX.Element {
  const t = useT()
  const groups = useFolderGroupsStore((s) => s.groups)
  const linked = useFolderGroupsStore((s) => s.links.get(folderId) ?? null)
  const setFolderGroup = useFolderGroupsStore((s) => s.setFolderGroup)
  const createGroup = useFolderGroupsStore((s) => s.createGroup)
  const inGroup = groups.some((g) => g.id === linked) ? linked : null
  return (
    <>
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <FolderInput size={13} /> {t('ui.customMoveToFolderGroup')}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {groups.map((g) => (
            <ContextMenuItem
              key={g.id}
              disabled={g.id === inGroup}
              onSelect={() => setFolderGroup(folderId, g.id)}
            >
              <Folders size={13} style={g.color ? { color: g.color } : undefined} />
              <span className="min-w-0 flex-1 truncate">{g.name}</span>
              {g.id === inGroup && <Check size={13} className="text-accent-ink" />}
            </ContextMenuItem>
          ))}
          {groups.length > 0 && <ContextMenuSeparator />}
          <ContextMenuItem onSelect={() => void createGroup(folderId)}>
            <FolderPlus size={13} /> {t('ui.customNewFolderGroupWithFolder')}
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      {inGroup != null && (
        <ContextMenuItem onSelect={() => setFolderGroup(folderId, null)}>
          <FolderOutput size={13} /> {t('ui.customRemoveFromFolderGroup')}
        </ContextMenuItem>
      )}
    </>
  )
}
