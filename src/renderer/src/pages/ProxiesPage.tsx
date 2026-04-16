import { useEffect, useState, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Trash2, FlaskConical, Pencil, X, Loader2, Upload, Globe, Search } from 'lucide-react'
import { useProxiesStore } from '../stores/proxies'
import { useConfirmStore } from '../components/ConfirmDialog'
import { useToastStore } from '../components/Toast'
import { api } from '../lib/api'
import { INPUT_CLASS, SELECT_CLASS, LABEL_CLASS, BTN_PRIMARY, BTN_SECONDARY, BTN_ICON, BTN_DANGER } from '../lib/ui'
import type { ProxyProtocol, ProxyResponse } from '../lib/types'

const PROTOCOL_COLORS: Record<ProxyProtocol, string> = {
  http: 'bg-blue-500/12 text-blue-400 ring-1 ring-blue-500/20',
  https: 'bg-green-500/12 text-green-400 ring-1 ring-green-500/20',
  socks4: 'bg-purple-500/12 text-purple-400 ring-1 ring-purple-500/20',
  socks5: 'bg-orange-500/12 text-orange-400 ring-1 ring-orange-500/20'
}

const proxySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  protocol: z.enum(['http', 'https', 'socks4', 'socks5']),
  host: z.string().min(1, 'Host is required'),
  port: z.number().min(1).max(65535),
  username: z.string(),
  password: z.string(),
  country: z.string(),
  group_tag: z.string()
})

type ProxyFormData = z.infer<typeof proxySchema>

const DEFAULT_PROXY: ProxyFormData = {
  name: '',
  protocol: 'http',
  host: '',
  port: 8080,
  username: '',
  password: '',
  country: '',
  group_tag: ''
}

