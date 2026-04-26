import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus,
  Trash2,
  FlaskConical,
  Pencil,
  Loader2,
  Upload,
  Globe,
  MoreHorizontal,
  Copy,
  Download,
  FileUp,
  CheckSquare,
  ClipboardPaste,
  Check,
  ShieldCheck,
  ShieldAlert,
  Shield,
  RefreshCw
} from 'lucide-react'
import { useProxiesStore } from '../stores/proxies'
import { useConfirmStore } from '../components/ConfirmDialog'
import { useToastStore } from '../components/Toast'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import { CHECKBOX, TEXTAREA, LABEL } from '../lib/ui'
import {
  Button,
  Input,
  Badge,
  Select,
  Modal,
  EmptyState,
  SearchInput,
  DropdownMenu,
  Tooltip
} from '../components/ui'
import type { ProxyProtocol, ProxyResponse, ProxyInput, FraudRisk, IpFraudReport } from '../lib/types'

// ---------------------------------------------------------------------------
// Schema & defaults
// ---------------------------------------------------------------------------

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

const PROTOCOL_OPTIONS = [
  { value: 'http', label: 'HTTP' },
  { value: 'https', label: 'HTTPS' },
  { value: 'socks4', label: 'SOCKS4' },
  { value: 'socks5', label: 'SOCKS5' }
]

const PROTOCOL_BADGE: Record<ProxyProtocol, 'default' | 'success' | 'warning' | 'error' | 'accent'> = {
  http: 'default',
  https: 'success',
  socks4: 'accent',
  socks5: 'warning'
}

const PROTOCOL_DEFAULT_PORT: Record<ProxyProtocol, number> = {
  http: 8080,
  https: 8443,
  socks4: 1080,
  socks5: 1080
}

const KNOWN_DEFAULT_PORTS: ReadonlySet<number> = new Set(Object.values(PROTOCOL_DEFAULT_PORT))

const QUICK_PASTE_DEBOUNCE_MS = 150
const COUNTRY_CODE_LEN = 2
const QUICK_PASTE_FILLED_MS = 2000

const QUICK_PASTE_HINT = {
  parseFail: "Couldn't parse this string",
  multiline: 'Looks like multiple proxies — use bulk import'
} as const

