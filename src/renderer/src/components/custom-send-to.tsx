import { useT } from '../lib/i18n'
import { useParallelStore, useQueueLanes } from '../stores/custom-parallel-store'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

const AUTO = 'auto'

/**
 * [custom] 동시 생성 중 생성 버튼 위 '보낼 곳' — 새로 넣는 생성을 맡을 계정.
 * 자동이면 비어 있는 계정이 가져간다. 동시 생성이 아니면 보이지 않는다.
 */
export function SendToPicker(): React.JSX.Element | null {
  const t = useT()
  const lanes = useQueueLanes()
  const accounts = useParallelStore((s) => s.accounts)
  const target = useParallelStore((s) => s.config.target)
  const setTarget = useParallelStore((s) => s.setTarget)
  if (!lanes) return null
  const value = target && lanes.some((l) => l.accountId === target) ? target : AUTO
  return (
    <div className="flex items-center gap-2" title={t('ui.customSendToHint')}>
      <span className="shrink-0 text-[12px] text-muted">{t('ui.customSendTo')}</span>
      <Select value={value} onValueChange={(v) => void setTarget(v === AUTO ? null : v)}>
        <SelectTrigger className="h-8 min-w-0 flex-1" aria-label={t('ui.customSendTo')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO}>{t('ui.customSendToAuto')}</SelectItem>
          {lanes.map((lane, index) => (
            <SelectItem key={lane.accountId} value={lane.accountId}>
              {accounts.find((a) => a.id === lane.accountId)?.label ?? `#${String(index + 1)}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
