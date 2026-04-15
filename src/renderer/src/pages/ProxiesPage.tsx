import { useEffect, useState, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Trash2, FlaskConical, Pencil, X, Loader2 } from 'lucide-react'
import { useProxiesStore } from '../stores/proxies'
import { api } from '../lib/api'
import { INPUT_CLASS, SELECT_CLASS, LABEL_CLASS, BTN_PRIMARY, BTN_SECONDARY, BTN_ICON, BTN_DANGER } from '../lib/ui'
import type { ProxyProtocol, ProxyResponse } from '../lib/types'

const PROTOCOL_COLORS: Record<ProxyProtocol, string> = {
  http: 'bg-blue-500/20 text-blue-400',
  https: 'bg-green-500/20 text-green-400',
  socks4: 'bg-purple-500/20 text-purple-400',
  socks5: 'bg-orange-500/20 text-orange-400'
}

const proxySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  protocol: z.enum(['http', 'https', 'socks4', 'socks5']),
  host: z.string().min(1, 'Host is required'),
  port: z.number().min(1).max(65535),
  username: z.string(),
  password: z.string()
})

type ProxyFormData = z.infer<typeof proxySchema>

const DEFAULT_PROXY: ProxyFormData = {
  name: '',
  protocol: 'http',
  host: '',
  port: 8080,
  username: '',
  password: ''
}

