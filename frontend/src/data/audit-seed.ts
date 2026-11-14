import type { AuditDomain } from './types'

// 审计域示例数据：与条目种子配套，首次打开时一起播种。
// 场景：EVEN-0002 已发布（快照V1在有效期内），AUDI-0002 已生效并已产出历史异常与修复清单；
// EVEN-0003 的发布凭据已过有效期，用于演示「生效规则前核对凭据」的拦截。
export const AUDIT_SEED: AuditDomain = {
  snapshots: [
    {
      version: 1,
      eventCode: 'EVEN-0002',
      params: 'user_id,order_id,pay_amount,ab_bucket',
      credential: 'CRED-EVEN-0002-V1',
      issuedAt: '2026-08-01',
      expiresAt: '2027-01-28',
      sealed: false,
    },
    {
      version: 1,
      eventCode: 'EVEN-0003',
      params: 'user_id,sku_id,expo_id',
      credential: 'CRED-EVEN-0003-V1',
      issuedAt: '2026-04-01',
      expiresAt: '2026-09-27',
      sealed: false,
    },
  ],
  anomalies: [
    {
      id: 'ANOM-0001',
      ruleCode: 'AUDI-0002',
      eventCode: 'EVEN-0002',
      eventVersion: 1,
      batchId: 'BATCH-0001',
      title: 'pay_amount校验未通过：支付金额缺失或为负',
      level: '高',
      createdAt: '2026-11-10',
      state: '未闭环',
    },
    {
      id: 'ANOM-0002',
      ruleCode: 'AUDI-0002',
      eventCode: 'EVEN-0002',
      eventVersion: 1,
      batchId: 'BATCH-0002',
      title: 'pay_amount校验未通过：支付金额缺失或为负',
      level: '高',
      createdAt: '2026-11-12',
      state: '未闭环',
    },
  ],
  fixItems: [
    {
      id: 'FIX-0001',
      ruleCode: 'AUDI-0002',
      eventCode: 'EVEN-0002',
      eventVersion: 1,
      params: 'user_id,order_id,pay_amount,ab_bucket',
      suggestion: '核对上报参数与埋点版本',
      state: '待修复',
    },
  ],
  batches: [
    {
      id: 'BATCH-0001',
      ruleCode: 'AUDI-0002',
      eventCode: 'EVEN-0002',
      eventVersion: 1,
      state: '已采纳',
      final: false,
      createdAt: '2026-11-10',
    },
    {
      id: 'BATCH-0002',
      ruleCode: 'AUDI-0002',
      eventCode: 'EVEN-0002',
      eventVersion: 1,
      state: '已采纳',
      final: false,
      createdAt: '2026-11-12',
    },
  ],
  reviews: [],
  terminalBatches: {},
}
