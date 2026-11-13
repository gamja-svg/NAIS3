/** [custom] 감시 폴더 자동 생성 — 대기 중인 생성까지 합쳐 이 장수를 넘기면 자동으로 생성하지 않는다 */
export const WATCH_AUTOGEN_LIMIT = 30

/**
 * 바뀐 씬을 자동으로 생성해도 되는지. 대기열에 이미 쌓인 것(손으로 건 것 포함)과 합쳐 한도를 넘으면
 * 하나도 넣지 않는다 — 일부만 넣으면 무엇이 빠졌는지 알기 어렵다.
 */
export function canAutoGenerate(
  changed: number,
  pending: number,
  limit = WATCH_AUTOGEN_LIMIT
): boolean {
  return changed > 0 && changed + pending <= limit
}
