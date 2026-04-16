import { useCallback, useEffect, useState } from 'react'
import {
  Puzzle,
  Trash2,
  Package,
  AlertTriangle,
  Info
} from 'lucide-react'
import type { ProfileExtension } from '../../../../preload/api-contract'
import { api } from '../../lib/api'
import { useToastStore } from '../Toast'
import { useConfirmStore } from '../ConfirmDialog'
import { Button, Card, Toggle, Tooltip, EmptyState } from '../ui'

const CHROME_137_WARNING =
  'Some Chromium builds (Chrome 137+) disable --load-extension. Use the bundled Managed Chromium for reliable extension support.'

interface ExtensionsTabProps {
  profileId: string
}

export function ExtensionsTab({ profileId }: ExtensionsTabProps): React.JSX.Element {
  const addToast = useToastStore((s) => s.addToast)
  const confirm = useConfirmStore((s) => s.show)

  const [extensions, setExtensions] = useState<ProfileExtension[] | null>(null)
  const [installing, setInstalling] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const list = await api.listProfileExtensions(profileId)
      setExtensions(list)
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to load extensions',
        'error'
      )
      setExtensions([])
    }
  }, [profileId, addToast])

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleInstallCrx = async (): Promise<void> => {
    setInstalling(true)
    try {
      const picked = await api.dialogOpenCrx()
      if (picked.canceled || !picked.filePath) {
        return
      }
      await api.installCrxFromFile(profileId, picked.filePath)
      addToast('Extension installed', 'success')
      await refresh()
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to install extension',
        'error'
      )
    } finally {
      setInstalling(false)
    }
  }

  const handleToggle = async (ext: ProfileExtension, next: boolean): Promise<void> => {
    setTogglingId(ext.id)
    // Optimistic update.
    setExtensions((list) =>
      list
        ? list.map((e) => (e.id === ext.id ? { ...e, enabled: next ? 1 : 0 } : e))
        : list
    )
    try {
      await api.toggleProfileExtension(ext.id, next)
    } catch (err) {
      // Revert.
      setExtensions((list) =>
        list
          ? list.map((e) =>
              e.id === ext.id ? { ...e, enabled: next ? 0 : 1 } : e
            )
          : list
      )
      addToast(
        err instanceof Error ? err.message : 'Failed to toggle extension',
        'error'
      )
    } finally {
      setTogglingId(null)
    }
  }

  const handleRemove = async (ext: ProfileExtension): Promise<void> => {
    const ok = await confirm({
      title: 'Remove extension?',
      message: `Remove "${ext.name}" from this profile? The extension files are not deleted from disk.`,
      confirmLabel: 'Remove',
      danger: true
    })
    if (!ok) return
    setRemovingId(ext.id)
    try {
      await api.removeProfileExtension(ext.id)
      addToast('Extension removed', 'success')
      await refresh()
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to remove extension',
        'error'
      )
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start gap-2">
        <Puzzle className="h-4 w-4 mt-0.5 shrink-0 text-muted" />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-content">Extensions</h3>
          <div
            role="note"
            className="mt-2 rounded border border-warn/20 bg-warn/10 px-3 py-2 flex gap-2 items-start text-sm"
          >
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-warn" />
            <span className="text-content">{CHROME_137_WARNING}</span>
          </div>
        </div>
      </div>

      {/* Install row */}
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<Package className="h-3.5 w-3.5" />}
            onClick={handleInstallCrx}
            loading={installing}
            disabled={installing}
            type="button"
          >
            Install from CRX file
          </Button>
        </div>
        {installing && (
          <p className="mt-2 text-[11px] text-muted flex items-start gap-1.5">
            <Info className="h-3 w-3 mt-0.5 shrink-0" />
            Unpacking… this can take a moment for large files.
          </p>
        )}
        <p className="mt-2 text-[11px] text-muted flex items-start gap-1.5">
          <Info className="h-3 w-3 mt-0.5 shrink-0" />
          Changes apply on the next profile launch.
        </p>
      </Card>

      {/* List */}
      {extensions === null ? (
        <div className="rounded-[--radius-lg] border border-edge bg-card p-6 text-center text-xs text-muted">
          Loading…
        </div>
      ) : extensions.length === 0 ? (
        <EmptyState
          icon={<Puzzle className="h-6 w-6" />}
          title="No extensions installed yet"
          description="Install a CRX to add browser extensions to this profile."
        />
      ) : (
        <div className="rounded-[--radius-lg] border border-edge bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-elevated/50 text-[10px] uppercase tracking-wider text-muted">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Name</th>
                  <th className="text-left font-medium px-3 py-2 w-20">Enabled</th>
                  <th className="text-left font-medium px-3 py-2">Path</th>
                  <th className="text-right font-medium px-3 py-2 w-16">Actions</th>
                </tr>
              </thead>
              <tbody>
                {extensions.map((ext) => (
                  <tr
                    key={ext.id}
                    className="border-t border-edge hover:bg-elevated/30 transition-colors"
                  >
                    <td className="px-3 py-2 text-content font-medium">{ext.name}</td>
                    <td className="px-3 py-2">
                      <Toggle
                        checked={Boolean(ext.enabled)}
                        onChange={(next) => handleToggle(ext, next)}
                        disabled={togglingId === ext.id}
                        aria-label={`Toggle ${ext.name}`}
                      />
                    </td>
                    <td className="px-3 py-2 text-muted">
                      <Tooltip content={ext.path}>
                        <span className="font-mono truncate block max-w-[24rem]">
                          {ext.path}
                        </span>
                      </Tooltip>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Trash2 className="h-3.5 w-3.5" />}
                        onClick={() => handleRemove(ext)}
                        loading={removingId === ext.id}
                        disabled={removingId === ext.id}
                        aria-label={`Remove ${ext.name}`}
                        type="button"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
