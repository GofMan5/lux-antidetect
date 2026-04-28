import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent
} from 'react'
import {
  Bot,
  Check,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  SlidersHorizontal,
  Trash2
} from 'lucide-react'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import { TEXTAREA } from '../lib/ui'
import { useProfilesStore } from '../stores/profiles'
import { useToastStore } from '../components/Toast'
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Label,
  ScrollArea,
  Select
} from '../components/ui'
import type {
  AiChat,
  AiChatMessage,
  AiModel,
  AiProfileAction,
  AiSettings,
  Profile
} from '../lib/types'

const DEFAULT_MODEL = 'llama-3.1-8b-instant'

function formatChatTime(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value))
  } catch {
    return ''
  }
}

function actionFields(action: AiProfileAction): string[] {
  const fields: string[] = []
  const profilePatch = action.profilePatch
  const fingerprintPatch = action.fingerprintPatch

  if (profilePatch) {
    if (profilePatch.name !== undefined) fields.push('Name')
    if (profilePatch.group_name !== undefined || profilePatch.group_color !== undefined) fields.push('Group')
    if (profilePatch.tags !== undefined) fields.push('Tags')
    if (profilePatch.notes !== undefined) fields.push('Notes')
    if (profilePatch.proxy_id !== undefined) fields.push('Proxy')
    if (profilePatch.start_url !== undefined) fields.push('Start URL')
  }

  if (fingerprintPatch) {
    if (fingerprintPatch.user_agent !== undefined) fields.push('User agent')
    if (fingerprintPatch.platform !== undefined) fields.push('Platform')
    if (fingerprintPatch.timezone !== undefined) fields.push('Timezone')
    if (fingerprintPatch.languages !== undefined) fields.push('Languages')
    if (fingerprintPatch.screen_width !== undefined || fingerprintPatch.screen_height !== undefined) fields.push('Screen')
    if (fingerprintPatch.pixel_ratio !== undefined) fields.push('Pixel ratio')
    if (fingerprintPatch.webgl_vendor !== undefined || fingerprintPatch.webgl_renderer !== undefined) fields.push('WebGL')
    if (fingerprintPatch.webrtc_policy !== undefined) fields.push('WebRTC')
    if (fingerprintPatch.hardware_concurrency !== undefined || fingerprintPatch.device_memory !== undefined) fields.push('Hardware')
  }

  return fields.slice(0, 10)
}

function profileById(profiles: Profile[], profileId: string): Profile | undefined {
  return profiles.find((profile) => profile.id === profileId)
}

function isProfileBusy(profile: Profile | undefined): boolean {
  return profile?.status === 'running' || profile?.status === 'starting' || profile?.status === 'stopping'
}

interface ActionCardProps {
  action: AiProfileAction
  profiles: Profile[]
  applying: boolean
  onApply: (action: AiProfileAction) => void
}

