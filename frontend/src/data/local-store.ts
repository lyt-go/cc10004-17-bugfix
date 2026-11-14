import { AUDIT_SEED } from './audit-seed'
import { SEED_ROWS } from './seed'
import type { AuditDomain, EntryRow } from './types'

// 本地持久化：条目与审计域放在同一个存储对象里，刷新、关掉再打开都还在。
// 规则关闭、事件状态和异常清理必须一次提交一致落盘，所以只暴露 transact 一个写入口。
const STORAGE_KEY = 'data-product-ops:store:v2'

export type StoreShape = {
  entries: Record<string, EntryRow[]>
  audit: AuditDomain
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedStore(): StoreShape {
  return { entries: clone(SEED_ROWS), audit: clone(AUDIT_SEED) }
}

function readStorage(): StoreShape {
  const fallback = seedStore()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoreShape>
    return {
      entries: { ...fallback.entries, ...(parsed.entries ?? {}) },
      audit: { ...fallback.audit, ...(parsed.audit ?? {}) },
    }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: StoreShape | null = null

function store(): StoreShape {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

function persist(next: StoreShape): void {
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

/**
 * 一次提交：在草稿上完成全部改动后一次性落盘。
 * 事件下线时的「规则关闭 + 事件状态 + 异常清理」就走这里，保证不会出现写一半的不一致。
 */
export function transact<T>(mutate: (draft: StoreShape) => T): T {
  const draft = clone(store())
  const result = mutate(draft)
  persist(draft)
  return result
}

export function allRows(): Record<string, EntryRow[]> {
  return store().entries
}

export function listRows(key: string): EntryRow[] {
  return store().entries[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  transact((draft) => {
    draft.entries[key] = rows
  })
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  transact((draft) => {
    draft.entries[key] = rows
    if (key === 'eventdef' || key === 'auditcheck') {
      // 事件与审计共用一个生命周期，重置任一侧时两侧和审计域一起回到种子，避免互相错位
      draft.entries.eventdef = clone(SEED_ROWS.eventdef ?? [])
      draft.entries.auditcheck = clone(SEED_ROWS.auditcheck ?? [])
      draft.audit = clone(AUDIT_SEED)
    }
  })
  return rows
}

export function auditDomain(): AuditDomain {
  return store().audit
}

export function storageKey(): string {
  return STORAGE_KEY
}
