import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  commitAuditBatch,
  downloadEntries,
  getRuleDetail,
  listBatches,
  listEntries,
  listReviews,
  moduleMeta,
  resolveReview,
  runAction as applyAction,
  startAuditBatch,
} from '@/api/local-service'
import type { AuditBatch, EntryRow, ReviewRequest, RuleDetail } from '@/data/types'
import { useSession } from '@/stores/session'

const meta = moduleMeta('auditcheck')
const columns = [
  "规则编号",
  "审计对象",
  "校验字段",
  "异常条件",
  "告警级别",
  "审计频率",
  "修复建议",
  "规则状态"
]
const actions = [
  "提交规则评审",
  "生效规则",
  "关闭规则"
]
const statuses = [
  "草稿",
  "规则评审中",
  "已生效",
  "已关闭"
]
const stats = [
  {
    "label": "审计规则总数",
    "value": 0
  },
  {
    "label": "已生效规则",
    "value": 0
  },
  {
    "label": "规则评审中",
    "value": 0
  }
]

export default function AuditcheckView() {
  const operator = useSession()
  const [rows, setRows] = useState<EntryRow[]>([])
  const [total, setTotal] = useState(0)
  const [batches, setBatches] = useState<AuditBatch[]>([])
  const [reviews, setReviews] = useState<ReviewRequest[]>([])
  const [errorMessage, setErrorMessage] = useState('')
  const [notice, setNotice] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [detailId, setDetailId] = useState<number | null>(null)
  const [detail, setDetail] = useState<RuleDetail | null>(null)
  const filterFields = useMemo(() => columns.slice(0, 3), [])

  const reload = useCallback(() => {
    setErrorMessage('')
    try {
      const payload = listEntries(meta.key, filters)
      setRows(payload.items)
      setTotal(payload.total)
      setBatches(listBatches())
      setReviews(listReviews())
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '数据审计列表读取失败')
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
    setDetail(getRuleDetail(detailId))
  }, [detailId, rows, batches])

  function report(result: { ok: boolean; message: string }) {
    if (!result.ok) {
      setErrorMessage(result.message)
      return
    }
    setNotice(result.message)
    reload()
  }

  function runAction(action: string, row: EntryRow) {
    setErrorMessage('')
    setNotice('')
    report(applyAction(meta.key, Number(row.id), action))
  }

  function runBatch(row: EntryRow) {
    setErrorMessage('')
    setNotice('')
    report(startAuditBatch(Number(row.id)))
  }

  const openBatches = batches.filter((batch) => batch.state === '进行中')
  const pendingReviews = reviews.filter((review) => review.state === '待复核')
  const fixVersions = detail ? [...new Set(detail.fixItems.map((item) => item.eventVersion))].sort((a, b) => b - a) : []

  return (
    <section className="page" data-module="auditcheck">
      <header className="page-head">
        <div>
          <h2>数据审计管理</h2>
          <p className="page-desc">定义数据产品的数据质量审计规则，对埋点丢失、口径漂移和异常波动进行监测。</p>
        </div>
        <div className="page-actions">
          <button className="btn primary" type="button" onClick={() => setErrorMessage('审计规则登记入口尚未接入审批流')}>
            登记审计规则
          </button>
          <button className="btn" type="button" onClick={() => downloadEntries(meta.key)}>
            导出数据审计清单
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
                  onClick={() => runBatch(row)}
                  disabled={row.status !== '已生效'}
                >
                  开启审计批次
                </button>
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
              <td className="empty-state" colSpan={columns.length + 2}>暂无数据审计数据，可先登记审计规则</td>
            </tr>
          )}
        </tbody>
      </table>

      {detail && (
        <section className="detail-panel">
          <h3 className="section-title">
            规则详情：{String(detail.row['规则编号'])}
            <span className={`badge ${detail.row.status === '已关闭' ? 'sealed' : ''}`}>{String(detail.row.status)}</span>
          </h3>

          <div className="detail-grid">
            <div>
              <h4>审计对象</h4>
              {detail.event ? (
                <p className="quality-line">
                  {String(detail.event['事件编号'])}（{String(detail.event['事件名称'])}）：
                  事件状态「{String(detail.event.status)}」，
                  {detail.snapshot
                    ? `当前快照 V${detail.snapshot.version}（${detail.snapshot.sealed ? '已封存' : `生效中，凭据 ${detail.snapshot.credential} 有效期至 ${detail.snapshot.expiresAt}`}）`
                    : '暂无参数快照'}
                </p>
              ) : (
                <p className="quality-line">审计对象未登记</p>
              )}
              {detail.quality && (
                <>
                  <h4>事件质量结论</h4>
                  <p className="quality-line">{detail.quality.conclusion}</p>
                </>
              )}

              <h4>审计异常（{detail.anomalies.length}）</h4>
              <table className="data-table sub-table">
                <thead>
                  <tr><th>异常编号</th><th>批次</th><th>版本</th><th>级别</th><th>内容</th><th>状态</th></tr>
                </thead>
                <tbody>
                  {detail.anomalies.map((item) => (
                    <tr key={item.id}>
                      <td>{item.id}</td>
                      <td>{item.batchId}</td>
                      <td>V{item.eventVersion}</td>
                      <td>{item.level}</td>
                      <td>{item.title}</td>
                      <td><span className={`badge ${item.state === '已封存' ? 'sealed' : 'warn'}`}>{item.state}</span></td>
                    </tr>
                  ))}
                  {detail.anomalies.length === 0 && (
                    <tr><td className="empty-state" colSpan={6}>暂无审计异常</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div>
              <h4>修复清单（按参数快照版本解释）</h4>
              {fixVersions.map((version) => (
                <div key={version} className="fix-group">
                  <h5>
                    快照 V{version}
                    {detail.snapshot && detail.snapshot.version === version && !detail.snapshot.sealed
                      ? <span className="badge active">现行版本</span>
                      : <span className="badge sealed">历史版本</span>}
                  </h5>
                  <table className="data-table sub-table">
                    <thead>
                      <tr><th>清单编号</th><th>上报参数</th><th>修复建议</th><th>状态</th></tr>
                    </thead>
                    <tbody>
                      {detail.fixItems.filter((item) => item.eventVersion === version).map((item) => (
                        <tr key={item.id}>
                          <td>{item.id}</td>
                          <td>{item.params}</td>
                          <td>{item.suggestion}</td>
                          <td><span className={`badge ${item.state === '已封存' ? 'sealed' : 'warn'}`}>{item.state}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
              {detail.fixItems.length === 0 && <p className="hint">暂无修复清单</p>}
              <p className="hint">历史修复清单按生成时的参数快照版本解释，封存后不再改写；重新发布事件后，新清单按新快照生成。</p>
            </div>
          </div>
        </section>
      )}

      <section className="detail-panel">
        <h3 className="section-title">进行中的审计批次（{openBatches.length}）</h3>
        <table className="data-table sub-table">
          <thead>
            <tr><th>批次编号</th><th>规则</th><th>事件</th><th>开批版本</th><th>开批时间</th><th>操作</th></tr>
          </thead>
          <tbody>
            {openBatches.map((batch) => (
              <tr key={batch.id}>
                <td>{batch.id}</td>
                <td>{batch.ruleCode}</td>
                <td>{batch.eventCode}</td>
                <td>V{batch.eventVersion}</td>
                <td>{batch.createdAt}</td>
                <td>
                  <button className="link" type="button" onClick={() => { setErrorMessage(''); setNotice(''); report(commitAuditBatch(batch.id)) }}>
                    提交批次
                  </button>
                </td>
              </tr>
            ))}
            {openBatches.length === 0 && (
              <tr><td className="empty-state" colSpan={6}>暂无进行中的批次，可在已生效规则上开启审计批次</td></tr>
            )}
          </tbody>
        </table>
        <p className="hint">批次提交时若规则已关闭或事件版本已切换：只采纳首个完整审计批次作为终批，后到批次进入复核。</p>
      </section>

      <section className="detail-panel">
        <h3 className="section-title">复核队列（{pendingReviews.length}）</h3>
        <table className="data-table sub-table">
          <thead>
            <tr><th>复核单</th><th>批次</th><th>规则</th><th>撞车原因</th><th>状态</th><th>操作</th></tr>
          </thead>
          <tbody>
            {reviews.map((review) => (
              <tr key={review.id}>
                <td>{review.id}</td>
                <td>{review.batchId}</td>
                <td>{review.ruleCode}</td>
                <td>{review.reason}</td>
                <td><span className={`badge ${review.state === '待复核' ? 'warn' : 'sealed'}`}>{review.state}</span></td>
                <td className="row-actions">
                  {review.state === '待复核' && (
                    <>
                      <button className="link" type="button" onClick={() => { setErrorMessage(''); setNotice(''); report(resolveReview(review.id, true)) }}>采纳</button>
                      <button className="link" type="button" onClick={() => { setErrorMessage(''); setNotice(''); report(resolveReview(review.id, false)) }}>驳回</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {reviews.length === 0 && (
              <tr><td className="empty-state" colSpan={6}>暂无复核请求</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <footer className="page-foot">
        <span>共 {total} 条数据审计记录</span>
        {notice && <span className="notice-text">{notice}</span>}
        {errorMessage && <span className="error-text">{errorMessage}</span>}
      </footer>
    </section>
  )
}
