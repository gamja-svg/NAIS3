import { Check, Folder, FolderMinus, FolderPlus } from 'lucide-react'
import { useState } from 'react'
import { useT } from '../lib/i18n'
import { cn } from '../lib/utils'
import { usePresetFolderStore } from '../stores/custom-preset-folder-store'
import { askText } from '../stores/dialog-store'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

/**
 * [custom] 프리셋 줄의 `폴더에 넣기` 버튼 — 있는 폴더를 고르거나 새 폴더를 만들고, 폴더에서 뺀다.
 */
export function PresetFolderPicker({
  presetId,
  always
}: {
  presetId: number
  /** 마우스를 올리지 않아도 보이게 (터치·원격 모드) */
  always?: boolean
}): React.JSX.Element {
  const t = useT()
  const folders = usePresetFolderStore((s) => s.folders)
  const setFolder = usePresetFolderStore((s) => s.setFolder)
  const [open, setOpen] = useState(false)
  const current = folders[presetId]
  const names = [...new Set(Object.values(folders))].sort((a, b) => a.localeCompare(b))
  const item =
    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-surface-2'
  const choose = (folder: string | null): void => {
    setOpen(false)
    if (folder !== (current ?? null)) void setFolder([presetId], folder)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'shrink-0 rounded p-1 text-faint hover:text-ink',
            !always && !open && 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100'
          )}
          title={t('ui.customPresetFolderMove')}
          aria-label={t('ui.customPresetFolderMove')}
        >
          <Folder size={12} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-max min-w-44 max-w-[min(24rem,80vw)] p-1">
        <div className="max-h-56 overflow-y-auto">
          {names.map((name) => (
            <button key={name} className={item} onClick={() => choose(name)}>
              <Folder size={13} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate" title={name}>
                {name}
              </span>
              {name === current && <Check size={13} className="shrink-0 text-accent-ink" />}
            </button>
          ))}
        </div>
        {names.length > 0 && <div className="my-1 h-px bg-line" />}
        <button
          className={cn(item, 'text-accent-ink')}
          onClick={async () => {
            setOpen(false)
            const name = await askText(t('ui.customPresetFolderName'), '')
            if (name?.trim()) void setFolder([presetId], name)
          }}
        >
          <FolderPlus size={13} /> {t('ui.customPresetFolderNew')}
        </button>
        {current && (
          <button className={cn(item, 'text-muted')} onClick={() => choose(null)}>
            <FolderMinus size={13} /> {t('ui.customPresetFolderRemove')}
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}
