import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Trash2, FlaskConical, X } from "lucide-react";
import { useProxiesStore } from "../stores/proxies";
import { api } from "../lib/invoke";
import type { Proxy, ProxyProtocol } from "../lib/types";

const PROXY_PROTOCOLS: ProxyProtocol[] = ["http", "https", "socks4", "socks5"];

const proxySchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  protocol: z.enum(["http", "https", "socks4", "socks5"]),
  host: z.string().min(1, "Host is required"),
  port: z.number().int().min(1).max(65535),
  username: z.string().optional(),
  password: z.string().optional(),
});

type ProxyFormData = z.infer<typeof proxySchema>;

const inputClass =
  "w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 focus:ring-[var(--accent)] transition-colors";

const inputStyle = {
  backgroundColor: "var(--bg-primary)",
  borderColor: "var(--border)",
  color: "var(--text-primary)",
};

function ProxyModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProxyFormData>({
    resolver: zodResolver(proxySchema),
    defaultValues: {
      name: "",
      protocol: "http",
      host: "",
      port: 8080,
      username: "",
      password: "",
    },
  });

  async function onSubmit(data: ProxyFormData) {
    setSaving(true);
    setError(null);
    try {
      await api.createProxy({
        name: data.name,
        protocol: data.protocol,
        host: data.host,
        port: data.port,
        username: data.username || undefined,
        password: data.password || undefined,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
    >
      <div
        className="absolute inset-0"
        style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-md rounded-xl border p-6"
        style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">Add Proxy</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md transition-colors"
            style={{ color: "var(--text-secondary)" }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {error && (
            <div
              className="px-4 py-3 rounded-lg text-sm"
              style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "var(--danger)", border: "1px solid var(--danger)" }}
            >
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
              Name
            </label>
            <input {...register("name")} className={inputClass} style={inputStyle} placeholder="My Proxy" />
            {errors.name && (
              <p className="text-xs mt-1" style={{ color: "var(--danger)" }}>{errors.name.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
              Protocol
            </label>
            <select {...register("protocol")} className={inputClass} style={inputStyle}>
              {PROXY_PROTOCOLS.map((p) => (
                <option key={p} value={p}>{p.toUpperCase()}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
                Host
              </label>
              <input {...register("host")} className={inputClass} style={inputStyle} placeholder="proxy.example.com" />
              {errors.host && (
                <p className="text-xs mt-1" style={{ color: "var(--danger)" }}>{errors.host.message}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
                Port
              </label>
              <input {...register("port", { valueAsNumber: true })} type="number" className={inputClass} style={inputStyle} />
              {errors.port && (
                <p className="text-xs mt-1" style={{ color: "var(--danger)" }}>{errors.port.message}</p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
              Username <span style={{ color: "var(--text-secondary)" }}>(optional)</span>
            </label>
            <input {...register("username")} className={inputClass} style={inputStyle} />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
              Password <span style={{ color: "var(--text-secondary)" }}>(optional)</span>
            </label>
            <input {...register("password")} type="password" className={inputClass} style={inputStyle} />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full py-2.5 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50"
            style={{ backgroundColor: "var(--accent)" }}
          >
            {saving ? "Adding…" : "Add Proxy"}
          </button>
        </form>
      </div>
    </div>
  );
}

function ProxyRow({
  proxy,
  onTest,
  onDelete,
  testing,
}: {
  proxy: Proxy;
  onTest: () => void;
  onDelete: () => void;
  testing: boolean;
}) {
  return (
    <tr style={{ borderColor: "var(--border)" }}>
      <td className="px-4 py-3 text-sm font-medium">{proxy.name}</td>
      <td className="px-4 py-3">
        <span
          className="inline-flex px-2 py-0.5 rounded text-xs font-medium uppercase"
          style={{ backgroundColor: "var(--bg-hover)", color: "var(--text-secondary)" }}
        >
          {proxy.protocol}
        </span>
      </td>
      <td className="px-4 py-3 text-sm" style={{ color: "var(--text-secondary)" }}>
        {proxy.host}:{proxy.port}
      </td>
      <td className="px-4 py-3 text-sm" style={{ color: "var(--text-secondary)" }}>
        {proxy.username ?? "—"}
      </td>
      <td className="px-4 py-3">
        {proxy.check_ok ? (
          <span
            className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium"
            style={{ backgroundColor: "var(--success)", color: "#fff" }}
          >
            OK
          </span>
        ) : (
          <span
            className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium"
            style={{ backgroundColor: "var(--bg-hover)", color: "var(--text-secondary)" }}
          >
            Unchecked
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          <button
            onClick={onTest}
            disabled={testing}
            className="p-1.5 rounded-md transition-colors disabled:opacity-50 hover:bg-[var(--bg-hover)]"
            style={{ color: "var(--accent)" }}
            title="Test proxy"
          >
            <FlaskConical className="w-4 h-4" />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-md transition-colors hover:bg-[var(--bg-hover)]"
            style={{ color: "var(--danger)" }}
            title="Delete proxy"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

export function ProxiesPage() {
  const { proxies, loading, fetchProxies, deleteProxy, testProxy } =
    useProxiesStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  useEffect(() => {
    fetchProxies();
  }, [fetchProxies]);

  async function handleTest(id: string) {
    setTestingId(id);
    try {
      await testProxy(id);
    } finally {
      setTestingId(null);
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Proxies</h1>
        <button
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors"
          style={{ backgroundColor: "var(--accent)" }}
        >
          <Plus className="w-4 h-4" />
          Add Proxy
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div
            className="w-8 h-8 border-2 rounded-full animate-spin"
            style={{ borderColor: "var(--border)", borderTopColor: "var(--accent)" }}
          />
        </div>
      ) : proxies.length === 0 ? (
        <div
          className="text-center py-20 rounded-xl border"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-card)" }}
        >
          <p className="text-lg mb-2" style={{ color: "var(--text-secondary)" }}>
            No proxies yet
          </p>
          <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
            Add a proxy to use with your browser profiles.
          </p>
          <button
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors"
            style={{ backgroundColor: "var(--accent)" }}
          >
            <Plus className="w-4 h-4" />
            Add Proxy
          </button>
        </div>
      ) : (
        <div
          className="rounded-xl border overflow-hidden"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-card)" }}
        >
          <table className="w-full">
            <thead>
              <tr
                className="text-left text-xs uppercase tracking-wider border-b"
                style={{ color: "var(--text-secondary)", borderColor: "var(--border)" }}
              >
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Protocol</th>
                <th className="px-4 py-3 font-medium">Host:Port</th>
                <th className="px-4 py-3 font-medium">Username</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
              {proxies.map((proxy) => (
                <ProxyRow
                  key={proxy.id}
                  proxy={proxy}
                  onTest={() => handleTest(proxy.id)}
                  onDelete={() => {
                    if (!window.confirm("Delete this proxy?")) return;
                    deleteProxy(proxy.id);
                  }}
                  testing={testingId === proxy.id}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <ProxyModal onClose={() => setModalOpen(false)} onSaved={fetchProxies} />
      )}
    </div>
  );
}