export function ProxiesPage(): React.JSX.Element {
  const proxies = useProxiesStore((s) => s.proxies)
  const loading = useProxiesStore((s) => s.loading)
  const fetchProxies = useProxiesStore((s) => s.fetchProxies)
  const deleteProxy = useProxiesStore((s) => s.deleteProxy)
  const testProxy = useProxiesStore((s) => s.testProxy)
  const confirm = useConfirmStore((s) => s.show)
  const addToast = useToastStore((s) => s.addToast)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [modalError, setModalError] = useState<string | null>(null)
  const [modalSaving, setModalSaving] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean } | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importLoading, setImportLoading] = useState(false)
  const [bulkTesting, setBulkTesting] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors }
  } = useForm<ProxyFormData>({
    resolver: zodResolver(proxySchema),
    defaultValues: DEFAULT_PROXY
  })

  useEffect(() => {
    fetchProxies()
  }, [fetchProxies])

  const closeModal = useCallback(() => {
    setModalOpen(false)
    setEditingId(null)
    setModalError(null)
    reset(DEFAULT_PROXY)
  }, [reset])

  useEffect(() => {
    if (!modalOpen) return
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeModal()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [modalOpen, closeModal])

  const openAdd = (): void => {
    reset(DEFAULT_PROXY)
    setEditingId(null)
    setModalError(null)
    setModalOpen(true)
  }

  const openEdit = (proxy: ProxyResponse): void => {
    reset({
      name: proxy.name,
      protocol: proxy.protocol,
      host: proxy.host,
      port: proxy.port,
      username: proxy.username ?? '',
      password: '',
      country: proxy.country ?? '',
      group_tag: proxy.group_tag ?? ''
    })
    setEditingId(proxy.id)
    setModalError(null)
    setModalOpen(true)
  }

  const onSubmitProxy = async (data: ProxyFormData): Promise<void> => {
    try {
      setModalSaving(true)
      setModalError(null)
      const input = {
        name: data.name,
        protocol: data.protocol,
        host: data.host,
        port: data.port,
        username: data.username || undefined,
        password: data.password || undefined
      }
      if (editingId) {
        await api.updateProxy(editingId, input)
      } else {
        await api.createProxy(input)
      }
      await fetchProxies()
      closeModal()
      addToast(editingId ? 'Proxy updated' : 'Proxy created', 'success')
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : 'Failed to save proxy')
    } finally {
      setModalSaving(false)
    }
  }

  const handleDelete = async (id: string, name: string): Promise<void> => {
    const ok = await confirm({
      title: 'Delete Proxy',
      message: `Delete proxy "${name}"?`,
      confirmLabel: 'Delete',
      danger: true
    })
    if (ok) {
      try {
        await deleteProxy(id)
        addToast('Proxy deleted', 'success')
      } catch (err) {
        addToast(`Delete failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
      }
    }
  }

  const handleTest = async (id: string): Promise<void> => {
    setTestingId(id)
    setTestResult(null)
    try {
      await testProxy(id)
      await fetchProxies()
      const updated = useProxiesStore.getState().proxies.find(p => p.id === id)
      setTestResult({ id, ok: !!updated?.check_ok })
      setTimeout(() => setTestResult(null), 3000)
    } catch {
      setTestResult({ id, ok: false })
      setTimeout(() => setTestResult(null), 3000)
    }
    setTestingId(null)
  }

  const filteredProxies = searchQuery.trim()
    ? proxies.filter(p =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.host.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.protocol.includes(searchQuery.toLowerCase())
      )
    : proxies

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-accent" />
      </div>
    )
  }

  return (
    <div className="p-5 flex flex-col h-full">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-2.5">
          <h1 className="text-lg font-bold text-content">Proxies</h1>
          <span className="text-[11px] text-muted bg-elevated px-2 py-0.5 rounded-md font-medium tabular-nums">
            {proxies.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={openAdd} className={BTN_PRIMARY}>
            <Plus className="h-4 w-4" />
            Add Proxy
          </button>
          <button onClick={() => setImportOpen(true)} className={BTN_SECONDARY}>
            <Upload className="h-4 w-4" />
            Import
          </button>
          <button
            onClick={async () => {
              setBulkTesting(true)
              try {
                await api.bulkTestProxies(proxies.map(p => p.id))
                await fetchProxies()
              } catch { /* best effort */ }
              setBulkTesting(false)
            }}
            disabled={bulkTesting || proxies.length === 0}
            className={BTN_SECONDARY}
          >
            {bulkTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
            Test All
          </button>
        </div>
      </div>

      {/* Search */}
      {proxies.length > 0 && (
        <div className="mb-3 shrink-0">
          <div className="relative max-w-[280px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search proxies..."
              className={`${INPUT_CLASS} pl-8 !py-1.5 text-xs`}
            />
          </div>
        </div>
      )}

      {proxies.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-center">
          <div className="bg-card rounded-2xl p-10 border border-edge max-w-sm">
            <div className="h-12 w-12 rounded-xl bg-elevated flex items-center justify-center mx-auto mb-4">
              <Globe className="h-6 w-6 text-muted/40" />
            </div>
            <p className="text-muted text-sm font-medium mb-1">No proxies configured</p>
            <p className="text-muted/60 text-xs mb-5">Add proxies to use with your browser profiles</p>
            <button onClick={openAdd} className={BTN_PRIMARY}>
              <Plus className="h-4 w-4" />
              Add Proxy
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto rounded-xl border border-edge min-h-0 bg-card/40">
          <table className="w-full text-sm table-fixed">
            <colgroup>
              <col className="w-[22%]" />
              <col className="w-[13%]" />
              <col className="w-[25%]" />
              <col className="w-[12%]" />
              <col className="w-[10%]" />
              <col className="w-[18%]" />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-edge bg-card">
                <th className="text-left px-3 py-2.5 font-medium text-muted text-[11px] uppercase tracking-wider">Name</th>
                <th className="text-left px-3 py-2.5 font-medium text-muted text-[11px] uppercase tracking-wider">Proto</th>
                <th className="text-left px-3 py-2.5 font-medium text-muted text-[11px] uppercase tracking-wider">Host:Port</th>
                <th className="text-left px-3 py-2.5 font-medium text-muted text-[11px] uppercase tracking-wider">User</th>
                <th className="text-left px-3 py-2.5 font-medium text-muted text-[11px] uppercase tracking-wider">Geo</th>
                <th className="text-left px-3 py-2.5 font-medium text-muted text-[11px] uppercase tracking-wider">Group</th>
                <th className="text-left px-3 py-2.5 font-medium text-muted text-[11px] uppercase tracking-wider">Status</th>
                <th className="text-right px-3 py-2.5 font-medium text-muted text-[11px] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProxies.map((proxy) => (
                <tr
                  key={proxy.id}
                  className="border-b border-edge/40 last:border-b-0 hover:bg-elevated/40 transition-colors"
                >
                  <td className="px-3 py-2.5 text-content font-medium truncate" title={proxy.name}>{proxy.name}</td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium uppercase ${PROTOCOL_COLORS[proxy.protocol]}`}>
                      {proxy.protocol}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-muted font-mono text-xs truncate" title={`${proxy.host}:${proxy.port}`}>
                    {proxy.host}:{proxy.port}
                  </td>
                  <td className="px-3 py-2.5 text-muted text-xs truncate">{proxy.username ?? <span className="text-muted/40">—</span>}</td>
                  <td className="px-3 py-2.5 text-xs">
                    {proxy.country ? (
                      <span className="bg-accent/10 text-accent px-1.5 py-0.5 rounded font-mono text-[10px] font-medium">{proxy.country}</span>
                    ) : (
                      <span className="text-muted/40">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted truncate">{proxy.group_tag ?? <span className="text-muted/40">—</span>}</td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      {testResult?.id === proxy.id ? (
                        <>
                          <span className={`h-2 w-2 rounded-full shrink-0 ${testResult.ok ? 'bg-ok shadow-sm shadow-ok/40' : 'bg-err shadow-sm shadow-err/40'}`} />
                          <span className={`font-medium ${testResult.ok ? 'text-ok' : 'text-err'}`}>
                            {testResult.ok ? 'OK' : 'Fail'}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className={`h-2 w-2 rounded-full shrink-0 ${proxy.check_ok ? 'bg-ok shadow-sm shadow-ok/30' : 'bg-err shadow-sm shadow-err/30'}`} />
                          <span className="text-muted">{proxy.check_ok ? 'OK' : 'Fail'}</span>
                          {proxy.check_ok && proxy.check_latency_ms != null && (
                            <span className="text-muted/60 font-mono tabular-nums">{proxy.check_latency_ms}ms</span>
                          )}
                        </>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-0.5 shrink-0">
                      <button
                        onClick={() => handleTest(proxy.id)}
                        disabled={testingId === proxy.id}
                        className={`${BTN_ICON} hover:text-accent disabled:opacity-40`}
                        title="Test"
                      >
                        {testingId === proxy.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
                      </button>
                      <button onClick={() => openEdit(proxy)} className={BTN_ICON} title="Edit">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => handleDelete(proxy.id, proxy.name)} className={BTN_DANGER} title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fadeIn"
          onClick={closeModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={editingId ? 'Edit proxy' : 'Add proxy'}
            className="bg-card rounded-2xl p-6 w-[90%] max-w-[440px] border border-edge shadow-2xl animate-scaleIn"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-content">
                {editingId ? 'Edit Proxy' : 'Add Proxy'}
              </h2>
              <button onClick={closeModal} className={BTN_ICON} aria-label="Close dialog">
                <X className="h-4 w-4" />
              </button>
            </div>

            {modalError && (
              <div className="rounded-xl bg-err/8 border border-err/20 px-3.5 py-2.5 text-xs text-err mb-4 font-medium">
                {modalError}
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmitProxy)} className="space-y-3">
              <div>
                <label htmlFor="proxy-name" className={LABEL_CLASS}>Name</label>
                <input id="proxy-name" type="text" placeholder="My Proxy" className={INPUT_CLASS} {...register('name')} />
                {errors.name && <p className="mt-1 text-xs text-err">{errors.name.message}</p>}
              </div>

              <div>
                <label htmlFor="proxy-protocol" className={LABEL_CLASS}>Protocol</label>
                <select id="proxy-protocol" className={SELECT_CLASS} {...register('protocol')}>
                  <option value="http">HTTP</option>
                  <option value="https">HTTPS</option>
                  <option value="socks4">SOCKS4</option>
                  <option value="socks5">SOCKS5</option>
                </select>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label htmlFor="proxy-host" className={LABEL_CLASS}>Host</label>
                  <input id="proxy-host" type="text" placeholder="192.168.1.1" className={INPUT_CLASS} {...register('host')} />
                  {errors.host && <p className="mt-1 text-xs text-err">{errors.host.message}</p>}
                </div>
                <div>
                  <label htmlFor="proxy-port" className={LABEL_CLASS}>Port</label>
                  <input id="proxy-port" type="number" placeholder="8080" className={INPUT_CLASS} {...register('port', { valueAsNumber: true })} />
                  {errors.port && <p className="mt-1 text-xs text-err">{errors.port.message}</p>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="proxy-username" className={LABEL_CLASS}>Username</label>
                  <input id="proxy-username" type="text" placeholder="optional" className={INPUT_CLASS} {...register('username')} />
                </div>
                <div>
                  <label htmlFor="proxy-password" className={LABEL_CLASS}>Password</label>
                  <input id="proxy-password" type="password" placeholder="optional" className={INPUT_CLASS} {...register('password')} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="proxy-country" className={LABEL_CLASS}>Country</label>
                  <input id="proxy-country" type="text" placeholder="US, DE, etc." className={INPUT_CLASS} {...register('country')} maxLength={2} />
                </div>
                <div>
                  <label htmlFor="proxy-group" className={LABEL_CLASS}>Group tag</label>
                  <input id="proxy-group" type="text" placeholder="rotation-group" className={INPUT_CLASS} {...register('group_tag')} />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button type="submit" disabled={modalSaving} className={BTN_PRIMARY}>
                  {modalSaving ? 'Saving...' : editingId ? 'Save Changes' : 'Add Proxy'}
                </button>
                <button type="button" onClick={closeModal} className={BTN_SECONDARY}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {importOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fadeIn"
          onClick={() => setImportOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Import proxies"
            className="bg-card rounded-2xl p-6 w-[90%] max-w-[500px] border border-edge shadow-2xl animate-scaleIn"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-content">Import Proxies</h2>
              <button onClick={() => setImportOpen(false)} className={BTN_ICON} aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-muted mb-3 leading-relaxed">
              One proxy per line. Formats: <code className="text-accent bg-accent/8 px-1 py-0.5 rounded">host:port</code>, <code className="text-accent bg-accent/8 px-1 py-0.5 rounded">host:port:user:pass</code>, <code className="text-accent bg-accent/8 px-1 py-0.5 rounded">socks5://host:port</code>, <code className="text-accent bg-accent/8 px-1 py-0.5 rounded">user:pass@host:port</code>
            </p>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="192.168.1.1:8080&#10;socks5://proxy.example.com:1080:user:pass"
              rows={6}
              className="w-full rounded-xl border border-edge bg-surface px-3.5 py-2.5 text-sm text-content font-mono placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/40 resize-none mb-3"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  if (!importText.trim()) return
                  setImportLoading(true)
                  try {
                    const parsed = await api.parseProxyString(importText)
                    let created = 0
                    for (const r of parsed) {
                      if (r.ok && r.data) {
                        try { await api.createProxy(r.data); created++ } catch { /* skip */ }
                      }
                    }
                    await fetchProxies()
                    addToast(`Imported ${created} proxy/proxies`, 'success')
                    setImportOpen(false)
                    setImportText('')
                  } catch { /* best effort */ }
                  setImportLoading(false)
                }}
                disabled={importLoading || !importText.trim()}
                className={BTN_PRIMARY}
              >
                {importLoading ? 'Importing...' : 'Import'}
              </button>
              <button onClick={() => setImportOpen(false)} className={BTN_SECONDARY}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
