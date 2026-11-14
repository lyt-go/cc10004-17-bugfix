/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// ---- 埋点审计域：事件发布凭据、参数快照、审计异常、修复清单、批次与复核 ----

/** 参数快照：每次发布埋点事件时建立一份，下线后封存，重新发布必须另建新快照。 */
export type EventSnapshot = {
  version: number
  eventCode: string
  params: string
  credential: string
  issuedAt: string
  expiresAt: string
  sealed: boolean
}

/** 审计异常：由审计批次产出；事件下线后停止新增，历史异常封存保留。 */
export type AuditAnomaly = {
  id: string
  ruleCode: string
  eventCode: string
  eventVersion: number
  batchId: string
  title: string
  level: string
  createdAt: string
  state: '未闭环' | '已封存'
}

/** 修复清单条目：永远按生成时的参数快照版本解释，封存后不再改写。 */
export type FixItem = {
  id: string
  ruleCode: string
  eventCode: string
  eventVersion: number
  params: string
  suggestion: string
  state: '待修复' | '已封存'
}

/** 审计批次：开批时绑定事件版本，提交时若规则已关闭或版本已切换则按撞车处理。 */
export type AuditBatch = {
  id: string
  ruleCode: string
  eventCode: string
  eventVersion: number
  state: '进行中' | '已采纳' | '待复核' | '已驳回'
  final: boolean
  createdAt: string
}

/** 复核单：撞车批次不直接写入异常，进入复核队列由归属负责人裁决。 */
export type ReviewRequest = {
  id: string
  batchId: string
  ruleCode: string
  reason: string
  createdAt: string
  state: '待复核' | '已采纳' | '已驳回'
}

export type AuditDomain = {
  snapshots: EventSnapshot[]
  anomalies: AuditAnomaly[]
  fixItems: FixItem[]
  batches: AuditBatch[]
  reviews: ReviewRequest[]
  /** 规则关闭 / 事件版本切换后，每条规则只采纳一个「首个完整审计批次」作为终批。 */
  terminalBatches: Record<string, string>
}

/** 事件质量结论：事件详情页与审计详情页共用同一份，保证两处结论一致。 */
export type QualityConclusion = {
  open: number
  sealed: number
  conclusion: string
}

export type EventDetail = {
  row: EntryRow
  snapshots: EventSnapshot[]
  rules: EntryRow[]
  quality: QualityConclusion
}

export type RuleDetail = {
  row: EntryRow
  event: EntryRow | null
  snapshot: EventSnapshot | null
  anomalies: AuditAnomaly[]
  fixItems: FixItem[]
  quality: QualityConclusion | null
}
