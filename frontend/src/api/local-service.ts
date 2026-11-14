import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, auditDomain, listRows, resetRows, saveRows, transact } from '@/data/local-store'
import type { StoreShape } from '@/data/local-store'
import { getSession } from '@/stores/session'
import type {
  ActionResult,
  AuditBatch,
  EntryRow,
  EventDetail,
  EventSnapshot,
  ModuleMeta,
  OverviewResult,
  PageResult,
  QualityConclusion,
  ReviewRequest,
  RuleDetail,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
// 只用于没有专门生命周期引擎的通用模块；事件定义与数据审计走下面的专门流转。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

const EVENT_KEY = 'eventdef'
const RULE_KEY = 'auditcheck'
const DAY_MS = 24 * 60 * 60 * 1000
/** 发布凭据有效期：签发后 180 天。 */
const CREDENTIAL_VALID_DAYS = 180

function deny(message: string): ActionResult {
  return { ok: false, message }
}

function ok(message: string): ActionResult {
  return { ok: true, message }
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function plusDays(base: string, days: number): string {
  return new Date(new Date(`${base}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10)
}

function nextCode(prefix: string, ids: string[]): string {
  const max = ids.reduce((acc, id) => {
    const num = Number(id.replace(`${prefix}-`, ''))
    return Number.isFinite(num) ? Math.max(acc, num) : acc
  }, 0)
  return `${prefix}-${String(max + 1).padStart(4, '0')}`
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

// ---- 鉴权：只有归属负责人可以维护，只读成员只能查看 ----

function checkMaintainer(owner: string): ActionResult | null {
  const user = getSession()
  if (user.role === '只读') {
    return deny(`只读成员「${user.name}」只能查看共享内容，不能改动`)
  }
  if (owner && user.name !== owner) {
    return deny(`越权提交被拒绝：该内容的归属负责人是「${owner}」，当前操作人「${user.name}」无权维护`)
  }
  return null
}

function eventOwner(row: EntryRow): string {
  return String(row['事件负责人'] ?? '')
}

/** 审计规则的归属负责人跟随其审计对象（埋点事件）的负责人。 */
function ruleOwner(rule: EntryRow): string {
  const event = listRows(EVENT_KEY).find((row) => String(row['事件编号']) === String(rule['审计对象']))
  return event ? eventOwner(event) : ''
}

// ---- 审计域查询 ----

function snapshotsOf(eventCode: string): EventSnapshot[] {
  return auditDomain()
    .snapshots.filter((snap) => snap.eventCode === eventCode)
    .sort((a, b) => a.version - b.version)
}

function currentSnapshot(eventCode: string): EventSnapshot | null {
  const list = snapshotsOf(eventCode)
  return list.length > 0 ? list[list.length - 1] : null
}

/** 事件质量结论：事件详情页与审计详情页都从这里取，保证两处口径一致。 */
export function eventQuality(eventCode: string): QualityConclusion {
  const event = listRows(EVENT_KEY).find((row) => String(row['事件编号']) === eventCode)
  const anomalies = auditDomain().anomalies.filter((item) => item.eventCode === eventCode)
  const open = anomalies.filter((item) => item.state === '未闭环').length
  const sealed = anomalies.filter((item) => item.state === '已封存').length
  let conclusion: string
  if (!event) {
    conclusion = '事件未登记，暂无质量结论'
  } else if (event.status === '已发布') {
    conclusion = open > 0 ? `质量预警：${open} 条未闭环异常待处理` : '质量正常：无未闭环异常'
  } else if (event.status === '已下线') {
    conclusion = `已下线封存：保留 ${sealed} 条历史质量结论，停止新增审计异常`
  } else {
    conclusion = `当前状态「${String(event.status)}」，尚未产生审计结论`
  }
  return { open, sealed, conclusion }
}

export function getEventDetail(id: number): EventDetail | null {
  const row = listRows(EVENT_KEY).find((item) => Number(item.id) === id)
  if (!row) {
    return null
  }
  const code = String(row['事件编号'])
  return {
    row,
    snapshots: snapshotsOf(code),
    rules: listRows(RULE_KEY).filter((rule) => String(rule['审计对象']) === code),
    quality: eventQuality(code),
  }
}

export function getRuleDetail(id: number): RuleDetail | null {
  const row = listRows(RULE_KEY).find((item) => Number(item.id) === id)
  if (!row) {
    return null
  }
  const ruleCode = String(row['规则编号'])
  const eventCode = String(row['审计对象'])
  const event = listRows(EVENT_KEY).find((item) => String(item['事件编号']) === eventCode) ?? null
  return {
    row,
    event,
    snapshot: currentSnapshot(eventCode),
    anomalies: auditDomain().anomalies.filter((item) => item.ruleCode === ruleCode),
    fixItems: auditDomain().fixItems.filter((item) => item.ruleCode === ruleCode),
    quality: event ? eventQuality(eventCode) : null,
  }
}

export function listBatches(): AuditBatch[] {
  return auditDomain().batches
}

export function listReviews(): ReviewRequest[] {
  return auditDomain().reviews
}

// ---- 埋点事件生命周期：草稿 → 事件评审中 → 已发布 → 已下线（封存） ----

function runEventAction(id: number, action: string): ActionResult {
  const row = listRows(EVENT_KEY).find((item) => Number(item.id) === id)
  if (!row) {
    return deny(`没有找到编号为 ${id} 的埋点事件`)
  }
  const forbidden = checkMaintainer(eventOwner(row))
  if (forbidden) {
    return forbidden
  }
  const code = String(row['事件编号'])
  const status = String(row.status)

  if (action === '提交事件评审') {
    if (status !== '草稿' && status !== '已下线') {
      return deny(`只有「草稿」或「已下线」的事件能提交评审，当前状态「${status}」`)
    }
    transact((draft) => {
      const target = draft.entries[EVENT_KEY].find((item) => Number(item.id) === id)
      if (target) {
        target.status = '事件评审中'
        target.pending = true
      }
    })
    return ok(status === '已下线' ? '埋点事件已重新提交事件评审（重新发布流程）' : '埋点事件已提交事件评审')
  }

  if (action === '发布事件') {
    if (status !== '事件评审中') {
      return deny('埋点事件必须先通过评审才能发布')
    }
    const version = (currentSnapshot(code)?.version ?? 0) + 1
    const credential = `CRED-${code}-V${version}`
    const expiresAt = plusDays(today(), CREDENTIAL_VALID_DAYS)
    transact((draft) => {
      const target = draft.entries[EVENT_KEY].find((item) => Number(item.id) === id)
      if (!target) {
        return
      }
      target.status = '已发布'
      target.pending = false
      target.abnormal = false
      // 重新发布同一事件必须建立新的快照：旧快照保持封存，新快照按当前参数生成
      for (const snap of draft.audit.snapshots) {
        if (snap.eventCode === code) {
          snap.sealed = true
        }
      }
      draft.audit.snapshots.push({
        version,
        eventCode: code,
        params: String(target['上报参数'] ?? ''),
        credential,
        issuedAt: today(),
        expiresAt,
        sealed: false,
      })
    })
    return ok(`埋点事件已发布：建立参数快照V${version}，发布凭据 ${credential} 有效期至 ${expiresAt}`)
  }

  if (action === '下线事件') {
    if (status !== '已发布') {
      return deny(`只有「已发布」的事件才能下线，当前状态「${status}」`)
    }
    let closedRules = 0
    let sealedAnomalies = 0
    // 一次提交：事件状态、规则关闭、异常清理一起落盘，下线后进入封存
    transact((draft) => {
      const target = draft.entries[EVENT_KEY].find((item) => Number(item.id) === id)
      if (!target) {
        return
      }
      target.status = '已下线'
      target.pending = false
      target.abnormal = false
      // 当前参数快照即刻封存，留档不可改
      for (const snap of draft.audit.snapshots) {
        if (snap.eventCode === code && !snap.sealed) {
          snap.sealed = true
        }
      }
      // 关联的生效规则同批关闭：停止新增审计异常，历史质量结论封存保留
      for (const rule of draft.entries[RULE_KEY]) {
        if (String(rule['审计对象']) !== code || rule.status !== '已生效') {
          continue
        }
        rule.status = '已关闭'
        rule.pending = false
        closedRules += 1
        const ruleCode = String(rule['规则编号'])
        for (const anomaly of draft.audit.anomalies) {
          if (anomaly.ruleCode === ruleCode && anomaly.state === '未闭环') {
            anomaly.state = '已封存'
            sealedAnomalies += 1
          }
        }
        for (const item of draft.audit.fixItems) {
          if (item.ruleCode === ruleCode && item.state === '待修复') {
            item.state = '已封存'
          }
        }
        // 终批窗口重置：关闭后撞上来的首个完整批次仍可采纳，之后的进复核
        delete draft.audit.terminalBatches[ruleCode]
      }
    })
    return ok(`埋点事件已下线并封存：同批关闭关联规则 ${closedRules} 条、封存历史异常 ${sealedAnomalies} 条，停止新增审计异常`)
  }

  return deny(`埋点事件没有登记「${action}」这个动作`)
}

/** 维护上报参数：已发布的参数不可直接改，改动需走重新评审发布，发布时写入新快照。 */
export function updateEventParams(id: number, params: string): ActionResult {
  const row = listRows(EVENT_KEY).find((item) => Number(item.id) === id)
  if (!row) {
    return deny(`没有找到编号为 ${id} 的埋点事件`)
  }
  const forbidden = checkMaintainer(eventOwner(row))
  if (forbidden) {
    return forbidden
  }
  if (row.status === '已发布') {
    return deny('已发布事件的参数不可直接修改：请先下线，或走评审发布新版本')
  }
  const trimmed = params.trim()
  if (!trimmed) {
    return deny('上报参数不能为空')
  }
  transact((draft) => {
    const target = draft.entries[EVENT_KEY].find((item) => Number(item.id) === id)
    if (target) {
      target['上报参数'] = trimmed
    }
  })
  return ok('上报参数已更新，将在下次发布时写入新的参数快照')
}

// ---- 审计规则生命周期：草稿 → 规则评审中 → 已生效 → 已关闭 ----

function runRuleAction(id: number, action: string): ActionResult {
  const row = listRows(RULE_KEY).find((item) => Number(item.id) === id)
  if (!row) {
    return deny(`没有找到编号为 ${id} 的审计规则`)
  }
  const forbidden = checkMaintainer(ruleOwner(row))
  if (forbidden) {
    return forbidden
  }
  const status = String(row.status)
  const ruleCode = String(row['规则编号'])
  const eventCode = String(row['审计对象'])

  if (action === '提交规则评审') {
    if (status !== '草稿' && status !== '已关闭') {
      return deny(`只有「草稿」或「已关闭」的规则能提交评审，当前状态「${status}」`)
    }
    transact((draft) => {
      const target = draft.entries[RULE_KEY].find((item) => Number(item.id) === id)
      if (target) {
        target.status = '规则评审中'
        target.pending = true
      }
    })
    return ok(status === '已关闭' ? '审计规则已重新提交评审（再次启用流程）' : '审计规则已提交规则评审')
  }

  if (action === '生效规则') {
    if (status !== '规则评审中') {
      return deny(`只有「规则评审中」的规则能生效，当前状态「${status}」`)
    }
    // 启动前核对：发布凭据与参数快照都要在有效期内
    const event = listRows(EVENT_KEY).find((item) => String(item['事件编号']) === eventCode)
    if (!event) {
      return deny(`审计对象 ${eventCode} 未登记，规则不能生效`)
    }
    if (event.status !== '已发布') {
      return deny(`审计对象 ${eventCode} 当前状态「${String(event.status)}」，不是已发布，规则不能生效`)
    }
    const snapshot = currentSnapshot(eventCode)
    if (!snapshot || snapshot.sealed) {
      return deny(`事件 ${eventCode} 的参数快照已封存，规则不能生效`)
    }
    if (snapshot.expiresAt < today()) {
      return deny(`发布凭据 ${snapshot.credential} 已过有效期（${snapshot.expiresAt}），规则不能生效`)
    }
    transact((draft) => {
      const target = draft.entries[RULE_KEY].find((item) => Number(item.id) === id)
      if (target) {
        target.status = '已生效'
        target.pending = false
      }
      // 重新生效即开启新的终批窗口
      delete draft.audit.terminalBatches[ruleCode]
    })
    return ok(`审计规则已生效：已核对发布凭据 ${snapshot.credential} 与参数快照V${snapshot.version} 均在有效期内`)
  }

  if (action === '关闭规则') {
    if (status !== '已生效' && status !== '规则评审中') {
      return deny(`只有「已生效」或「规则评审中」的规则能关闭，当前状态「${status}」`)
    }
    let sealedAnomalies = 0
    transact((draft) => {
      const target = draft.entries[RULE_KEY].find((item) => Number(item.id) === id)
      if (target) {
        target.status = '已关闭'
        target.pending = false
      }
      for (const anomaly of draft.audit.anomalies) {
        if (anomaly.ruleCode === ruleCode && anomaly.state === '未闭环') {
          anomaly.state = '已封存'
          sealedAnomalies += 1
        }
      }
      for (const item of draft.audit.fixItems) {
        if (item.ruleCode === ruleCode && item.state === '待修复') {
          item.state = '已封存'
        }
      }
      delete draft.audit.terminalBatches[ruleCode]
    })
    return ok(`审计规则已关闭：停止新增审计异常，封存历史异常 ${sealedAnomalies} 条，质量结论保留`)
  }

  return deny(`审计规则没有登记「${action}」这个动作`)
}

// ---- 审计批次：开批绑定事件版本，提交时处理「关闭 / 版本切换」撞车 ----

export function startAuditBatch(ruleId: number): ActionResult {
  const rule = listRows(RULE_KEY).find((item) => Number(item.id) === ruleId)
  if (!rule) {
    return deny(`没有找到编号为 ${ruleId} 的审计规则`)
  }
  const forbidden = checkMaintainer(ruleOwner(rule))
  if (forbidden) {
    return forbidden
  }
  if (rule.status !== '已生效') {
    return deny(`只有「已生效」的规则才能开启审计批次，当前状态「${String(rule.status)}」`)
  }
  const eventCode = String(rule['审计对象'])
  const snapshot = currentSnapshot(eventCode)
  if (!snapshot || snapshot.sealed) {
    return deny(`事件 ${eventCode} 没有生效中的参数快照，不能开批`)
  }
  const batchId = nextCode('BATCH', auditDomain().batches.map((item) => item.id))
  transact((draft) => {
    draft.audit.batches.push({
      id: batchId,
      ruleCode: String(rule['规则编号']),
      eventCode,
      eventVersion: snapshot.version,
      state: '进行中',
      final: false,
      createdAt: today(),
    })
  })
  return ok(`已开启审计批次 ${batchId}（基于参数快照V${snapshot.version}）`)
}

/** 在草稿上落实一个批次：产出 1 条审计异常与 1 条修复清单（按批次对应版本的快照参数解释）。 */
function applyBatch(
  draft: StoreShape,
  batchId: string,
  anomalyState: '未闭环' | '已封存',
  fixState: '待修复' | '已封存',
  final: boolean,
): void {
  const batch = draft.audit.batches.find((item) => item.id === batchId)
  if (!batch) {
    return
  }
  batch.state = '已采纳'
  batch.final = final
  const rule = draft.entries[RULE_KEY].find((item) => String(item['规则编号']) === batch.ruleCode)
  const snapshot = draft.audit.snapshots.find(
    (item) => item.eventCode === batch.eventCode && item.version === batch.eventVersion,
  )
  draft.audit.anomalies.push({
    id: nextCode('ANOM', draft.audit.anomalies.map((item) => item.id)),
    ruleCode: batch.ruleCode,
    eventCode: batch.eventCode,
    eventVersion: batch.eventVersion,
    batchId,
    title: `${String(rule?.['校验字段'] ?? '')}校验未通过：${String(rule?.['异常条件'] ?? '')}`,
    level: String(rule?.['告警级别'] ?? '中'),
    createdAt: today(),
    state: anomalyState,
  })
  draft.audit.fixItems.push({
    id: nextCode('FIX', draft.audit.fixItems.map((item) => item.id)),
    ruleCode: batch.ruleCode,
    eventCode: batch.eventCode,
    eventVersion: batch.eventVersion,
    // 修复清单按生成时的参数快照版本解释，不会沿用其他版本的参数
    params: snapshot?.params ?? '',
    suggestion: String(rule?.['修复建议'] ?? ''),
    state: fixState,
  })
}

export function commitAuditBatch(batchId: string): ActionResult {
  const batch = auditDomain().batches.find((item) => item.id === batchId)
  if (!batch) {
    return deny(`没有找到审计批次 ${batchId}`)
  }
  if (batch.state !== '进行中') {
    return deny(`批次 ${batchId} 当前状态「${batch.state}」，不能重复提交`)
  }
  const rule = listRows(RULE_KEY).find((item) => String(item['规则编号']) === batch.ruleCode)
  if (!rule) {
    return deny(`批次 ${batchId} 关联的规则 ${batch.ruleCode} 不存在`)
  }
  const forbidden = checkMaintainer(ruleOwner(rule))
  if (forbidden) {
    return forbidden
  }
  const event = listRows(EVENT_KEY).find((item) => String(item['事件编号']) === batch.eventCode)
  const snapshot = currentSnapshot(batch.eventCode)
  const versionMatch =
    !!event &&
    event.status === '已发布' &&
    !!snapshot &&
    !snapshot.sealed &&
    snapshot.version === batch.eventVersion
  const ruleActive = String(rule.status) === '已生效'

  if (ruleActive && versionMatch) {
    transact((draft) => applyBatch(draft, batchId, '未闭环', '待修复', false))
    return ok(`审计批次 ${batchId} 已采纳：新增 1 条审计异常与 1 条修复清单（快照V${batch.eventVersion}）`)
  }

  // 撞车：规则关闭或事件版本切换期间提交的批次，只采纳首个完整审计批次作为终批
  const terminal = auditDomain().terminalBatches[batch.ruleCode]
  if (!terminal) {
    transact((draft) => {
      applyBatch(draft, batchId, '已封存', '已封存', true)
      draft.audit.terminalBatches[batch.ruleCode] = batchId
    })
    return ok(`规则已关闭或事件版本已切换：批次 ${batchId} 作为首个完整审计批次采纳为终批，产出已封存`)
  }

  // 后到请求不写入异常，进入复核队列
  const reviewId = nextCode('REV', auditDomain().reviews.map((item) => item.id))
  transact((draft) => {
    const target = draft.audit.batches.find((item) => item.id === batchId)
    if (target) {
      target.state = '待复核'
    }
    draft.audit.reviews.push({
      id: reviewId,
      batchId,
      ruleCode: batch.ruleCode,
      reason: `晚于终批 ${terminal} 提交，与规则关闭 / 事件版本切换撞车`,
      createdAt: today(),
      state: '待复核',
    })
  })
  return ok(`批次 ${batchId} 与已采纳终批撞车，已进入复核队列（${reviewId}），未写入审计异常`)
}

export function resolveReview(reviewId: string, accept: boolean): ActionResult {
  const review = auditDomain().reviews.find((item) => item.id === reviewId)
  if (!review) {
    return deny(`没有找到复核单 ${reviewId}`)
  }
  if (review.state !== '待复核') {
    return deny(`复核单 ${reviewId} 已处理，当前状态「${review.state}」`)
  }
  const rule = listRows(RULE_KEY).find((item) => String(item['规则编号']) === review.ruleCode)
  const forbidden = checkMaintainer(rule ? ruleOwner(rule) : '')
  if (forbidden) {
    return forbidden
  }
  transact((draft) => {
    const target = draft.audit.reviews.find((item) => item.id === reviewId)
    if (!target) {
      return
    }
    if (accept) {
      target.state = '已采纳'
      // 复核采纳的批次按历史数据处理：产出直接封存，不改写现行清单
      applyBatch(draft, review.batchId, '已封存', '已封存', false)
    } else {
      target.state = '已驳回'
      const batch = draft.audit.batches.find((item) => item.id === review.batchId)
      if (batch) {
        batch.state = '已驳回'
      }
    }
  })
  return ok(accept ? `复核单 ${reviewId} 已采纳，批次产出按历史数据封存` : `复核单 ${reviewId} 已驳回`)
}

// ---- 通用列表 / 动作 / 导出 ----

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  if (key === EVENT_KEY) {
    return runEventAction(id, action)
  }
  if (key === RULE_KEY) {
    return runRuleAction(id, action)
  }
  const user = getSession()
  if (user.role === '只读') {
    return deny(`只读成员「${user.name}」只能查看共享内容，不能改动`)
  }
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return deny(`${meta.entity}没有登记「${action}」这个动作`)
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return deny(`没有找到编号为 ${id} 的${meta.entity}`)
  }
  const current = String(rows[index].status)
  if (current === target) {
    return deny(`${meta.entity}已经是「${target}」，不用重复操作`)
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return ok(`${meta.entity}已${action}，当前状态「${target}」`)
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