function ActionCard({ action, profiles, applying, onApply }: ActionCardProps): React.JSX.Element {
  const profile = profileById(profiles, action.profileId)
  const busy = isProfileBusy(profile)
  const fields = actionFields(action)

  return (
    <div className="mt-3 rounded-[--radius-md] border border-primary/20 bg-primary/7 p-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[--radius-md] bg-primary/12 text-primary">
          <SlidersHorizontal className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[13px] font-semibold text-foreground">{action.label}</p>
            {profile && <Badge variant="muted">{profile.name}</Badge>}
          </div>
          {action.reason && (
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{action.reason}</p>
          )}
          {fields.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {fields.map((field) => (
                <Badge key={field} variant="accent">
                  {field}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <Button
          size="sm"
          variant="secondary"
          loading={applying}
          disabled={busy}
          icon={!applying ? <Check className="h-3.5 w-3.5" /> : undefined}
          onClick={() => onApply(action)}
          title={busy ? 'Stop profile before applying changes' : undefined}
        >
          Apply
        </Button>
      </div>
    </div>
  )
}

interface MessageBubbleProps {
  message: AiChatMessage
  profiles: Profile[]
  applyingIds: Record<string, boolean>
  onApply: (action: AiProfileAction) => void
}

function MessageBubble({
  message,
  profiles,
  applyingIds,
  onApply
}: MessageBubbleProps): React.JSX.Element {
  const isUser = message.role === 'user'

  return (
    <div className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[780px] rounded-[--radius-lg] px-4 py-3 text-[13px] leading-relaxed shadow-[var(--shadow-sm)]',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'border border-border bg-card text-foreground surface-lit'
        )}
      >
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
        {!isUser && message.actions.length > 0 && (
          <div>
            {message.actions.map((action) => (
              <ActionCard
                key={action.id}
                action={action}
                profiles={profiles}
                applying={Boolean(applyingIds[action.id])}
                onApply={onApply}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function AiPage(): React.JSX.Element {
  const profiles = useProfilesStore((s) => s.profiles)
  const fetchProfiles = useProfilesStore((s) => s.fetchProfiles)
  const addToast = useToastStore((s) => s.addToast)

  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [modelInput, setModelInput] = useState(DEFAULT_MODEL)
  const [models, setModels] = useState<AiModel[]>([])
  const [chats, setChats] = useState<AiChat[]>([])
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [messages, setMessages] = useState<AiChatMessage[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [sending, setSending] = useState(false)
  const [applyingIds, setApplyingIds] = useState<Record<string, boolean>>({})
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  const profileOptions = useMemo(
    () => [
      { value: '', label: 'All profiles' },
      ...profiles.map((profile) => ({ value: profile.id, label: profile.name }))
    ],
    [profiles]
  )

  const activeChat = useMemo(
    () => chats.find((chat) => chat.id === activeChatId) ?? null,
    [activeChatId, chats]
  )

  const modelOptions = useMemo(() => {
    const ids = new Set<string>()
    const options: { value: string; label: string }[] = []
    const push = (id: string, suffix = ''): void => {
      if (!id || ids.has(id)) return
      ids.add(id)
      options.push({ value: id, label: suffix ? `${id} ${suffix}` : id })
    }

    push(modelInput, '(current)')
    for (const model of models) {
      const meta = [
        model.context_window ? `${Math.round(model.context_window / 1000)}k` : '',
        model.active === false ? 'inactive' : ''
      ].filter(Boolean)
      push(model.id, meta.length > 0 ? `(${meta.join(', ')})` : '')
    }
    push(DEFAULT_MODEL)
    return options
  }, [modelInput, models])

  const refreshChats = useCallback(async (): Promise<AiChat[]> => {
    const nextChats = await api.aiListChats()
    setChats(nextChats)
    return nextChats
  }, [])

  const refreshModels = useCallback(async (): Promise<void> => {
    setLoadingModels(true)
    try {
      const nextModels = await api.aiListModels()
      setModels(nextModels)
      if (!nextModels.some((model) => model.id === modelInput)) {
        const preferred = nextModels.find((model) => model.active !== false)?.id ?? DEFAULT_MODEL
        setModelInput(preferred)
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to load models', 'error')
    } finally {
      setLoadingModels(false)
    }
  }, [addToast, modelInput])

  useEffect(() => {
    void fetchProfiles()
  }, [fetchProfiles])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([api.aiGetSettings(), api.aiListChats(), api.aiListModels()])
      .then(([nextSettings, nextChats, nextModels]) => {
        if (cancelled) return
        setSettings(nextSettings)
        setModelInput(nextSettings.model || DEFAULT_MODEL)
        setModels(nextModels)
        setChats(nextChats)
        setActiveChatId((current) => current ?? nextChats[0]?.id ?? null)
      })
      .catch((err) => {
        if (!cancelled) {
          addToast(err instanceof Error ? err.message : 'Failed to load AI', 'error')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [addToast])

  useEffect(() => {
    let cancelled = false
    if (!activeChatId) {
      setMessages([])
      return () => {
        cancelled = true
      }
    }
    setLoadingMessages(true)
    api
      .aiListMessages(activeChatId)
      .then((nextMessages) => {
        if (!cancelled) setMessages(nextMessages)
      })
      .catch((err) => {
        if (!cancelled) {
          addToast(err instanceof Error ? err.message : 'Failed to load chat', 'error')
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingMessages(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeChatId, addToast])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, sending])

  const saveSettings = useCallback(async (): Promise<void> => {
    setSavingSettings(true)
    try {
      const nextSettings = await api.aiSetSettings({
        apiKey: apiKeyInput.trim() || undefined,
        model: modelInput || DEFAULT_MODEL
      })
      setSettings(nextSettings)
      setModelInput(nextSettings.model)
      setApiKeyInput('')
      await refreshModels()
      addToast('AI settings saved', 'success')
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to save settings', 'error')
    } finally {
      setSavingSettings(false)
    }
  }, [addToast, apiKeyInput, modelInput, refreshModels])

  const clearApiKey = useCallback(async (): Promise<void> => {
    setSavingSettings(true)
    try {
      const nextSettings = await api.aiSetSettings({
        clearApiKey: true,
        model: modelInput || DEFAULT_MODEL
      })
      setSettings(nextSettings)
      setApiKeyInput('')
      addToast('Groq key cleared', 'success')
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to clear key', 'error')
    } finally {
      setSavingSettings(false)
    }
  }, [addToast, modelInput])

  const createChat = useCallback(async (): Promise<void> => {
    try {
      const chat = await api.aiCreateChat('New chat')
      const nextChats = await refreshChats()
      setActiveChatId(chat.id)
      if (nextChats.length === 0) setChats([chat])
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to create chat', 'error')
    }
  }, [addToast, refreshChats])

  const deleteActiveChat = useCallback(async (): Promise<void> => {
    if (!activeChatId) return
    try {
      await api.aiDeleteChat(activeChatId)
      const nextChats = await refreshChats()
      setActiveChatId(nextChats[0]?.id ?? null)
      addToast('Chat deleted', 'success')
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to delete chat', 'error')
    }
  }, [activeChatId, addToast, refreshChats])

  const submitMessage = useCallback(
    async (event?: FormEvent): Promise<void> => {
      event?.preventDefault()
      const content = draft.trim()
      if (!content || sending) return
      if (!settings?.hasApiKey) {
        addToast('Save a Groq key first', 'warning')
        return
      }

      setSending(true)
      try {
        const result = await api.aiSendMessage({
          chatId: activeChatId,
          content,
          profileId: selectedProfileId || null
        })
        setDraft('')
        setActiveChatId(result.chat.id)
        setMessages(result.messages)
        await refreshChats()
      } catch (err) {
        addToast(err instanceof Error ? err.message : 'AI request failed', 'error')
      } finally {
        setSending(false)
      }
    },
    [activeChatId, addToast, draft, refreshChats, selectedProfileId, sending, settings?.hasApiKey]
  )

  const handleDraftKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        void submitMessage()
      }
    },
    [submitMessage]
  )

  const applyAction = useCallback(
    async (action: AiProfileAction): Promise<void> => {
      setApplyingIds((current) => ({ ...current, [action.id]: true }))
      try {
        const [result] = await api.aiApplyActions([action])
        if (result?.ok) {
          addToast('Profile updated', 'success')
          await fetchProfiles()
        } else {
          addToast(result?.error ?? 'Failed to apply action', 'error')
        }
      } catch (err) {
        addToast(err instanceof Error ? err.message : 'Failed to apply action', 'error')
      } finally {
        setApplyingIds((current) => {
          const next = { ...current }
          delete next[action.id]
          return next
        })
      }
    },
    [addToast, fetchProfiles]
  )

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 bg-background">
      <aside className="flex w-[320px] shrink-0 flex-col border-r border-border/60 bg-card/35">
        <div className="border-b border-border/60 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-[15px] font-semibold text-foreground">Lux AI</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                Groq profile assistant
              </p>
            </div>
            <Badge variant={settings?.hasApiKey ? 'success' : 'warning'} dot>
              {settings?.hasApiKey ? 'Ready' : 'Key'}
            </Badge>
          </div>

          <div className="mt-4 space-y-3">
            <div>
              <Label htmlFor="ai-api-key">Groq key</Label>
              <Input
                id="ai-api-key"
                type="password"
                value={apiKeyInput}
                onChange={(event) => setApiKeyInput(event.target.value)}
                placeholder={settings?.hasApiKey ? 'Saved locally' : 'Paste Groq API key'}
                icon={<KeyRound className="h-4 w-4" />}
                autoComplete="off"
              />
            </div>
            <div>
              <Label htmlFor="ai-model">Model</Label>
              <div className="flex gap-2">
                <Select
                  id="ai-model"
                  value={modelInput}
                  onChange={(event) => setModelInput(event.target.value)}
                  options={modelOptions}
                  disabled={loadingModels}
                  className="min-w-0 flex-1"
                />
                <Button
                  size="icon"
                  variant="outline"
                  loading={loadingModels}
                  icon={!loadingModels ? <RefreshCw className="h-4 w-4" /> : undefined}
                  onClick={() => void refreshModels()}
                  aria-label="Refresh models"
                />
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {settings?.hasApiKey ? `${models.length} available models` : 'Save key to load Groq models'}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                size="sm"
                loading={savingSettings}
                onClick={() => void saveSettings()}
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!settings?.hasApiKey || savingSettings}
                onClick={() => void clearApiKey()}
              >
                Clear
              </Button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            Chats
            {settings && <Badge variant="muted">{settings.maxContextMessages} ctx</Badge>}
          </div>
          <Button size="icon" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => void createChat()} />
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-1 px-2 pb-4">
            {chats.length === 0 ? (
              <EmptyState
                size="sm"
                icon={<Bot />}
                title="No chats"
                description="Start with a profile question."
              />
            ) : (
              chats.map((chat) => (
                <button
                  key={chat.id}
                  type="button"
                  onClick={() => setActiveChatId(chat.id)}
                  className={cn(
                    'w-full rounded-[--radius-md] px-3 py-2 text-left transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                    chat.id === activeChatId
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground hover:bg-elevated/60'
                  )}
                >
                  <div className="truncate text-[13px] font-medium">{chat.title}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {formatChatTime(chat.updated_at)}
                  </div>
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/60 px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              <h2 className="truncate text-[14px] font-semibold text-foreground">
                {activeChat?.title ?? 'New assistant chat'}
              </h2>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Profile context, proxy metadata, and safe apply actions
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Select
              aria-label="Profile context"
              value={selectedProfileId}
              onChange={(event) => setSelectedProfileId(event.target.value)}
              options={profileOptions}
              className="w-[220px]"
            />
            <Button
              size="icon"
              variant="ghost"
              icon={<Trash2 className="h-4 w-4" />}
              disabled={!activeChatId}
              onClick={() => void deleteActiveChat()}
              aria-label="Delete chat"
            />
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="mx-auto flex max-w-[980px] flex-col gap-4">
            {loadingMessages ? (
              <div className="flex justify-center py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : messages.length === 0 ? (
              <EmptyState
                icon={<Bot />}
                title="Ask Lux AI"
                description="Pick a profile, describe the goal, and apply only the changes you approve."
              />
            ) : (
              messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  profiles={profiles}
                  applyingIds={applyingIds}
                  onApply={(action) => void applyAction(action)}
                />
              ))
            )}
            {sending && (
              <div className="flex justify-start">
                <div className="rounded-[--radius-lg] border border-border bg-card px-4 py-3 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <form onSubmit={(event) => void submitMessage(event)} className="shrink-0 border-t border-border/60 p-4">
          <div className="mx-auto flex max-w-[980px] items-end gap-3">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleDraftKeyDown}
              className={cn(TEXTAREA, 'min-h-[76px] max-h-[180px] flex-1')}
              placeholder="Ask for profile tuning, proxy alignment, or a consistency check..."
              aria-label="AI message"
            />
            <Button
              type="submit"
              size="lg"
              loading={sending}
              disabled={!draft.trim()}
              icon={!sending ? <Send className="h-4 w-4" /> : undefined}
            >
              Send
            </Button>
          </div>
        </form>
      </section>
    </div>
  )
}
