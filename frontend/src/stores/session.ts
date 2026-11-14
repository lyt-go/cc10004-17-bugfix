import { useSyncExternalStore } from 'react'

// 会话与角色：归属负责人可以维护自己名下的内容，只读成员只能查看。
// 鉴权判断集中在 api/local-service.ts，页面只负责展示当前操作人。
export type SessionRole = '负责人' | '只读'

export type SessionUser = {
  name: string
  role: SessionRole
}

export const SESSION_USERS: SessionUser[] = [
  { name: '林岚', role: '负责人' },
  { name: '周航', role: '负责人' },
  { name: '沈默', role: '只读' },
]

const SESSION_KEY = 'data-product-ops:session'
const listeners = new Set<() => void>()
let current: SessionUser | null = null

export function getSession(): SessionUser {
  if (current) {
    return current
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    const saved = window.localStorage.getItem(SESSION_KEY)
    const found = SESSION_USERS.find((user) => user.name === saved)
    if (found) {
      current = found
      return found
    }
  }
  current = SESSION_USERS[0]
  return current
}

export function setSession(user: SessionUser): void {
  current = user
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(SESSION_KEY, user.name)
  }
  listeners.forEach((listener) => listener())
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useSession(): SessionUser {
  return useSyncExternalStore(subscribeSession, getSession)
}