export function ProxiesPage(): React.JSX.Element {
  const proxies = useProxiesStore((s) => s.proxies)
  const loading = useProxiesStore((s) => s.loading)
  const fetchProxies = useProxiesStore((s) => s.fetchProxies)
  const deleteProxy = useProxiesStore((s) => s.deleteProxy)
  const testProxy = useProxiesStore((s) => s.testProxy)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [modalError, setModalError] = useState<string | null>(null)
  const [modalSaving, setModalSaving] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)

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
      password: ''
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
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : 'Failed to save proxy')
    } finally {
      setModalSaving(false)
    }
  }

  const handleDelete = (id: string, name: string): void => {
    if (window.confirm(`Delete proxy "${name}"?`)) {
      deleteProxy(id)
    }
  }

  const handleTest = async (id: string): Promise<void> => {
    setTestingId(id)
    await testProxy(id)
    setTestingId(null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-accent" />
      </div>
    )
  }

  return (
    <div className="p-4 flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-content">Proxies</h1>
          <span className="text-xs text-muted bg-surface-alt px-2 py-0.5 rounded-full">
            {proxies.length}
          </span>
        </div>
        <button onClick={openAdd} className={BTN_PRIMARY}>
          <Plus className="h-4 w-4" />
          Add Proxy
        </button>
      </div>

      {proxies.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-center">
          <div className="bg-card rounded-xl p-8 border border-edge">
            <p className="text-muted mb-4 text-sm">No proxies configured</p>
            <button onClick={openAdd} className={BTN_PRIMARY}>
              <Plus className="h-4 w-4" />
              Add Proxy
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto rounded-lg border border-edge min-h-0 bg-card/30">
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
              <tr className="border-b border-edge bg-surface-alt">
                <th className="text-left px-3 py-2.5 font-medium text-muted text-xs uppercase tracking-wide">Name</th>
                <th className="text-left px-3 py-2.5 font-medium text-muted text-xs uppercase tracking-wide">Proto</th>
                <th className="text-left px-3 py-2.5 font-medium text-muted text-xs uppercase tracking-wide">Host:Port</th>
                <th className="text-left px-3 py-2.5 font-medium text-muted text-xs uppercase tracking-wide">User</th>
                <th className="text-left px-3 py-2.5 font-medium text-muted text-xs uppercase tracking-wide">Status</th>
                <th className="text-right px-3 py-2.5 font-medium text-muted text-xs uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody>
              {proxies.map((proxy) => (
                <tr
                  key={proxy.id}
                  className="border-b border-edge/50 last:border-b-0 hover:bg-elevated/50 transition-colors"
                >
                  <td className="px-3 py-2.5 text-content font-medium truncate" title={proxy.name}>{proxy.name}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium uppercase ${PROTOCOL_COLORS[proxy.protocol]}`}
                    >
                      {proxy.protocol}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-muted font-mono text-xs truncate" title={`${proxy.host}:${proxy.port}`}>
                    {proxy.host}:{proxy.port}
                  </td>
                  <td className="px-3 py-2.5 text-muted text-xs truncate">{proxy.username ?? <span className="text-muted/50">None</span>}</td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <span
                        className={`h-2 w-2 rounded-full shrink-0 ${proxy.check_ok ? 'bg-ok' : 'bg-err'}`}
                      />
                      <span className="text-muted">{proxy.check_ok ? 'OK' : 'Fail'}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1 shrink-0">
                      <button
                        onClick={() => handleTest(proxy.id)}
                        disabled={testingId === proxy.id}
                        className={`${BTN_ICON} hover:text-accent disabled:opacity-50`}
                        aria-label={`Test ${proxy.name}`}
                      >
                        {testingId === proxy.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <FlaskConical className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        onClick={() => openEdit(proxy)}
                        className={BTN_ICON}
                        aria-label={`Edit ${proxy.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(proxy.id, proxy.name)}
                        className={BTN_DANGER}
                        aria-label={`Delete ${proxy.name}`}
                      >
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

      {/* Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={closeModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={editingId ? 'Edit proxy' : 'Add proxy'}
            className="bg-card rounded-xl p-5 w-[90%] max-w-[440px] border border-edge shadow-2xl"
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
              <div className="rounded-lg bg-err/10 border border-err/30 px-3 py-2 text-xs text-err mb-4">
                {modalError}
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmitProxy)} className="space-y-3">
              <div>
                <label htmlFor="proxy-name" className={LABEL_CLASS}>
                  Name
                </label>
                <input
                  id="proxy-name"
                  type="text"
                  placeholder="My Proxy"
                  className={INPUT_CLASS}
                  {...register('name')}
                />
                {errors.name && <p className="mt-1 text-xs text-err">{errors.name.message}</p>}
              </div>

              <div>
                <label htmlFor="proxy-protocol" className={LABEL_CLASS}>
                  Protocol
                </label>
                <select id="proxy-protocol" className={SELECT_CLASS} {...register('protocol')}>
                  <option value="http">HTTP</option>
                  <option value="https">HTTPS</option>
                  <option value="socks4">SOCKS4</option>
                  <option value="socks5">SOCKS5</option>
                </select>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label htmlFor="proxy-host" className={LABEL_CLASS}>
                    Host
                  </label>
                  <input
                    id="proxy-host"
                    type="text"
                    placeholder="192.168.1.1"
                    className={INPUT_CLASS}
                    {...register('host')}
                  />
                  {errors.host && <p className="mt-1 text-xs text-err">{errors.host.message}</p>}
                </div>
                <div>
                  <label htmlFor="proxy-port" className={LABEL_CLASS}>
                    Port
                  </label>
                  <input
                    id="proxy-port"
                    type="number"
                    placeholder="8080"
                    className={INPUT_CLASS}
                    {...register('port', { valueAsNumber: true })}
                  />
                  {errors.port && <p className="mt-1 text-xs text-err">{errors.port.message}</p>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="proxy-username" className={LABEL_CLASS}>
                    Username
                  </label>
                  <input
                    id="proxy-username"
                    type="text"
                    placeholder="optional"
                    className={INPUT_CLASS}
                    {...register('username')}
                  />
                </div>
                <div>
                  <label htmlFor="proxy-password" className={LABEL_CLASS}>
                    Password
                  </label>
                  <input
                    id="proxy-password"
                    type="password"
                    placeholder="optional"
                    className={INPUT_CLASS}
                    {...register('password')}
                  />
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
    </div>
  )
}