const PROXY_CHECK_ERROR_MESSAGES: Record<string, string> = {
  auth_failed: 'Authentication failed',
  timeout: 'Connection timed out',
  connect_refused: 'Connection refused',
  connection_reset: 'Connection reset by peer',
  socks_handshake_failed: 'SOCKS handshake failed',
  socks_auth_unsupported: 'Proxy requires an unsupported SOCKS auth method',
  unexpected_status: 'Proxy returned an unexpected response',
  protocol_error: 'Proxy protocol error',
  cert_invalid: 'Proxy TLS certificate is invalid',
  dns_error: 'Could not resolve proxy host',
  unknown_error: 'Unknown proxy error'
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusBadge(proxy: ProxyResponse): { variant: 'success' | 'error' | 'default'; label: string } {
  if (proxy.last_check === null) return { variant: 'default', label: 'Untested' }
  return proxy.check_ok
    ? { variant: 'success', label: 'Working' }
    : { variant: 'error', label: 'Failed' }
}

function countryFlag(code: string): string {
  const upper = code.toUpperCase()
  if (upper.length !== 2) return ''
  return String.fromCodePoint(...[...upper].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}

// Reputation = ensemble verdict from ip-api.com + ipapi.is over the proxy's
// external IP. The 0-100 score is bucketed into clean / low / medium / high
// / critical / unknown — see geoip.ts:combineSignals for the weights. The
// badge shows "<bucket> <score>" so the user sees both the coarse class and
// the precise number; the tooltip lists per-flag detail.
const FRAUD_BUCKET_META: Record<
  Exclude<FraudRisk, never>,
  { variant: 'success' | 'error' | 'warning' | 'default'; label: string; icon: 'check' | 'alert' | 'shield' }
> = {
  clean:    { variant: 'success', label: 'Clean',    icon: 'check' },
  low:      { variant: 'success', label: 'Low',      icon: 'check' },
  medium:   { variant: 'warning', label: 'Medium',   icon: 'alert' },
  high:     { variant: 'error',   label: 'High',     icon: 'alert' },
  critical: { variant: 'error',   label: 'Critical', icon: 'alert' },
  unknown:  { variant: 'default', label: 'Unknown',  icon: 'shield' }
}

function fraudBucketIcon(name: 'check' | 'alert' | 'shield'): React.ReactNode {
  if (name === 'check') return <ShieldCheck className="h-3 w-3" />
  if (name === 'alert') return <ShieldAlert className="h-3 w-3" />
  return <Shield className="h-3 w-3" />
}

function reputationBadge(proxy: ProxyResponse): {
  variant: 'success' | 'error' | 'warning' | 'default'
  label: string
  icon: React.ReactNode
  tooltip: React.ReactNode
  ariaLabel: string
} {
  // Pre-lookup state.
  if (proxy.fraud_risk === null || proxy.last_fraud_check === null) {
    const note = 'Reputation not checked yet — click to refresh or wait for the auto-lookup to finish.'
    return {
      variant: 'default',
      label: 'Unknown',
      icon: fraudBucketIcon('shield'),
      tooltip: <div>{note}</div>,
      ariaLabel: `Reputation: unknown. ${note}`
    }
  }

  const flags: string[] = []
  if (proxy.is_datacenter) flags.push('datacenter / hosting ASN')
  if (proxy.is_vpn) flags.push('known VPN')
  if (proxy.is_proxy_detected) flags.push('listed in known-proxy databases')
  if (proxy.is_tor) flags.push('Tor exit node')
  if (proxy.is_abuser) flags.push('past abuse history')
  if (proxy.is_mobile) flags.push('mobile carrier (low-risk)')

  const lines: React.ReactNode[] = []
  if (proxy.external_ip) lines.push(<div key="ip"><span className="text-muted">IP</span> <span className="font-mono">{proxy.external_ip}</span></div>)
  if (proxy.isp) lines.push(<div key="isp"><span className="text-muted">ISP</span> {proxy.isp}</div>)
  if (proxy.asn) lines.push(<div key="asn"><span className="text-muted">ASN</span> <span className="font-mono">{proxy.asn}</span>{proxy.asn_type ? ` (${proxy.asn_type})` : ''}</div>)
  if (proxy.abuse_score !== null) lines.push(
    <div key="abuse"><span className="text-muted">Abuse</span> {(proxy.abuse_score * 100).toFixed(1)}%</div>
  )
  lines.push(
    <div key="flags"><span className="text-muted">Flags</span> {flags.length > 0 ? flags.join(', ') : 'none'}</div>
  )
  if (proxy.fraud_providers.length > 0) lines.push(
    <div key="src" className="text-muted/70 text-[11px]">via {proxy.fraud_providers.join(' + ')}</div>
  )

  const meta = FRAUD_BUCKET_META[proxy.fraud_risk]
  const score = proxy.fraud_score ?? 0
  const tooltip = <div className="space-y-0.5 leading-snug">{lines}</div>
  const ariaLabel = `Reputation: ${meta.label}, score ${score} of 100. Flags: ${flags.length > 0 ? flags.join(', ') : 'none'}.`

  return {
    variant: meta.variant,
    label: proxy.fraud_risk === 'unknown' ? 'Unknown' : `${meta.label} ${score}`,
    icon: fraudBucketIcon(meta.icon),
    tooltip,
    ariaLabel
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProxiesPage(): React.JSX.Element {
  // Store
  const proxies = useProxiesStore((s) => s.proxies)
  const loading = useProxiesStore((s) => s.loading)
  const fetchProxies = useProxiesStore((s) => s.fetchProxies)
  const deleteProxy = useProxiesStore((s) => s.deleteProxy)
  const testProxy = useProxiesStore((s) => s.testProxy)
  const confirm = useConfirmStore((s) => s.show)
  const addToast = useToastStore((s) => s.addToast)

  // Local state
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [modalError, setModalError] = useState<string | null>(null)
  const [modalSaving, setModalSaving] = useState(false)
  const [modalTesting, setModalTesting] = useState(false)
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set())
  const [checkingFraudIds, setCheckingFraudIds] = useState<Set<string>>(new Set())
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importLoading, setImportLoading] = useState(false)
  const [importFilterFraud, setImportFilterFraud] = useState(true)
  const [importProgress, setImportProgress] = useState<{ checked: number; total: number; risky: number } | null>(null)
  // Standalone "Check IP" tool state
  const [ipCheckOpen, setIpCheckOpen] = useState(false)
  const [ipCheckInput, setIpCheckInput] = useState('')
  const [ipCheckLoading, setIpCheckLoading] = useState(false)
  const [ipCheckReport, setIpCheckReport] = useState<IpFraudReport | null>(null)
  const [ipCheckError, setIpCheckError] = useState<string | null>(null)
  const [importParsed, setImportParsed] = useState<
    { ok: boolean; data?: { name: string; host: string; port: number; protocol: string } }[] | null
  >(null)
  const [bulkTesting, setBulkTesting] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [quickPaste, setQuickPaste] = useState('')
  const [quickPasteHint, setQuickPasteHint] = useState<string | null>(null)
  const [quickPasteMultiline, setQuickPasteMultiline] = useState(false)
  const [quickPasteParsing, setQuickPasteParsing] = useState(false)
  const [quickPasteFilled, setQuickPasteFilled] = useState(false)
  const [clearCreds, setClearCreds] = useState<{ username: boolean; password: boolean }>({
    username: false,
    password: false
  })
  const prevProtocolRef = useRef<ProxyProtocol>('http')
  const quickPasteInputRef = useRef<HTMLInputElement | null>(null)

  // Form
  const {
    register,
    handleSubmit,
    reset,
    getValues,
    setValue,
    watch,
    formState: { errors }
  } = useForm<ProxyFormData>({
    resolver: zodResolver(proxySchema),
    defaultValues: DEFAULT_PROXY
  })

  useEffect(() => {
    fetchProxies()
  }, [fetchProxies])

  // Auto-fraud-check fires after createProxy in the main process. Two events:
  //   - 'metadata-checking' — lookup started; toggle the row's Checking spinner
  //   - 'metadata-updated'  — lookup finished; refresh the list so the
  //                           Reputation badge populates and clear the spinner.
  useEffect(() => {
    const offChecking = api.onProxyMetadataChecking((data) => {
      setCheckingFraudIds((prev) => new Set(prev).add(data.proxy_id))
    })
    const offUpdated = api.onProxyMetadataUpdated((data) => {
      setCheckingFraudIds((prev) => {
        const next = new Set(prev)
        next.delete(data.proxy_id)
        return next
      })
      fetchProxies()
    })
    return () => {
      offChecking()
      offUpdated()
    }
  }, [fetchProxies])

  // Filtered list
  const filteredProxies = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return proxies
    return proxies.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.host.toLowerCase().includes(q) ||
        p.protocol.includes(q)
    )
  }, [proxies, searchQuery])

  const editingProxyHasPassword = useMemo(
    () => (editingId ? proxies.find((p) => p.id === editingId)?.has_password ?? false : false),
    [proxies, editingId]
  )

  const editingProxyHasUsername = useMemo(
    () =>
      editingId
        ? Boolean(proxies.find((p) => p.id === editingId)?.username)
        : false,
    [proxies, editingId]
  )

  // Selection helpers
  const allSelected = filteredProxies.length > 0 && filteredProxies.every((p) => selected.has(p.id))
  const someSelected = selected.size > 0

  const toggleAll = (): void => {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filteredProxies.map((p) => p.id)))
    }
  }

  const toggleOne = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ---------------------------------------------------------------------------
  // Modal open/close
  // ---------------------------------------------------------------------------

  const closeModal = useCallback(() => {
    setModalOpen(false)
    setEditingId(null)
    setModalError(null)
    setModalTesting(false)
    setQuickPaste('')
    setQuickPasteHint(null)
    setQuickPasteMultiline(false)
    setQuickPasteParsing(false)
    setQuickPasteFilled(false)
    setClearCreds({ username: false, password: false })
    reset(DEFAULT_PROXY)
  }, [reset])

  const openAdd = (): void => {
    reset(DEFAULT_PROXY)
    setEditingId(null)
    setModalError(null)
    setQuickPaste('')
    setQuickPasteHint(null)
    setQuickPasteMultiline(false)
    setQuickPasteParsing(false)
    setQuickPasteFilled(false)
    setClearCreds({ username: false, password: false })
    prevProtocolRef.current = DEFAULT_PROXY.protocol
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
    setQuickPaste('')
    setQuickPasteHint(null)
    setQuickPasteMultiline(false)
    setQuickPasteParsing(false)
    setQuickPasteFilled(false)
    setClearCreds({ username: false, password: false })
    prevProtocolRef.current = proxy.protocol
    setModalOpen(true)
  }

  // ---------------------------------------------------------------------------
  // Protocol → default port auto-swap (only when current port is a known default)
  // ---------------------------------------------------------------------------

  const watchedProtocol = watch('protocol')
  const watchedUsername = watch('username')
  const watchedPassword = watch('password')
  useEffect(() => {
    if (!modalOpen) return
    const prev = prevProtocolRef.current
    if (prev === watchedProtocol) return
    prevProtocolRef.current = watchedProtocol
    const currentPort = getValues('port')
    if (KNOWN_DEFAULT_PORTS.has(currentPort)) {
      setValue('port', PROTOCOL_DEFAULT_PORT[watchedProtocol], { shouldDirty: true })
    }
  }, [watchedProtocol, modalOpen, getValues, setValue])

  // ---------------------------------------------------------------------------
  // Quick-paste: parse a single proxy string and auto-fill the form
  // ---------------------------------------------------------------------------

  const applyParsedProxy = useCallback(
    (data: ProxyInput): void => {
      setValue('protocol', data.protocol, { shouldDirty: true, shouldValidate: true })
      setValue('host', data.host, { shouldDirty: true, shouldValidate: true })
      setValue('port', data.port, { shouldDirty: true, shouldValidate: true })
      setValue('username', data.username ?? '', { shouldDirty: true })
      setValue('password', data.password ?? '', { shouldDirty: true })
      if (data.name && !getValues('name')?.trim()) {
        setValue('name', data.name, { shouldDirty: true, shouldValidate: true })
      }
      prevProtocolRef.current = data.protocol
    },
    [setValue, getValues]
  )

  const runQuickPasteParse = useCallback(
    async (value: string): Promise<void> => {
      const trimmed = value.trim()
      if (!trimmed) {
        setQuickPasteHint(null)
        setQuickPasteMultiline(false)
        setQuickPasteParsing(false)
        setQuickPasteFilled(false)
        return
      }
      const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      if (lines.length >= 2) {
        setQuickPasteHint(QUICK_PASTE_HINT.multiline)
        setQuickPasteMultiline(true)
        setQuickPasteParsing(false)
        setQuickPasteFilled(false)
        return
      }
      setQuickPasteMultiline(false)
      setQuickPasteParsing(true)
      try {
        const results = await api.parseProxyString(lines[0])
        const first = results[0]
        if (first?.ok && first.data) {
          applyParsedProxy(first.data)
          setQuickPasteHint(null)
          setQuickPasteFilled(true)
        } else {
          setQuickPasteHint(QUICK_PASTE_HINT.parseFail)
          setQuickPasteFilled(false)
        }
      } catch {
        setQuickPasteHint(QUICK_PASTE_HINT.parseFail)
        setQuickPasteFilled(false)
      } finally {
        setQuickPasteParsing(false)
      }
    },
    [applyParsedProxy]
  )

  useEffect(() => {
    if (!modalOpen) return
    const timer = setTimeout(() => {
      void runQuickPasteParse(quickPaste)
    }, QUICK_PASTE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [quickPaste, modalOpen, runQuickPasteParse])

  // Clear the transient "✓ Filled" success hint after a short delay.
  useEffect(() => {
    if (!quickPasteFilled) return
    const t = setTimeout(() => setQuickPasteFilled(false), QUICK_PASTE_FILLED_MS)
    return () => clearTimeout(t)
  }, [quickPasteFilled])

  // Autofocus the quick-paste input when the modal opens for faster workflows.
  // Only in Add mode — in Edit mode a stray paste would overwrite saved fields.
  useEffect(() => {
    if (!modalOpen || editingId) return
    const id = window.setTimeout(() => quickPasteInputRef.current?.focus(), 50)
    return () => window.clearTimeout(id)
  }, [modalOpen, editingId])

  // ---------------------------------------------------------------------------
  // CRUD / test handlers
  // ---------------------------------------------------------------------------

  const buildProxyInput = (data: ProxyFormData, isUpdate: boolean): ProxyInput => {
    const country = data.country.trim().toUpperCase()
    const groupTag = data.group_tag.trim()
    const username = data.username
    const password = data.password

    // Tri-state rules (update):
    //   non-empty input       → send value (set)
    //   empty + clear flag    → send null  (clear)
    //   empty + no clear flag → send undefined (keep)
    // Create: keep legacy behavior (empty → undefined means "no credential").
    const resolveCred = (
      value: string,
      clearFlag: boolean
    ): string | null | undefined => {
      if (value) return value
      if (isUpdate && clearFlag) return null
      return undefined
    }

    return {
      name: data.name,
      protocol: data.protocol,
      host: data.host,
      port: data.port,
      username: resolveCred(username, clearCreds.username),
      password: resolveCred(password, clearCreds.password),
      country: country.length === COUNTRY_CODE_LEN ? country : undefined,
      group_tag: groupTag || undefined
    }
  }

  const onSubmitProxy = async (data: ProxyFormData): Promise<void> => {
    try {
      setModalSaving(true)
      setModalError(null)
      const input = buildProxyInput(data, Boolean(editingId))
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
        setSelected((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        addToast('Proxy deleted', 'success')
      } catch (err) {
        addToast(`Delete failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
      }
    }
  }

  const handleTest = async (id: string): Promise<void> => {
    setTestingIds((prev) => new Set(prev).add(id))
    try {
      await testProxy(id)
      await fetchProxies()
      const updated = useProxiesStore.getState().proxies.find((p) => p.id === id)
      addToast(
        updated?.check_ok ? 'Proxy test passed' : 'Proxy test failed',
        updated?.check_ok ? 'success' : 'error'
      )
    } catch {
      addToast('Proxy test failed', 'error')
    }
    setTestingIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  const handleStandaloneIpCheck = async (): Promise<void> => {
    const ip = ipCheckInput.trim()
    if (!ip) return
    setIpCheckLoading(true)
    setIpCheckError(null)
    setIpCheckReport(null)
    try {
      const report = await api.lookupFraudByIp(ip)
      if (!report) {
        setIpCheckError('No data — invalid IP, network failure, or both providers rate-limited.')
      } else {
        setIpCheckReport(report)
      }
    } catch (err) {
      setIpCheckError(err instanceof Error ? err.message : 'Check failed')
    }
    setIpCheckLoading(false)
  }

  const handleRecheckFraud = async (id: string): Promise<void> => {
    // Functional set update so a double-click within one render tick can't
    // fire a duplicate ip-api request — second call sees `prev.has(id)` and
    // bails before the network hit.
    let alreadyChecking = false
    setCheckingFraudIds((prev) => {
      if (prev.has(id)) {
        alreadyChecking = true
        return prev
      }
      const next = new Set(prev)
      next.add(id)
      return next
    })
    if (alreadyChecking) return

    try {
      const result = await api.lookupProxyGeo(id)
      await fetchProxies()
      if (result === null) {
        addToast('Reputation check failed — proxy may be down or rate-limited', 'error')
      } else if (result.fraud_risk === 'high') {
        // The result IS the recheck succeeding — Risky is a verdict, not an
        // error. Use 'warning' so the toast colour matches the badge meaning.
        addToast('Proxy IP flagged as risky (datacenter / known proxy)', 'warning')
      } else if (result.fraud_risk === 'unknown') {
        addToast('Reputation: unknown — ip-api returned no risk signals', 'info')
      } else {
        addToast('Reputation: clean', 'success')
      }
    } catch {
      addToast('Reputation check failed', 'error')
    }
    setCheckingFraudIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  const handleTestInModal = async (): Promise<void> => {
    if (!editingId) return
    setModalTesting(true)
    try {
      await testProxy(editingId)
      const updated = useProxiesStore.getState().proxies.find((p) => p.id === editingId)
      addToast(
        updated?.check_ok ? 'Proxy test passed' : 'Proxy test failed',
        updated?.check_ok ? 'success' : 'error'
      )
    } catch (err) {
      addToast(`Test failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
    } finally {
      setModalTesting(false)
    }
  }

  const handleCopy = (proxy: ProxyResponse): void => {
    const auth = proxy.username ? `${proxy.username}@` : ''
    const str = `${proxy.protocol}://${auth}${proxy.host}:${proxy.port}`
    navigator.clipboard.writeText(str)
    addToast('Copied to clipboard', 'success')
  }

  // ---------------------------------------------------------------------------
  // Bulk actions
  // ---------------------------------------------------------------------------

  const bulkTestSelected = async (): Promise<void> => {
    const ids = [...selected]
    setBulkTesting(true)
    try {
      await api.bulkTestProxies(ids)
      await fetchProxies()
      addToast(`Tested ${ids.length} proxies`, 'success')
    } catch {
      addToast('Bulk test failed', 'error')
    }
    setBulkTesting(false)
  }

  const bulkDeleteSelected = async (): Promise<void> => {
    const ids = [...selected]
    const ok = await confirm({
      title: 'Delete Proxies',
      message: `Delete ${ids.length} selected proxies?`,
      confirmLabel: 'Delete All',
      danger: true
    })
    if (!ok) return
    let deleted = 0
    for (const id of ids) {
      try {
        await deleteProxy(id)
        deleted++
      } catch {
        /* continue */
      }
    }
    setSelected(new Set())
    addToast(`Deleted ${deleted} proxies`, 'success')
  }

  const bulkExportSelected = (): void => {
    const ids = new Set(selected)
    const lines = proxies
      .filter((p) => ids.has(p.id))
      .map((p) => {
        const auth = p.username ? `${p.username}@` : ''
        return `${p.protocol}://${auth}${p.host}:${p.port}`
      })
    navigator.clipboard.writeText(lines.join('\n'))
    addToast(`Exported ${lines.length} proxies to clipboard`, 'success')
  }

  // ---------------------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------------------

  const closeImport = (): void => {
    setImportOpen(false)
    setImportText('')
    setImportParsed(null)
  }

  // Route multi-line paste from the quick-paste input into the bulk import modal.
  const openBulkImportWithText = useCallback(
    (text: string): void => {
      // Close the add/edit modal (form state is discarded — acceptable per spec).
      setModalOpen(false)
      setEditingId(null)
      setModalError(null)
      setModalTesting(false)
      setQuickPaste('')
      setQuickPasteHint(null)
      setQuickPasteMultiline(false)
      setQuickPasteParsing(false)
      setQuickPasteFilled(false)
      setClearCreds({ username: false, password: false })
      reset(DEFAULT_PROXY)
      // Prefill + open the bulk-import modal.
      setImportParsed(null)
      setImportText(text)
      setImportOpen(true)
    },
    [reset]
  )

  const parseImport = async (): Promise<void> => {
    if (!importText.trim()) return
    setImportLoading(true)
    try {
      const parsed = await api.parseProxyString(importText)
      setImportParsed(parsed)
    } catch {
      addToast('Failed to parse proxies', 'error')
    }
    setImportLoading(false)
  }

  const executeImport = async (): Promise<void> => {
    if (!importParsed) return
    setImportLoading(true)

    const validRows = importParsed.filter((r) => r.ok && r.data)
    let created = 0
    let skippedRisky = 0
    let skippedError = 0

    if (importFilterFraud) {
      // Reputation-filtered path: dry-run each candidate first, only persist
      // proxies whose IP isn't on a hosting / known-proxy ASN. Sequential to
      // stay under ip-api's 45 req/min free-tier ceiling and to keep the
      // progress counter monotonic for the user.
      setImportProgress({ checked: 0, total: validRows.length, risky: 0 })
      for (let i = 0; i < validRows.length; i++) {
        const row = validRows[i]
        if (!row.data) continue
        try {
          const probe = await api.dryRunFraudCheck(
            row.data as Parameters<typeof api.dryRunFraudCheck>[0]
          )
          // Drop everything that's high / critical / unknown / null. Keep
          // clean / low / medium — medium covers residential pools that one
          // provider tagged as proxy-listed but the other didn't, which is
          // typical for dual-purpose IPs the user may still want.
          const verdict = probe?.fraud_risk
          const keep =
            verdict === 'clean' || verdict === 'low' || verdict === 'medium'
          if (!keep) {
            skippedRisky++
          } else {
            await api.createProxy(row.data as Parameters<typeof api.createProxy>[0])
            created++
          }
        } catch {
          skippedError++
        }
        setImportProgress({ checked: i + 1, total: validRows.length, risky: skippedRisky })
      }
    } else {
      // Unfiltered path: keep the original behavior — persist every parsed
      // line; the auto-fraud-check still fires per row but doesn't gate creation.
      for (const r of validRows) {
        if (!r.data) continue
        try {
          await api.createProxy(r.data as Parameters<typeof api.createProxy>[0])
          created++
        } catch {
          skippedError++
        }
      }
    }

    await fetchProxies()
    if (skippedRisky > 0 || skippedError > 0) {
      const parts = [`Imported ${created}`]
      if (skippedRisky > 0) parts.push(`${skippedRisky} risky skipped`)
      if (skippedError > 0) parts.push(`${skippedError} errors`)
      addToast(parts.join(' • '), skippedRisky > 0 ? 'warning' : 'success')
    } else {
      addToast(`Imported ${created} proxy/proxies`, 'success')
    }
    setImportProgress(null)
    closeImport()
    setImportLoading(false)
  }

  const handleFileUpload = (): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.txt,.csv'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const text = await file.text()
      setImportText(text)
      setImportParsed(null)
    }
    input.click()
  }

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="p-6 flex flex-col h-full">
        <div className="flex items-center justify-between mb-5 shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="text-[22px] font-semibold text-content tracking-tight">Proxies</h1>
            <div className="h-5 w-8 rounded-full shimmer" />
          </div>
        </div>
        <div className="flex-1 min-h-0 bg-card rounded-[--radius-lg] border border-edge/80 surface-lit shadow-[var(--shadow-sm)] overflow-hidden">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-edge/40 last:border-0">
              <div className="h-4 w-4 rounded shimmer" />
              <div className="h-3 w-40 rounded shimmer" />
              <div className="h-3 w-16 rounded shimmer" />
              <div className="h-3 w-56 rounded shimmer" />
              <div className="ml-auto h-3 w-20 rounded shimmer" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="p-6 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-[22px] font-semibold text-content tracking-tight">Proxies</h1>
          <Badge variant="muted">{proxies.length}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search proxies…"
            className="w-56"
            matchCount={filteredProxies.length}
          />
          <Button variant="primary" size="md" icon={<Plus className="h-4 w-4" />} onClick={openAdd}>
            Add Proxy
          </Button>
          <Button
            variant="secondary"
            size="md"
            icon={<Upload className="h-4 w-4" />}
            onClick={() => setImportOpen(true)}
          >
            Import
          </Button>
          <Button
            variant="secondary"
            size="md"
            icon={<ShieldCheck className="h-4 w-4" />}
            onClick={() => { setIpCheckOpen(true); setIpCheckInput(''); setIpCheckReport(null); setIpCheckError(null) }}
          >
            Check IP
          </Button>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {someSelected && (
        <div className="mb-3 shrink-0 flex items-center gap-3 px-4 py-2.5 rounded-[--radius-lg] bg-accent/8 border border-accent/20 animate-fadeIn">
          <span className="text-xs font-medium text-accent">{selected.size} selected</span>
          <div className="h-4 w-px bg-accent/20" />
          <Button
            variant="ghost"
            size="sm"
            icon={<FlaskConical className="h-3.5 w-3.5" />}
            onClick={bulkTestSelected}
            loading={bulkTesting}
            disabled={bulkTesting}
          >
            Test
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Download className="h-3.5 w-3.5" />}
            onClick={bulkExportSelected}
          >
            Export
          </Button>
          <Button
            variant="danger"
            size="sm"
            icon={<Trash2 className="h-3.5 w-3.5" />}
            onClick={bulkDeleteSelected}
          >
            Delete
          </Button>
          <div className="flex-1" />
          <button
            className="text-xs text-muted hover:text-content transition-colors cursor-pointer"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
        </div>
      )}

      {/* Content */}
      {proxies.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={<Globe />}
            title="No proxies yet"
            description="Add HTTP, HTTPS, or SOCKS proxies here — attach them to profiles from the editor to route traffic through them."
            action={
              <Button
                variant="primary"
                size="md"
                icon={<Plus className="h-4 w-4" />}
                onClick={openAdd}
              >
                Add Proxy
              </Button>
            }
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 bg-card rounded-[--radius-lg] border border-edge overflow-hidden flex flex-col">
          <div className="flex-1 overflow-auto">
            <table className="w-full text-sm">
              <colgroup>
                <col className="w-10" />
                <col className="w-[20%]" />
                <col className="w-[8%]" />
                <col className="w-[7%]" />
                <col className="w-[8%]" />
                <col className="w-[11%]" />
                <col className="w-[12%]" />
                <col className="w-[9%]" />
                <col className="w-12" />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-surface-alt/80 backdrop-blur-sm">
                <tr className="border-b border-edge/80">
                  <th className="px-3 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className={CHECKBOX}
                      aria-label="Select all"
                    />
                  </th>
                  <th className="px-3 py-3 text-left text-[10.5px] font-semibold text-muted/80 uppercase tracking-[0.08em]">
                    Name / Host
                  </th>
                  <th className="px-3 py-3 text-left text-[10.5px] font-semibold text-muted/80 uppercase tracking-[0.08em]">
                    Type
                  </th>
                  <th className="px-3 py-3 text-left text-[10.5px] font-semibold text-muted/80 uppercase tracking-[0.08em]">
                    Port
                  </th>
                  <th className="px-3 py-3 text-left text-[10.5px] font-semibold text-muted/80 uppercase tracking-[0.08em]">
                    Country
                  </th>
                  <th className="px-3 py-3 text-left text-[10.5px] font-semibold text-muted/80 uppercase tracking-[0.08em]">
                    Reputation
                  </th>
                  <th className="px-3 py-3 text-left text-[10.5px] font-semibold text-muted/80 uppercase tracking-[0.08em]">
                    Status
                  </th>
                  <th className="px-3 py-3 text-left text-[10.5px] font-semibold text-muted/80 uppercase tracking-[0.08em]">
                    Speed
                  </th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {filteredProxies.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-sm text-muted">
                      No matching proxies
                    </td>
                  </tr>
                ) : (
                  filteredProxies.map((proxy) => {
                    const isTesting = testingIds.has(proxy.id)
                    const isCheckingFraud = checkingFraudIds.has(proxy.id)
                    const status = statusBadge(proxy)
                    const reputation = reputationBadge(proxy)
                    return (
                      <tr
                        key={proxy.id}
                        className={cn(
                          'border-b border-edge/40 transition-colors duration-150 ease-[var(--ease-osmosis)]',
                          selected.has(proxy.id) ? 'bg-accent/8 shadow-[inset_2px_0_0_0_var(--color-accent)]' : 'hover:bg-elevated/40'
                        )}
                      >
                        {/* Checkbox */}
                        <td className="px-3 py-2.5">
                          <input
                            type="checkbox"
                            checked={selected.has(proxy.id)}
                            onChange={() => toggleOne(proxy.id)}
                            className={CHECKBOX}
                            aria-label={`Select ${proxy.name}`}
                          />
                        </td>

                        {/* Name / Host */}
                        <td className="px-3 py-2.5">
                          <div className="min-w-0">
                            <p className="text-content font-medium truncate">{proxy.name}</p>
                            <p className="text-xs text-muted font-mono truncate">
                              {proxy.host}
                              {proxy.external_ip && proxy.external_ip !== proxy.host && (
                                <span className="text-muted/60"> → {proxy.external_ip}</span>
                              )}
                            </p>
                          </div>
                        </td>

                        {/* Type */}
                        <td className="px-3 py-2.5">
                          <Badge variant={PROTOCOL_BADGE[proxy.protocol]}>
                            {proxy.protocol.toUpperCase()}
                          </Badge>
                        </td>

                        {/* Port */}
                        <td className="px-3 py-2.5 font-mono text-xs text-muted tabular-nums">
                          {proxy.port}
                        </td>

                        {/* Country */}
                        <td className="px-3 py-2.5 text-xs">
                          {proxy.country ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span>{countryFlag(proxy.country)}</span>
                              <span className="text-muted font-medium uppercase">
                                {proxy.country}
                              </span>
                            </span>
                          ) : (
                            <span className="text-muted/40">—</span>
                          )}
                        </td>

                        {/* Reputation */}
                        <td className="px-3 py-2.5">
                          {isCheckingFraud ? (
                            <Badge variant="default" dot>
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Checking
                            </Badge>
                          ) : (
                            <Tooltip content={reputation.tooltip}>
                              <button
                                type="button"
                                onClick={() => handleRecheckFraud(proxy.id)}
                                disabled={isCheckingFraud}
                                aria-label={reputation.ariaLabel}
                                className="rounded-[--radius-sm] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                              >
                                <Badge variant={reputation.variant} className="cursor-pointer inline-flex items-center gap-1 hover:opacity-80 transition-opacity">
                                  {reputation.icon}
                                  {reputation.label}
                                </Badge>
                              </button>
                            </Tooltip>
                          )}
                        </td>

                        {/* Status */}
                        <td className="px-3 py-2.5">
                          {isTesting ? (
                            <Badge variant="default" dot>
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Testing
                            </Badge>
                          ) : !proxy.check_ok && proxy.check_error ? (
                            <Tooltip
                              content={
                                PROXY_CHECK_ERROR_MESSAGES[proxy.check_error] ?? proxy.check_error
                              }
                            >
                              <Badge variant={status.variant} dot className="cursor-help">
                                {status.label}
                              </Badge>
                            </Tooltip>
                          ) : (
                            <Badge variant={status.variant} dot>
                              {status.label}
                            </Badge>
                          )}
                        </td>

                        {/* Speed */}
                        <td className="px-3 py-2.5 text-xs font-mono tabular-nums">
                          {proxy.check_ok && proxy.check_latency_ms != null ? (
                            <span className="text-ok">{proxy.check_latency_ms}ms</span>
                          ) : (
                            <span className="text-muted/40">—</span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="px-3 py-2.5">
                          <DropdownMenu
                            align="right"
                            trigger={
                              <Button
                                variant="ghost"
                                size="sm"
                                icon={<MoreHorizontal className="h-4 w-4" />}
                                aria-label="Actions"
                              />
                            }
                            items={[
                              {
                                label: 'Test',
                                icon: <FlaskConical className="h-4 w-4" />,
                                onClick: () => handleTest(proxy.id),
                                disabled: isTesting
                              },
                              {
                                label: 'Recheck reputation',
                                icon: <RefreshCw className="h-4 w-4" />,
                                onClick: () => handleRecheckFraud(proxy.id),
                                disabled: isCheckingFraud
                              },
                              {
                                label: 'Edit',
                                icon: <Pencil className="h-4 w-4" />,
                                onClick: () => openEdit(proxy)
                              },
                              {
                                label: 'Copy',
                                icon: <Copy className="h-4 w-4" />,
                                onClick: () => handleCopy(proxy)
                              },
                              {
                                label: 'Delete',
                                icon: <Trash2 className="h-4 w-4" />,
                                onClick: () => handleDelete(proxy.id, proxy.name),
                                variant: 'danger'
                              }
                            ]}
                          />
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editingId ? 'Edit Proxy' : 'Add Proxy'}
        description={editingId ? 'Update proxy configuration' : 'Configure a new proxy server'}
        size="md"
        actions={
          <>
            {editingId ? (
              <Button
                variant="ghost"
                size="md"
                icon={<FlaskConical className="h-4 w-4" />}
                onClick={handleTestInModal}
                loading={modalTesting}
                disabled={modalTesting || modalSaving}
              >
                Test
              </Button>
            ) : (
              <span className="mr-auto text-xs text-muted">
                Save the proxy first to test it.
              </span>
            )}
            <Button variant="secondary" size="md" onClick={closeModal}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={handleSubmit(onSubmitProxy)}
              loading={modalSaving}
              disabled={modalSaving}
            >
              {editingId ? 'Save Changes' : 'Add Proxy'}
            </Button>
          </>
        }
      >
        {modalError && (
          <div className="rounded-[--radius-md] bg-err/8 border border-err/20 px-3.5 py-2.5 text-xs text-err mb-4 font-medium">
            {modalError}
          </div>
        )}

        <form id="proxy-form" onSubmit={handleSubmit(onSubmitProxy)} className="space-y-3">
          <div>
            <label
              htmlFor="proxy-quick-paste"
              className={LABEL}
            >
              Quick paste
            </label>
            <Input
              ref={quickPasteInputRef}
              id="proxy-quick-paste"
              placeholder="socks5://user:pass@host:port"
              value={quickPaste}
              onChange={(e) => setQuickPaste(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  // Prevent accidental form submission via the outer <form>.
                  e.preventDefault()
                  void runQuickPasteParse(quickPaste)
                }
              }}
              autoComplete="off"
              spellCheck={false}
              icon={<ClipboardPaste className="h-4 w-4" />}
              rightIcon={
                quickPasteParsing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : quickPasteFilled ? (
                  <Check className="h-4 w-4 text-ok" />
                ) : undefined
              }
            />
            {quickPasteMultiline ? (
              <p className="mt-1 text-xs leading-snug text-err">
                {QUICK_PASTE_HINT.multiline}
                {!editingId && (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="underline underline-offset-2 text-accent hover:text-accent/80 transition-colors"
                      onClick={() => openBulkImportWithText(quickPaste)}
                    >
                      Open bulk import
                    </button>
                  </>
                )}
              </p>
            ) : quickPasteParsing ? (
              <p className="mt-1 text-xs leading-snug text-muted">Parsing…</p>
            ) : quickPasteFilled ? (
              <p className="mt-1 text-xs leading-snug text-ok">✓ Filled</p>
            ) : (
              <p
                className={cn(
                  'mt-1 text-xs leading-snug',
                  quickPasteHint ? 'text-err' : 'text-muted'
                )}
              >
                {quickPasteHint ?? 'Paste any format — fields auto-fill'}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="proxy-name" className={LABEL}>
              Name
            </label>
            <Input
              id="proxy-name"
              placeholder="My Proxy"
              error={errors.name?.message}
              {...register('name')}
            />
          </div>

          <div>
            <label
              htmlFor="proxy-protocol"
              className={LABEL}
            >
              Protocol
            </label>
            <Select
              id="proxy-protocol"
              options={PROTOCOL_OPTIONS}
              error={errors.protocol?.message}
              {...register('protocol')}
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label
                htmlFor="proxy-host"
                className={LABEL}
              >
                Host
              </label>
              <Input
                id="proxy-host"
                placeholder="192.168.1.1"
                error={errors.host?.message}
                {...register('host')}
              />
            </div>
            <div>
              <label
                htmlFor="proxy-port"
                className={LABEL}
              >
                Port
              </label>
              <Input
                id="proxy-port"
                type="number"
                placeholder="8080"
                error={errors.port?.message}
                {...register('port', { valueAsNumber: true })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label
                htmlFor="proxy-username"
                className={LABEL}
              >
                Username
              </label>
              <Input id="proxy-username" placeholder="optional" {...register('username')} />
              {editingId && editingProxyHasUsername && (
                <div className="mt-1">
                  {clearCreds.username && !watchedUsername ? (
                    <p className="text-xs text-muted">
                      Username will be cleared on save.{' '}
                      <button
                        type="button"
                        className="underline underline-offset-2 text-accent hover:text-accent/80 transition-colors"
                        onClick={() =>
                          setClearCreds((prev) => ({ ...prev, username: false }))
                        }
                      >
                        Undo
                      </button>
                    </p>
                  ) : (
                    <button
                      type="button"
                      className="text-xs text-muted hover:text-content underline underline-offset-2 transition-colors"
                      onClick={() => {
                        setValue('username', '', { shouldDirty: true })
                        setClearCreds((prev) => ({ ...prev, username: true }))
                      }}
                    >
                      Clear saved username
                    </button>
                  )}
                </div>
              )}
            </div>
            <div>
              <label
                htmlFor="proxy-password"
                className={LABEL}
              >
                Password
              </label>
              <Input
                id="proxy-password"
                type="password"
                placeholder={
                  editingId && editingProxyHasPassword
                    ? '•••••• (leave empty to keep)'
                    : 'optional'
                }
                {...register('password')}
              />
              {editingId && editingProxyHasPassword && (
                <div className="mt-1">
                  {clearCreds.password && !watchedPassword ? (
                    <p className="text-xs text-muted">
                      Password will be cleared on save.{' '}
                      <button
                        type="button"
                        className="underline underline-offset-2 text-accent hover:text-accent/80 transition-colors"
                        onClick={() =>
                          setClearCreds((prev) => ({ ...prev, password: false }))
                        }
                      >
                        Undo
                      </button>
                    </p>
                  ) : (
                    <button
                      type="button"
                      className="text-xs text-muted hover:text-content underline underline-offset-2 transition-colors"
                      onClick={() => {
                        setValue('password', '', { shouldDirty: true })
                        setClearCreds((prev) => ({ ...prev, password: true }))
                      }}
                    >
                      Clear saved password
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label
                htmlFor="proxy-country"
                className={LABEL}
              >
                Country
              </label>
              <Input
                id="proxy-country"
                placeholder="US, DE, etc."
                maxLength={2}
                {...register('country')}
              />
            </div>
            <div>
              <label
                htmlFor="proxy-group"
                className={LABEL}
              >
                Group tag
              </label>
              <Input id="proxy-group" placeholder="rotation-group" {...register('group_tag')} />
            </div>
          </div>
        </form>
      </Modal>

      {/* Import Modal */}
      <Modal
        open={importOpen}
        onClose={closeImport}
        title="Import Proxies"
        description="Paste proxies below or upload a file. One proxy per line."
        size="lg"
        actions={
          importParsed ? (
            <>
              <Button variant="secondary" size="md" onClick={() => setImportParsed(null)}>
                Back
              </Button>
              <Button
                variant="primary"
                size="md"
                icon={<CheckSquare className="h-4 w-4" />}
                onClick={executeImport}
                loading={importLoading}
                disabled={importLoading || importParsed.filter((r) => r.ok).length === 0}
              >
                Import {importParsed.filter((r) => r.ok).length} Proxies
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" size="md" onClick={closeImport}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={parseImport}
                loading={importLoading}
                disabled={importLoading || !importText.trim()}
              >
                Preview
              </Button>
            </>
          )
        }
      >
        {!importParsed ? (
          <>
            <p className="text-xs text-muted mb-3 leading-relaxed">
              Formats:{' '}
              <code className="text-accent bg-accent/8 px-1 py-0.5 rounded-[--radius-sm]">
                host:port
              </code>
              ,{' '}
              <code className="text-accent bg-accent/8 px-1 py-0.5 rounded-[--radius-sm]">
                host:port:user:pass
              </code>
              ,{' '}
              <code className="text-accent bg-accent/8 px-1 py-0.5 rounded-[--radius-sm]">
                socks5://host:port
              </code>
              ,{' '}
              <code className="text-accent bg-accent/8 px-1 py-0.5 rounded-[--radius-sm]">
                user:pass@host:port
              </code>
            </p>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={'192.168.1.1:8080\nsocks5://proxy.example.com:1080:user:pass'}
              rows={8}
              className={cn(TEXTAREA, 'font-mono mb-3')}
            />
            <Button
              variant="secondary"
              size="sm"
              icon={<FileUp className="h-4 w-4" />}
              onClick={handleFileUpload}
            >
              Upload File
            </Button>
          </>
        ) : (
          <div className="space-y-2 max-h-72 overflow-auto">
            {importParsed.map((r, i) => (
              <div
                key={i}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-[--radius-md] text-xs font-mono',
                  r.ok
                    ? 'bg-ok/5 border border-ok/15 text-content'
                    : 'bg-err/5 border border-err/15 text-muted line-through'
                )}
              >
                <Badge variant={r.ok ? 'success' : 'error'} dot>
                  {r.ok ? 'OK' : 'Invalid'}
                </Badge>
                <span className="truncate">
                  {r.data
                    ? `${r.data.protocol}://${r.data.host}:${r.data.port}`
                    : `Line ${i + 1}`}
                </span>
              </div>
            ))}
            <p className="text-xs text-muted pt-1">
              {importParsed.filter((r) => r.ok).length} of {importParsed.length} proxies will be
              imported
            </p>
            <label className="flex items-start gap-2.5 mt-3 px-3 py-2.5 rounded-[--radius-md] bg-elevated/30 border border-edge/40 cursor-pointer hover:bg-elevated/50 transition-colors">
              <input
                type="checkbox"
                checked={importFilterFraud}
                onChange={(e) => setImportFilterFraud(e.target.checked)}
                className={cn(CHECKBOX, 'mt-0.5')}
              />
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-content">
                  Filter by reputation
                </p>
                <p className="text-xs text-muted leading-relaxed mt-0.5">
                  Skip proxies whose IP is on a datacenter / known-proxy ASN. Each candidate is
                  probed via ip-api.com through the proxy itself before being persisted; risky IPs
                  are dropped silently. Sequential lookup (~1s per proxy).
                </p>
              </div>
            </label>
            {importLoading && importProgress && (
              <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-[--radius-md] bg-accent/5 border border-accent/15 text-xs text-content">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-accent shrink-0" />
                <span className="font-mono tabular-nums">
                  {importProgress.checked}/{importProgress.total}
                </span>
                <span className="text-muted">checked</span>
                {importProgress.risky > 0 && (
                  <span className="ml-auto text-warn font-medium">
                    {importProgress.risky} risky skipped
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Standalone IP fraud-check tool */}
      <Modal
        open={ipCheckOpen}
        onClose={() => setIpCheckOpen(false)}
        title="Check IP reputation"
        description="Investigate any IP without adding it as a proxy. Both providers (ip-api + ipapi.is) are queried directly from this machine."
        size="md"
        actions={
          <Button
            variant="primary"
            size="md"
            icon={<ShieldCheck className="h-4 w-4" />}
            onClick={() => handleStandaloneIpCheck()}
            loading={ipCheckLoading}
            disabled={ipCheckLoading || !ipCheckInput.trim()}
          >
            Check
          </Button>
        }
      >
        <div className="space-y-3">
          <Input
            label="IP address"
            placeholder="e.g. 84.54.120.38"
            value={ipCheckInput}
            onChange={(e) => setIpCheckInput(e.target.value)}
            disabled={ipCheckLoading}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && ipCheckInput.trim() && !ipCheckLoading) {
                handleStandaloneIpCheck()
              }
            }}
          />
          <p className="text-[11px] text-muted/70 leading-relaxed">
            Privacy note: this query runs from your real machine — both providers will see your
            actual IP alongside the IP under investigation. Use the per-row Recheck action when
            you want to characterize a proxy without revealing your host.
          </p>
          {ipCheckError && (
            <div className="rounded-[--radius-md] bg-err/8 border border-err/20 px-3 py-2 text-xs text-err">
              {ipCheckError}
            </div>
          )}
          {ipCheckReport && <IpFraudReportPanel report={ipCheckReport} />}
        </div>
      </Modal>
    </div>
  )
}

// ---------------------------------------------------------------------------
// IP Fraud Report panel — shared shape between the standalone tool and any
// future inline lookup. Mirrors the reputation tooltip but in a full panel
// so the user can read every signal without hovering.
// ---------------------------------------------------------------------------

function IpFraudReportPanel({ report }: { report: IpFraudReport }): React.JSX.Element {
  const meta = FRAUD_BUCKET_META[report.fraud_risk]
  const flags: { label: string; on: boolean | null; tone: 'warn' | 'ok' | 'neutral' }[] = [
    { label: 'Datacenter / hosting', on: report.is_datacenter ?? report.is_hosting, tone: 'warn' },
    { label: 'Known proxy', on: report.is_proxy_detected, tone: 'warn' },
    { label: 'VPN', on: report.is_vpn, tone: 'warn' },
    { label: 'Tor', on: report.is_tor, tone: 'warn' },
    { label: 'Past abuse', on: report.is_abuser, tone: 'warn' },
    { label: 'Mobile carrier', on: report.is_mobile, tone: 'ok' }
  ]
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-[--radius-md] bg-elevated/40 border border-edge/40">
        <Badge variant={meta.variant} className="inline-flex items-center gap-1">
          {fraudBucketIcon(meta.icon)}
          {meta.label} {report.fraud_score}
        </Badge>
        <span className="text-xs text-muted">/ 100</span>
        <span className="ml-auto font-mono text-xs text-content">{report.ip}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        {report.country && (
          <div className="rounded-[--radius-md] bg-surface border border-edge/40 px-3 py-2">
            <p className="text-muted text-[10px] uppercase tracking-wider">Country</p>
            <p className="text-content">
              {report.country_code && <span className="mr-1">{countryFlag(report.country_code)}</span>}
              {report.country}{report.city ? ` — ${report.city}` : ''}
            </p>
          </div>
        )}
        {report.isp && (
          <div className="rounded-[--radius-md] bg-surface border border-edge/40 px-3 py-2">
            <p className="text-muted text-[10px] uppercase tracking-wider">ISP</p>
            <p className="text-content truncate" title={report.isp}>{report.isp}</p>
          </div>
        )}
        {report.asn && (
          <div className="rounded-[--radius-md] bg-surface border border-edge/40 px-3 py-2 col-span-2">
            <p className="text-muted text-[10px] uppercase tracking-wider">ASN</p>
            <p className="text-content font-mono truncate" title={report.asn}>
              {report.asn}{report.asn_type ? <span className="text-muted ml-1">({report.asn_type})</span> : null}
            </p>
          </div>
        )}
        {report.abuse_score !== null && (
          <div className="rounded-[--radius-md] bg-surface border border-edge/40 px-3 py-2 col-span-2">
            <p className="text-muted text-[10px] uppercase tracking-wider">Abuse score (ipapi.is)</p>
            <p className="text-content font-mono">{(report.abuse_score * 100).toFixed(2)}%</p>
          </div>
        )}
      </div>
      <div className="rounded-[--radius-md] bg-surface border border-edge/40 px-3 py-2">
        <p className="text-muted text-[10px] uppercase tracking-wider mb-2">Signals</p>
        <div className="flex flex-wrap gap-1.5">
          {flags.map((f) => (
            <Badge
              key={f.label}
              variant={f.on === true ? (f.tone === 'warn' ? 'error' : 'success') : 'default'}
              className="text-[11px]"
            >
              {f.on === null ? '— ' : f.on ? '✓ ' : '✗ '}
              {f.label}
            </Badge>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-muted/70">
        Sources: {report.fraud_providers.join(', ') || 'none'}
      </p>
    </div>
  )
}
