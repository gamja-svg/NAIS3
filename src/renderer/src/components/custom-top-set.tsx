import { FolderCog, FolderDown, FolderInput, FolderOpen, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { topSetSummary } from '../lib/custom-top-set'
import { useT } from '../lib/i18n'
import { toast } from '../stores/toast-store'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from './ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

/**
 * [custom] 대표 세트 받기 — 누르면 씬마다 카드에 보이는 대표 이미지 1장씩을 기본 폴더 안 프리셋 이름
 * 폴더로 받는다 (처음 한 번은 기본 폴더를 고른다). 우클릭(길게 누르기)으로 다른 폴더·폴더 열기·기본 폴더 바꾸기.
 */
export function TopSetButton({ presetId }: { presetId: number | null }): React.JSX.Element {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [baseDir, setBaseDir] = useState<string | null>(null)

  const run = async (pick: boolean): Promise<void> => {
    if (presetId == null || busy) return
    setBusy(true)
    try {
      const result = await window.nais.invoke('custom:topSetExport', { presetId, pick })
      if ('canceled' in result) return
      if (result.total === 0) toast(t('ui.customTopSetEmpty'), 'info')
      else
        toast(
          t('ui.customTopSetDoneValue', topSetSummary(result)),
          result.failed > 0 ? 'error' : 'success'
        )
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  const openDir = async (): Promise<void> => {
    if (presetId == null) return
    const { ok } = await window.nais.invoke('custom:topSetOpenDir', { presetId })
    if (!ok) toast(t('ui.customTopSetNothingToOpen'), 'info')
  }
  const changeDefault = async (): Promise<void> => {
    const { dir, canceled } = await window.nais.invoke('custom:topSetPickDir', undefined)
    if (!canceled) toast(t('ui.customTopSetDefaultDirValue', dir), 'success')
  }
  const tip = t('ui.customTopSetTip')

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open)
          void window.nais
            .invoke('custom:topSetGetDir', undefined)
            .then(({ dir }) => setBaseDir(dir))
      }}
    >
      <Tooltip>
        <ContextMenuTrigger asChild>
          <TooltipTrigger asChild>
            <button
              onClick={() => void run(false)}
              disabled={presetId == null}
              aria-label={tip}
              aria-busy={busy}
              className="grid size-8 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-35"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <FolderDown size={16} />}
            </button>
          </TooltipTrigger>
        </ContextMenuTrigger>
        <TooltipContent>{tip}</TooltipContent>
      </Tooltip>
      <ContextMenuContent className="max-w-80">
        <div className="truncate px-2 py-1 text-[11.5px] text-faint" title={baseDir ?? ''}>
          {baseDir
            ? t('ui.customTopSetDefaultDirValue', baseDir)
            : baseDir === ''
              ? t('ui.customTopSetNoDefault')
              : '…'}
        </div>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void run(false)}>
          <FolderDown size={13} /> {t('ui.customTopSetRun')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void run(true)}>
          <FolderInput size={13} /> {t('ui.customTopSetOther')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void openDir()}>
          <FolderOpen size={13} className="text-hue-amber" /> {t('ui.customTopSetOpen')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void changeDefault()}>
          <FolderCog size={13} /> {t('ui.customTopSetChangeDefault')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
