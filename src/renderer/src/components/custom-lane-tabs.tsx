import { displayOpusUsagePercent } from '@shared/anlas'
import type { MessageId } from '@shared/i18n'
import type { QueueLane } from '@shared/types'
import { useT } from '../lib/i18n'
import { cn } from '../lib/utils'
import { useParallelStore, useQueueLanes, useViewedLane } from '../stores/custom-parallel-store'

const PAUSE_LABEL: Record<NonNullable<QueueLane['pauseReason']>, MessageId> = {
  exhausted: 'ui.customLanePausedExhausted',
  notOpus: 'ui.customLanePausedNotOpus',
  unknown: 'ui.customLanePausedUnknown'
}

/**
 * [custom] 동시 생성 중 미리보기 위 계정 탭 — 계정마다 상태·게이지·이번에 뽑은 수.
 * 누르면 가운데 미리보기가 그 계정의 진행을 보여 준다.
 */
export function LaneTabs(): React.JSX.Element | null {
  const t = useT()
  const lanes = useQueueLanes()
  const viewed = useViewedLane()
  const accounts = useParallelStore((s) => s.accounts)
  const balances = useParallelStore((s) => s.balances)
  const setViewLane = useParallelStore((s) => s.setViewLane)
  if (!lanes || lanes.length < 2) return null

  return (
    <div
      role="tablist"
      aria-label={t('ui.customLaneTabs')}
      // 왼쪽 위 — 세로 그림은 보통 가운데에 놓이고 얼굴이 위쪽 가운데라 가리지 않게.
      // 빈 자리는 클릭·창 끌기를 그대로 통과시키고 탭만 누를 수 있게 한다
      className="pointer-events-none absolute left-2 right-2 top-2 z-30 flex flex-wrap gap-1.5"
    >
      {lanes.map((lane, index) => {
        const label =
          accounts.find((a) => a.id === lane.accountId)?.label ?? `#${String(index + 1)}`
        const selected = viewed?.accountId === lane.accountId
        const balance = balances[lane.accountId]
        const gauge =
          balance?.tier === 'opus' && balance.usage ? displayOpusUsagePercent(balance.usage) : null
        const status = lane.generatingId
          ? t('ui.customLaneGenerating')
          : lane.pauseReason
            ? t(PAUSE_LABEL[lane.pauseReason])
            : t('ui.customLaneIdle')
        const done = t('ui.customLaneDoneValue', lane.done)
        const title = [
          label,
          status,
          gauge != null ? t('ui.customLaneGaugeValue', gauge) : null,
          balance?.anlas != null ? `Anlas ${balance.anlas}` : null,
          done
        ]
          .filter(Boolean)
          .join(' · ')
        return (
          <button
            key={lane.accountId}
            type="button"
            role="tab"
            aria-selected={selected}
            title={title}
            onClick={() => setViewLane(lane.accountId)}
            className={cn(
              'no-drag pointer-events-auto flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] backdrop-blur transition-colors',
              selected
                ? 'border-accent bg-paper/95 text-ink'
                : 'border-line bg-paper/75 text-muted hover:text-ink'
            )}
          >
            <span
              aria-hidden
              className={cn(
                'size-2 shrink-0 rounded-full',
                lane.generatingId
                  ? 'animate-pulse bg-success'
                  : lane.pauseReason
                    ? 'bg-warning'
                    : 'bg-faint'
              )}
            />
            <span className="max-w-[8rem] truncate font-medium">{label}</span>
            <span className={cn(lane.pauseReason && !lane.generatingId && 'text-warning-ink')}>
              {status}
            </span>
            {gauge != null && (
              <span
                className={cn(
                  'font-mono text-[11px]',
                  balance?.usage?.isNegative ? 'text-danger-ink' : 'text-faint'
                )}
              >
                {gauge}%
              </span>
            )}
            <span className="text-[11px] text-faint">{done}</span>
          </button>
        )
      })}
    </div>
  )
}
