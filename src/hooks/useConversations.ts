import { useCallback, useEffect, useRef, useState } from 'react'
import { Conversation, Message, TokenUsage } from '../types'
import { ipcRenderer } from '../electron-ipc'

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function nowISO() {
  return new Date().toISOString()
}

function summarizeTitle(messages: Message[]): string {
  const firstUser = messages.find(m => m.role === 'user')
  if (!firstUser) return '新会话'
  const text = firstUser.content.trim()
  return text.length > 24 ? text.slice(0, 24) + '…' : text
}

function accumulateTokenUsage(messages: Message[]): TokenUsage | undefined {
  let prompt = 0, completion = 0, total = 0
  let hasAny = false
  for (const m of messages) {
    if (m.tokenUsage) {
      hasAny = true
      prompt += m.tokenUsage.prompt
      completion += m.tokenUsage.completion
      total += m.tokenUsage.total
    }
  }
  return hasAny ? { prompt, completion, total } : undefined
}

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 加载会话
  useEffect(() => {
    if (!ipcRenderer) {
      // 浏览器模式：从 localStorage 加载
      try {
        const raw = localStorage.getItem('fsa-conversations')
        if (raw) {
          const parsed = JSON.parse(raw)
          setConversations(parsed)
          if (parsed.length > 0) setActiveId(parsed[0].id)
        }
      } catch { /* ignore */ }
      setLoaded(true)
      return
    }

    ipcRenderer.invoke('conversations-load').then((result: any) => {
      if (result.success && Array.isArray(result.conversations)) {
        setConversations(result.conversations)
        if (result.conversations.length > 0) {
          setActiveId(result.conversations[0].id)
        }
      }
      setLoaded(true)
    })
  }, [])

  // 自动保存（debounce 2s）
  const scheduleSave = useCallback((next: Conversation[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      if (ipcRenderer) {
        ipcRenderer.invoke('conversations-save', next)
      } else {
        try { localStorage.setItem('fsa-conversations', JSON.stringify(next)) } catch { /* ignore */ }
      }
    }, 2000)
  }, [])

  const createConversation = useCallback(() => {
    const conv: Conversation = {
      id: makeId(),
      title: '新会话',
      messages: [],
      createdAt: nowISO(),
      updatedAt: nowISO()
    }
    setConversations(prev => {
      const next = [conv, ...prev]
      scheduleSave(next)
      return next
    })
    setActiveId(conv.id)
    return conv.id
  }, [scheduleSave])

  const deleteConversation = useCallback((id: string) => {
    setConversations(prev => {
      const next = prev.filter(c => c.id !== id)
      scheduleSave(next)
      return next
    })
    setActiveId(prev => {
      if (prev !== id) return prev
      // 切换到下一个或 null
      const remaining = conversations.filter(c => c.id !== id)
      return remaining.length > 0 ? remaining[0].id : null
    })
  }, [conversations, scheduleSave])

  const switchConversation = useCallback((id: string) => {
    setActiveId(id)
  }, [])

  const activeConversation = conversations.find(c => c.id === activeId) || null

  const updateMessages = useCallback((conversationId: string, updater: (prev: Message[]) => Message[]) => {
    setConversations(prev => {
      const next = prev.map(c => {
        if (c.id !== conversationId) return c
        const newMessages = updater(c.messages)
        return {
          ...c,
          messages: newMessages,
          title: summarizeTitle(newMessages),
          updatedAt: nowISO(),
          tokenUsage: accumulateTokenUsage(newMessages)
        }
      })
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const setMessages = useCallback((conversationId: string, messages: Message[]) => {
    updateMessages(conversationId, () => messages)
  }, [updateMessages])

  const appendMessages = useCallback((conversationId: string, ...newMsgs: Message[]) => {
    updateMessages(conversationId, prev => [...prev, ...newMsgs])
  }, [updateMessages])

  const updateMessage = useCallback((conversationId: string, messageId: string, updater: (msg: Message) => Message) => {
    updateMessages(conversationId, prev =>
      prev.map(m => m.id === messageId ? updater(m) : m)
    )
  }, [updateMessages])

  const renameConversation = useCallback((id: string, title: string) => {
    setConversations(prev => {
      const next = prev.map(c => c.id === id ? { ...c, title, updatedAt: nowISO() } : c)
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  return {
    conversations,
    activeId,
    activeConversation,
    loaded,
    createConversation,
    deleteConversation,
    switchConversation,
    updateMessages,
    setMessages,
    appendMessages,
    updateMessage,
    renameConversation
  }
}
