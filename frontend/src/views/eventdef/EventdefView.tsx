import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  downloadEntries,
  getEventDetail,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  updateEventParams,
} from '@/api/local-service'
import type { EntryRow, EventDetail } from '@/data/types'
import { useSession } from '@/stores/session'

const meta = moduleMeta('eventdef')
const columns = [
  "事件编号",
  "事件名称",
  "事件类型",
  "触发条件",
  "上报参数",
  "采样比例",
  "所属产品",
  "事件负责人"
]
const actions = [
  "提交事件评审",
  "发布事件",
  "下线事件"
]
const statuses = [
  "草稿",
  "事件评审中",
  "已发布",
  "已下线"
]
const stats = [
  {
    "label": "埋点事件总数",
    "value": 0
  },
  {
    "label": "已发布事件",
    "value": 0
  },
  {
    "label": "事件评审中",
    "value": 0
  }
]

export default function EventdefView() {
  const operator = useSession()
  const [rows, setRows] = useState<EntryRow[]>([])
  const [total, setTotal] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [notice, setNotice] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [detailId, setDetailId] = useState<number | null>(null)
  const [detail, setDetail] = useState<EventDetail | null>(null)
  const [paramDraft, setParamDraft] = useState('')
  const filterFields = useMemo(() => columns.slice(0, 3), [])

  const reload = useCallback(() => {
    setErrorMessage('')
    try {
      const payload = listEntries(meta.key, filters)
      setRows(payload.items)
      setTotal(payload.total)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '事件定义列表读取失败')
    }
  }, [filters])

  useEffect(() => {
    reload()
  }, [reload])

  useEffect(() => {
    if (detailId === null) {
      setDetail(null)
      return
    }
    const payload = getEventDetail(detailId)
    setDetail(payload)
    setParamDraft(payload ? String(payload.row['上报参数'] ?? '') : '')
  }, [detailId, rows])

  function runAction(action: string, row: EntryRow) {
    setErrorMessage('')
    setNotice('')
    const result = applyAction(meta.key, Number(row.id), action)
    if (!result.ok) {
      setErrorMessage(result.message)
      return
    }
    setNotice(result.message)
    reload()
  }

  function saveParams() {
    if (detailId === null) {
      return
    }
    setErrorMessage('')
    setNotice('')
    const result = updateEventParams(detailId, paramDraft)
    if (!result.ok) {
      setErrorMessage(result.message)
      return
    }
    setNotice(result.message)
    reload()
  }

  const canMaintain = detail !== null && operator.role === '负责人' && operator.name === String(detail.row['事件负责人'])
  const canEditParams = canMaintain && detail !== null && detail.row.status !== '已发布'

  return (
    <section className="page" data-module="eventdef">
      <header className="page-head">
        <div>
          <h2>事件定义管理</h2>
          <p className="page-desc">管理数据产品的埋点事件定义，规范事件命名、参数结构和采样策略。</p>
        </div>
        <div className="page-actions">
          <button className="btn primary" type="button" onClick={() => setErrorMessage('埋点事件登记入口尚未接入审批流')}>
            登记埋点事件
          </button>
          <button className="btn" type="button" onClick={() => downloadEntries(meta.key)}>
            导出事件定义清单
          </button>
        </div>
      </header>

      <div className="stat-row">
        {stats.map((item) => (
          <article key={item.label} className="stat-card">
            <span className="stat-label">{item.label}</span>
            <strong className="stat-value">{item.value}</strong>
          </article>
        ))}
      </div>

      <p className="status-legend">
        {statuses.map((status: string) => (
          <span key={status} className="legend-item">
            {status}：{rows.filter((row) => String(row.status) === status).length}
          </span>
        ))}
        <span className="legend-item">当前操作人：{operator.name}（{operator.role}）</span>
      </p>

      <form className="filter-bar" onSubmit={(event) => { event.preventDefault(); reload() }}>
        {filterFields.map((field) => (
          <label key={field} className="filter-item">
            <span>{field}</span>
            <input
              value={filters[field] ?? ''}
              placeholder={`按${field}检索`}
              onChange={(event) => setFilters((prev) => ({ ...prev, [field]: event.target.value }))}
            />
          </label>
        ))}
        <button className="btn" type="submit">查询</button>
        <button className="btn ghost" type="button" onClick={() => setFilters({})}>重置条件</button>
      </form>

      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => <th key={column}>{column}</th>)}
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.id)}>
              {columns.map((column) => <td key={column}>{row[column] ?? '—'}</td>)}
              <td>{row.status}</td>
              <td className="row-actions">
                {actions.map((action) => (
                  <button key={action} className="link" type="button" onClick={() => runAction(action, row)}>
                    {action}
                  </button>
                ))}
                <button
                  className="link"
                  type="button"
                  onClick={() => setDetailId(detailId === Number(row.id) ? null : Number(row.id))}
                >
                  {detailId === Number(row.id) ? '收起详情' : '详情'}
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="empty-state" colSpan={columns.length + 2}>暂无事件定义数据，可先登记埋点事件</td>
            </tr>
          )}
        </tbody>
      </table>

      {detail && (
        <section className="detail-panel">
          <h3 className="section-title">
            事件详情：{String(detail.row['事件编号'])}（{String(detail.row['事件名称'])}）
            <span className={`badge ${detail.row.status === '已下线' ? 'sealed' : ''}`}>{String(detail.row.status)}</span>
          </h3>

          <div className="detail-grid">
            <div>
              <h4>发布凭据与参数快照</h4>
              <table className="data-table sub-table">
                <thead>
                  <tr><th>版本</th><th>上报参数</th><th>发布凭据</th><th>有效期至</th><th>快照状态</th></tr>
                </thead>
                <tbody>
                  {detail.snapshots.map((snap) => (
                    <tr key={snap.version}>
                      <td>V{snap.version}</td>
                      <td>{snap.params}</td>
                      <td>{snap.credential}</td>
                      <td>{snap.expiresAt}</td>
                      <td>
                        <span className={`badge ${snap.sealed ? 'sealed' : 'active'}`}>
                          {snap.sealed ? '已封存' : '生效中'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {detail.snapshots.length === 0 && (
                    <tr><td className="empty-state" colSpan={5}>尚未发布，没有参数快照</td></tr>
                  )}
                </tbody>
              </table>
              <p className="hint">下线后快照进入封存；重新发布同一事件会建立新的快照，不回填旧版本。</p>
            </div>

            <div>
              <h4>关联审计规则</h4>
              <table className="data-table sub-table">
                <thead>
                  <tr><th>规则编号</th><th>校验字段</th><th>规则状态</th></tr>
                </thead>
                <tbody>
                  {detail.rules.map((rule) => (
                    <tr key={String(rule.id)}>
                      <td>{String(rule['规则编号'])}</td>
                      <td>{String(rule['校验字段'])}</td>
                      <td>{String(rule.status)}</td>
                    </tr>
                  ))}
                  {detail.rules.length === 0 && (
                    <tr><td className="empty-state" colSpan={3}>没有关联的审计规则</td></tr>
                  )}
                </tbody>
              </table>

              <h4>质量结论</h4>
              <p className="quality-line">{detail.quality.conclusion}</p>
              <p className="hint">未闭环异常 {detail.quality.open} 条，已封存历史结论 {detail.quality.sealed} 条。</p>
            </div>
          </div>

          <div className="param-editor">
            <h4>上报参数维护</h4>
            {canEditParams ? (
              <>
                <textarea
                  rows={2}
                  value={paramDraft}
                  onChange={(event) => setParamDraft(event.target.value)}
                />
                <div className="param-actions">
                  <button className="btn" type="button" onClick={saveParams}>保存参数</button>
                  <span className="hint">保存后需重新评审发布，发布时写入新的参数快照。</span>
                </div>
              </>
            ) : (
              <p className="hint">
                {canMaintain
                  ? '已发布事件的参数不可直接修改，请先下线或走评审发布新版本。'
                  : `只有归属负责人（${String(detail.row['事件负责人'])}）可以维护参数，只读成员只能查看。`}
              </p>
            )}
          </div>
        </section>
      )}

      <footer className="page-foot">
        <span>共 {total} 条事件定义记录</span>
        {notice && <span className="notice-text">{notice}</span>}
        {errorMessage && <span className="error-text">{errorMessage}</span>}
      </footer>
    </section>
  )
}
