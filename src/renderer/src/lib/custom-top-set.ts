import type { TopSetResult } from '@shared/types'
import { t } from './i18n'

/** [custom] 대표 세트 받은 결과 한 줄 — 버튼과 감시 폴더 요청 알림이 같이 쓴다 */
export function topSetSummary(result: TopSetResult): string {
  const parts = [
    t(
      'ui.customTopSetSummaryValue',
      result.presetName,
      result.total,
      result.dir,
      result.written,
      result.replaced,
      result.same
    )
  ]
  if (result.failed > 0) parts.push(t('ui.customTopSetFailedValue', result.failed))
  if (result.pending > 0) parts.push(t('ui.customTopSetPendingValue', result.pending))
  if (result.noImage > 0) parts.push(t('ui.customTopSetNoImageValue', result.noImage))
  return parts.join(' · ')
}
