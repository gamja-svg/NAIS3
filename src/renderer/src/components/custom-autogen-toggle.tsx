import { Zap } from 'lucide-react'
import { useT } from '../lib/i18n'
import { cn } from '../lib/utils'
import { useAutoGenStore } from '../stores/custom-autogen-store'

/**
 * [custom] 타이틀바 `자동 생성` 버튼 — 감시 폴더로 불러온 씬을 바로 생성할지 켜고 끈다.
 * 설정 > 저장의 `불러온 씬 자동 생성`과 같은 값이고, 요청 파일로 바뀌어도 따라 바뀐다.
 * 감시 폴더가 꺼져 있으면 쓰이지 않으므로 보이지 않는다.
 */
export function AutoGenToggle(): React.JSX.Element | null {
  const t = useT()
  const enabled = useAutoGenStore((s) => s.enabled)
  const watching = useAutoGenStore((s) => s.watching)
  const toggle = useAutoGenStore((s) => s.toggle)
  if (!watching) return null
  return (
    <button
      type="button"
      aria-pressed={enabled}
      aria-label={t('ui.customWatchAutoGenerate')}
      title={t(enabled ? 'ui.customAutoGenOnTitle' : 'ui.customAutoGenOffTitle')}
      onClick={toggle}
      className={cn(
        'no-drag mx-0.5 flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[11.5px] font-medium transition-colors',
        enabled
          ? 'bg-accent/15 text-accent-ink hover:bg-accent/25'
          : 'text-muted hover:bg-surface-2 hover:text-ink'
      )}
    >
      <Zap size={13} className={cn(enabled && 'fill-current')} />
      {t('ui.customAutoGen')}
    </button>
  )
}
