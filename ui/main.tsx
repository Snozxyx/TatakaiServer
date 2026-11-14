import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import './style.css';
import { readApiResponse } from '../src/api-response.mjs';

/* -------------------------------------------------------------------------- */
/*                                    Types                                   */
/* -------------------------------------------------------------------------- */

interface Capability {
  ecosystem: string;
  available: boolean;
  reason?: string;
}

interface HealthInfo {
  serverId: string;
  platform: string;
  protocolVersion: number | string;
  setupRequired: boolean;
  adminPasswordRequired: boolean;
  accessPasswordRequired: boolean;
  capabilities: Capability[];
}

interface ServerConfig {
  name: string;
  logoUrl?: string;
  languages: string[];
  timeoutMs: number;
  concurrency: number;
  cacheSeconds: number;
  mediaCacheMb?: number;
  mediaCacheSeconds?: number;
  allowedOrigins: string[];
  proxyEnabled: boolean;
}

interface ExtensionItem {
  autoResolve?: boolean;
  id: string;
  manifestId?: string;
  name: string;
  version: string;
  ecosystem: string;
  runtime: 'node' | 'interpreter' | string;
  enabled: boolean;
  priority: number;
  languages: string[];
}

interface DeviceItem {
  id: string;
  label: string;
  role: string;
  current?: boolean;
}

interface RepositoryItem {
  id: string;
  name: string;
  url?: string;
}

interface CacheStats {
  responseCache?: { entries: number; bytes: number; maxBytes: number };
  lookupEntries: number;
  mediaEntries: number;
  mediaBytes: number;
  maxMediaBytes: number;
}

interface NativePackage {
  id: string;
  name: string;
  version: string;
  installed: boolean;
  repository?: string;
}

interface NativeSource {
  id: string;
  name: string;
  lang: string;
  enabled: boolean;
}

type TabKey = 'sources' | 'playground' | 'devices' | 'settings' | 'logs';
interface ServerLog { id: number; at: string; level: string; event: string; route?: string; method?: string; status?: number; durationMs: number; count?: number; name?: string }
type SourceSubTab = 'installed' | 'repositories' | 'native';

/* -------------------------------------------------------------------------- */
/*                              Crisp Inline Icons                            */
/* -------------------------------------------------------------------------- */

const Icon = {
  Logo: () => (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" />
      <line x1="12" y1="22" x2="12" y2="15.5" />
      <polyline points="22 8.5 12 15.5 2 8.5" />
    </svg>
  ),
  Layers: () => (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <path d="m22 12.5-8.97 4.08a2 2 0 0 1-1.66 0L2 12.5" />
      <path d="m22 17.5-8.97 4.08a2 2 0 0 1-1.66 0L2 17.5" />
    </svg>
  ),
  Terminal: () => (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" x2="20" y1="19" y2="19" />
    </svg>
  ),
  Devices: () => (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect width="14" height="8" x="5" y="2" rx="2" />
      <rect width="20" height="8" x="2" y="14" rx="2" />
      <path d="M6 18h2" />
      <path d="M12 18h6" />
    </svg>
  ),
  Sliders: () => (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" x2="4" y1="21" y2="14" />
      <line x1="4" x2="4" y1="10" y2="3" />
      <line x1="12" x2="12" y1="21" y2="12" />
      <line x1="12" x2="12" y1="8" y2="3" />
      <line x1="20" x2="20" y1="21" y2="16" />
      <line x1="20" x2="20" y1="12" y2="3" />
      <line x1="2" x2="6" y1="14" y2="14" />
      <line x1="10" x2="14" y1="8" y2="8" />
      <line x1="18" x2="22" y1="16" y2="16" />
    </svg>
  ),
  Qr: () => (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect width="5" height="5" x="3" y="3" rx="1" />
      <rect width="5" height="5" x="16" y="3" rx="1" />
      <rect width="5" height="5" x="3" y="16" rx="1" />
      <path d="M21 16h-3a2 2 0 0 0-2 2v3" />
      <path d="M21 21v.01" />
      <path d="M12 7v3a2 2 0 0 1-2 2H7" />
      <path d="M3 12h.01" />
      <path d="M12 3h.01" />
      <path d="M12 16v.01" />
      <path d="M16 12h1" />
      <path d="M21 12v.01" />
      <path d="M12 21v-1" />
    </svg>
  ),
  Copy: () => (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  ),
  Check: () => (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
  Refresh: () => (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  ),
  Trash: () => (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  ),
  Play: () => (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="6 3 20 12 6 21 6 3" />
    </svg>
  ),
  ChevronDown: () => (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 opacity-50" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  ),
  LogOut: () => (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" x2="9" y1="12" y2="12" />
    </svg>
  ),
  Download: () => (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  ),
  Upload: () => (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" x2="12" y1="3" y2="15" />
    </svg>
  ),
  ShieldAlert: () => (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  ),
  X: () => (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  ),
};

/* -------------------------------------------------------------------------- */
/*                             UI Helper Primitives                           */
/* -------------------------------------------------------------------------- */

function Field({
  label,
  hint,
  optional,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  children: React.ReactElement<{ id?: string }>;
  className?: string;
}) {
  const id = React.useId();
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-xs font-medium text-foreground/90">
          {label}
        </Label>
        {optional && <span className="text-[11px] text-muted-foreground">Optional</span>}
      </div>
      {React.cloneElement(children, { id })}
      {hint && <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Select({
  id,
  className = '',
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        id={id}
        className={`flex h-10 w-full appearance-none rounded-md border border-input bg-background pl-3 pr-9 py-2 text-sm text-foreground ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
        {...props}
      >
        {children}
      </select>
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
        <Icon.ChevronDown />
      </span>
    </div>
  );
}

function Switch({
  checked,
  onChange,
  name,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  name?: string;
  disabled?: boolean;
}) {
  return (
    <>
      {name && <input type="hidden" name={name} value={checked ? 'on' : ''} />}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
          checked ? 'bg-foreground' : 'bg-muted-foreground/25'
        }`}
      >
        <span
          className={`pointer-events-none block h-4 w-4 rounded-full bg-background shadow-sm ring-0 transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </>
  );
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid grid-cols-1 gap-6 py-8 first:pt-2 lg:grid-cols-12 lg:gap-10">
      <div className="lg:col-span-4">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div className="lg:col-span-8">{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*                               Main Application                             */
/* -------------------------------------------------------------------------- */

function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem('tatakai-server-owner') || '');
  const [health, setHealth] = useState<HealthInfo>();
  const [config, setConfig] = useState<ServerConfig>();
  const [extensions, setExtensions] = useState<ExtensionItem[]>([]);
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [repositories, setRepositories] = useState<RepositoryItem[]>([]);
  const [cache, setCache] = useState<CacheStats>();

  const [activeTab, setActiveTab] = useState<TabKey>('sources');
  const [sourceSubTab, setSourceSubTab] = useState<SourceSubTab>('installed');
  const [installMode, setInstallMode] = useState<'url' | 'file'>('url');

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  // Source management state
  const [trustedNode, setTrustedNode] = useState(false);
  const [selectedPkgName, setSelectedPkgName] = useState('');
  const [selectedManifestName, setSelectedManifestName] = useState('');
  const [expandedExtId, setExpandedExtId] = useState<string | null>(null);
  const [preference, setPreference] = useState<{ id: string; text: string }>();
  const [catalogPreview, setCatalogPreview] = useState<{ repoName: string; data: unknown } | null>(null);

  // Pairing & Clipboard state
  const [pair, setPair] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Native runtime state
  const [nativeFamily, setNativeFamily] = useState('mihon');
  const [nativePackages, setNativePackages] = useState<NativePackage[]>([]);
  const [nativeSources, setNativeSources] = useState<NativeSource[]>([]);
  const [nativeFilter, setNativeFilter] = useState('');

  // Playground state
  const [playgroundExtId, setPlaygroundExtId] = useState('');
  const [testResult, setTestResult] = useState('');
  const [testLatencyMs, setTestLatencyMs] = useState<number | null>(null);
  const [logs, setLogs] = useState<ServerLog[]>([]), [logError, setLogError] = useState(''), [logsPaused, setLogsPaused] = useState(false);

  useEffect(() => {
    if (!token || activeTab !== 'logs' || logsPaused) return;
    let cancelled = false, cursor = 0, timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const response = await fetch(`/api/server/v1/logs?after=${cursor}`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
        if (!response.ok) throw Error(response.status === 401 ? 'Owner session expired. Sign in again.' : `Logs unavailable (HTTP ${response.status})`);
        const result = await readApiResponse(response);
        if (!cancelled) {
          setLogs(previous => [...new Map([...previous, ...result.data.entries].map(row => [row.id, row])).values()].slice(-200));
          cursor = result.data.cursor; setLogError('');
        }
      } catch (error) { if (!cancelled) setLogError(error instanceof Error ? error.message : 'Logs unavailable'); }
      if (!cancelled) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [token, activeTab, logsPaused]);

  // Proxy toggle state synced with config
  const [proxyEnabled, setProxyEnabled] = useState(false);

  useEffect(() => {
    if (config) setProxyEnabled(Boolean(config.proxyEnabled));
  }, [config?.proxyEnabled]);

  useEffect(() => {
    if (extensions.length && !extensions.some(e => e.id === playgroundExtId)) {
      setPlaygroundExtId(extensions[0].id);
    }
  }, [extensions, playgroundExtId]);

  // Auto-dismiss transient success notices
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function api(path: string, method = 'GET', data?: unknown, bootstrap?: string) {
    const response = await fetch('/api/server/v1' + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(bootstrap ? { 'x-tatakai-bootstrap': bootstrap } : {}),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });

    if (response.status === 401) {
      if (!path.includes('/auth/')) {
        setToken('');
        sessionStorage.removeItem('tatakai-server-owner');
      }
      throw Error(
        path === '/auth/login'
          ? 'Incorrect owner password. Try again with your admin password.'
          : 'Owner access expired or was revoked. Sign in again.'
      );
    }

    const result = await readApiResponse(response);
    if (!response.ok || !result.success) {
      throw Error(result.error?.message || `Request failed (HTTP ${response.status})`);
    }
    return result.data;
  }

  async function refresh() {
    const healthData = await api('/health');
    setHealth(healthData);
    if (token) {
      const [settings, installed, connected, repos, cacheData] = await Promise.all([
        api('/settings'),
        api('/extensions'),
        api('/devices'),
        api('/repositories'),
        api('/cache'),
      ]);
      setConfig(settings);
      setExtensions(installed);
      setDevices(connected);
      setRepositories(repos);
      setCache(cacheData);
    }
  }

  useEffect(() => {
    refresh().catch(e => setError(e.message));
  }, [token]);

  async function action(fn: () => Promise<void>, message = 'Saved') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      if (message) setNotice(message);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  const form = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    return Object.fromEntries(new FormData(event.currentTarget));
  };

  function login(value: string) {
    sessionStorage.setItem('tatakai-server-owner', value);
    setToken(value);
  }

  async function copyText(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(prev => (prev === key ? null : prev)), 2000);
    } catch {
      setError('Clipboard access failed');
    }
  }

  async function toggleConfigureSource(extId: string) {
    if (expandedExtId === extId) {
      setExpandedExtId(null);
      setPreference(undefined);
      return;
    }
    setExpandedExtId(extId);
    setPreference(undefined);
    try {
      const prefs = await api('/extensions/' + extId + '/preferences');
      setPreference({ id: extId, text: JSON.stringify(prefs, null, 2) });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load preferences');
    }
  }

  const supportsNative = Boolean(health && ['node', 'desktop'].includes(health.platform));
  const isKaiSelected = selectedPkgName.toLowerCase().endsWith('.kai');

  const isPreferenceJsonValid = (() => {
    if (!preference) return true;
    try {
      JSON.parse(preference.text);
      return true;
    } catch {
      return false;
    }
  })();

  const cacheUsagePercent =
    cache && cache.maxMediaBytes > 0
      ? Math.min(100, Math.round((cache.mediaBytes / cache.maxMediaBytes) * 100))
      : 0;

  /* ------------------------------------------------------------------------ */
  /*                           Loading & Auth Views                           */
  /* ------------------------------------------------------------------------ */

  if (!health && !error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground antialiased">
        <div className="flex items-center gap-3 text-sm text-muted-foreground" role="status">
          <span className="h-2 w-2 animate-ping rounded-full bg-foreground" />
          Connecting to extension server…
        </div>
      </div>
    );
  }

  if (health && !token) {
    return (
      <div className="relative flex min-h-screen flex-col justify-between bg-zinc-50/60 dark:bg-zinc-950 text-foreground antialiased">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(#d4d4d8_1px,transparent_1px)] dark:bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:20px_20px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_40%,#000_60%,transparent_100%)] opacity-60" />

        <div className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-12">
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-foreground text-background shadow-sm">
              <Icon.Logo />
            </div>
            <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
              <span>Tatakai Server</span>
              <span>·</span>
              <span>{health.platform}</span>
              <span>·</span>
              <span>v{health.protocolVersion}</span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              {health.setupRequired ? 'Initialize your server' : 'Owner authentication'}
            </h1>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground max-w-xs">
              {health.setupRequired
                ? 'Configure ownership and viewer access. Leave passwords blank to use bootstrap-key management and public read access.'
                : 'Sign in with your administrator credentials to manage sources and connected devices.'}
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-5 flex items-start justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-3 text-xs text-destructive"
            >
              <span>{error}</span>
              <button type="button" onClick={() => setError('')} className="opacity-70 hover:opacity-100">
                <Icon.X />
              </button>
            </div>
          )}

          <div className="rounded-xl border border-border/80 bg-card p-6 shadow-sm">
            <form
              className="flex flex-col gap-4"
              onSubmit={event => {
                const input = form(event);
                void action(async () => {
                  const result = health.setupRequired
                    ? await api('/setup', 'POST', input, String(input.bootstrap))
                    : await api(
                        '/auth/login',
                        'POST',
                        { password: input.adminPassword, role: 'admin', label: 'Owner dashboard' },
                        String(input.bootstrap || '')
                      );
                  login(result.token);
                }, 'Signed in');
              }}
            >
              {(health.setupRequired || !health.adminPasswordRequired) && (
                <Field
                  label="Deployment bootstrap secret"
                  hint="Provided by your host environment or startup logs."
                >
                  <Input name="bootstrap" type="password" required autoComplete="off" className="font-mono text-xs" />
                </Field>
              )}

              {health.setupRequired && (
                <Field label="Server display name">
                  <Input name="name" defaultValue="Tatakai Server" required maxLength={100} />
                </Field>
              )}

              {(health.setupRequired || health.adminPasswordRequired) && (
                <Field
                  label="Admin password"
                  optional={health.setupRequired}
                  hint={health.setupRequired ? 'Minimum 10 characters if set.' : undefined}
                >
                  <Input
                    name="adminPassword"
                    type="password"
                    required={!health.setupRequired}
                    minLength={health.setupRequired ? 10 : undefined}
                    autoComplete={health.setupRequired ? 'new-password' : 'current-password'}
                  />
                </Field>
              )}

              {health.setupRequired && (
                <Field
                  label="Viewer access password"
                  optional
                  hint="Leave blank to allow devices to browse sources without a password."
                >
                  <Input name="viewerPassword" type="password" minLength={10} autoComplete="new-password" />
                </Field>
              )}

              <Button disabled={busy} className="mt-2 w-full">
                {busy ? 'Authenticating…' : health.setupRequired ? 'Complete setup' : 'Sign in'}
              </Button>
            </form>
          </div>
        </div>

        <footer className="relative z-10 py-6 text-center text-xs text-muted-foreground">
          Source availability depends on your host, extension, and upstream service.
        </footer>
      </div>
    );
  }

  /* ------------------------------------------------------------------------ */
  /*                         Authenticated Workspace                          */
  /* ------------------------------------------------------------------------ */

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50/40 dark:bg-zinc-950 text-foreground antialiased">
      {/* Floating Toast Notifications */}
      {(error || notice) && (
        <div className="fixed bottom-5 right-5 z-50 flex max-w-sm flex-col gap-2">
          {error && (
            <div
              role="alert"
              className="flex items-start justify-between gap-3 rounded-lg border border-destructive/40 bg-background/95 px-4 py-3 text-xs text-destructive shadow-lg backdrop-blur"
            >
              <div className="leading-relaxed">
                <p className="font-semibold">Request failed</p>
                <p className="mt-0.5 opacity-90">{error}</p>
              </div>
              <button type="button" onClick={() => setError('')} className="mt-0.5 opacity-70 hover:opacity-100">
                <Icon.X />
              </button>
            </div>
          )}
          {notice && (
            <div
              role="status"
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-foreground px-4 py-2.5 text-xs font-medium text-background shadow-lg"
            >
              <span className="flex items-center gap-2">
                <Icon.Check />
                {notice}
              </span>
              <button type="button" onClick={() => setNotice('')} className="opacity-70 hover:opacity-100">
                <Icon.X />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Top Sticky Header & Navigation */}
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 pt-3.5 pb-2.5 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
              <Icon.Logo />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-sm font-semibold tracking-tight">
                  {config?.name || 'Tatakai Server'}
                </h1>
                {health && (
                  <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-muted/40 px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    {health.platform} · v{health.protocolVersion}
                  </span>
                )}
              </div>
              <p className="truncate text-xs text-muted-foreground">Extension & media source host</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={() => {
                setActiveTab('devices');
                if (!pair) {
                  void action(async () => {
                    setPair((await api('/auth/pairing', 'POST', {})).url);
                  }, 'Pairing link expires in five minutes');
                }
              }}
            >
              <Icon.Qr />
              <span className="hidden sm:inline">Pair App</span>
            </Button>

            <Button
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={() =>
                void action(async () => {
                  await api('/auth/logout', 'POST', {});
                  sessionStorage.removeItem('tatakai-server-owner');
                  setToken('');
                }, 'Signed out')
              }
            >
              <Icon.LogOut />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>

        {/* Workspace Navigation Bar */}
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 sm:px-8" aria-label="Workspace">
          {(
            [
              { key: 'sources', label: 'Sources', icon: Icon.Layers, count: extensions.length },
              { key: 'playground', label: 'Playground', icon: Icon.Terminal },
              { key: 'devices', label: 'Devices & Pairing', icon: Icon.Devices, count: devices.length },
              { key: 'settings', label: 'System & Settings', icon: Icon.Sliders },
              { key: 'logs', label: 'Live Logs', icon: Icon.Terminal },
            ] as const
          ).map(item => {
            const ActiveIcon = item.icon;
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveTab(item.key)}
                className={`relative flex shrink-0 items-center gap-2 px-3 py-2.5 text-xs font-medium transition-colors ${
                  active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <ActiveIcon />
                <span>{item.label}</span>
                {'count' in item && item.count !== undefined && (
                  <span
                    className={`rounded-full px-1.5 py-0.2 font-mono text-[10px] tabular-nums ${
                      active ? 'bg-foreground/10 text-foreground' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {item.count}
                  </span>
                )}
                {active && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-foreground" />}
              </button>
            );
          })}
        </nav>
      </header>

      {/* Main Content Container */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8">
        {!config ? (
          <div className="py-16 text-center text-xs text-muted-foreground" role="status">
            Loading server configuration…
          </div>
        ) : (
          <>
            {activeTab === 'logs' && <section className="space-y-4" aria-labelledby="live-logs-title">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h2 id="live-logs-title" className="text-sm font-semibold">Live server logs</h2><p className="mt-1 text-xs text-muted-foreground">{logsPaused ? 'Paused' : 'Updates every 2 seconds'} · Last 200 events · Passwords, tokens and provider URLs are excluded.</p></div>
                <Button variant="outline" size="sm" onClick={() => setLogsPaused(value => !value)}>{logsPaused ? 'Resume logs' : 'Pause logs'}</Button>
              </div>
              {logError && <p role="alert" className="text-sm text-destructive">{logError}</p>}
              <div role="log" aria-label="Server activity" aria-live="off" tabIndex={0} className="max-h-[65vh] overflow-auto rounded-xl border border-border bg-muted/20 p-4 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {!logs.length && <p className="text-muted-foreground">No events yet. Install or test a source to see activity here.</p>}
                {logs.map(row => <div key={row.id} className="flex flex-wrap gap-x-3 gap-y-1 border-b border-border/40 py-2 last:border-0">
                  <time dateTime={row.at} className="text-muted-foreground">{new Date(row.at).toLocaleTimeString()}</time>
                  <span className={row.level === 'error' ? 'text-destructive' : 'text-foreground'}>{row.event.replaceAll('_', ' ')}</span>
                  <span>{[row.method, row.route, row.name, row.status].filter(Boolean).join(' ')}</span>
                  <span className="text-muted-foreground">{row.durationMs} ms{row.count !== undefined ? ` · ${row.count} sources` : ''}</span>
                </div>)}
              </div>
            </section>}
            {/* ============================================================== */}
            {/*                         TAB 1: SOURCES                         */}
            {/* ============================================================== */}
            {activeTab === 'sources' && (
              <div className="flex flex-col gap-6">
                {/* Sub-navigation + Runtime context */}
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                  <div className="inline-flex self-start rounded-lg border border-border/80 bg-muted/40 p-1">
                    <button
                      type="button"
                      onClick={() => setSourceSubTab('installed')}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                        sourceSubTab === 'installed'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Installed ({extensions.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setSourceSubTab('repositories')}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                        sourceSubTab === 'repositories'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Repositories ({repositories.length})
                    </button>
                    {supportsNative && (
                      <button
                        type="button"
                        onClick={() => setSourceSubTab('native')}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                          sourceSubTab === 'native'
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        Native Bridge
                      </button>
                    )}
                  </div>
                </div>

                {/* ---------------- Sub-view: Installed Sources ---------------- */}
                {sourceSubTab === 'installed' && (
                  <div className="flex flex-col gap-6">
                    {/* Sleek Install Surface */}
                    <div className="rounded-xl border border-border/80 bg-card shadow-xs">
                      <div className="flex flex-col justify-between gap-3 border-b border-border/60 px-5 py-3.5 sm:flex-row sm:items-center">
                        <div>
                          <h2 className="text-sm font-semibold">Add Extension</h2>
                          <p className="text-xs text-muted-foreground">
                            Install from a remote manifest URL or upload a local <code className="font-mono">.kai</code> / <code className="font-mono">.js</code> package.
                          </p>
                        </div>
                        <div className="inline-flex self-start rounded-md border border-border/80 bg-muted/30 p-0.5 text-xs">
                          <button
                            type="button"
                            onClick={() => setInstallMode('url')}
                            className={`rounded px-2.5 py-1 font-medium transition-colors ${
                              installMode === 'url' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground'
                            }`}
                          >
                            Manifest URL
                          </button>
                          <button
                            type="button"
                            onClick={() => setInstallMode('file')}
                            className={`rounded px-2.5 py-1 font-medium transition-colors ${
                              installMode === 'file' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground'
                            }`}
                          >
                            Upload File
                          </button>
                        </div>
                      </div>

                      <div className="p-5 space-y-4">
                        {installMode === 'url' ? (
                          <form
                            className="flex flex-col gap-3 sm:flex-row sm:items-end"
                            onSubmit={event => {
                              const input = form(event);
                              const formEl = event.currentTarget;
                              void action(async () => {
                                await api('/extensions', 'POST', {
                                  url: input.url,
                                  runtime: trustedNode ? 'node' : 'interpreter',
                                });
                                formEl.reset();
                              }, 'Extension installed');
                            }}
                          >
                            <Field label="Manifest Endpoint" className="flex-1">
                              <Input
                                name="url"
                                type="url"
                                placeholder="https://addon.example.com/manifest.json"
                                required
                                className="font-mono text-xs"
                              />
                            </Field>
                            <Button disabled={busy} className="sm:w-auto">
                              Install Source
                            </Button>
                          </form>
                        ) : (
                          <form
                            className="flex flex-col gap-4"
                            onSubmit={event => {
                              event.preventDefault();
                              const formEl = event.currentTarget;
                              const data = new FormData(formEl);
                              void action(async () => {
                                const file = data.get('package') as File;
                                const manifestFile = data.get('manifest') as File;
                                if (file.name.endsWith('.kai')) {
                                  const JSZip = (await import('jszip')).default;
                                  if (file.size > 3 * 1024 * 1024) throw Error('Package exceeds 3 MB');
                                  const archive = await JSZip.loadAsync(file);
                                  const mFile = archive.file('manifest.json');
                                  if (!mFile) throw Error('Package has no manifest');
                                  const manifest = JSON.parse(await mFile.async('text'));
                                  const bundle = archive.file('dist/bundle.js') || archive.file('bundle.js');
                                  if (!bundle) throw Error('Package has no bundle');
                                  const existing = extensions.find(item => item.manifestId === manifest.id);
                                  await api(
                                    existing ? '/extensions/' + existing.id + '/update' : '/extensions',
                                    'POST',
                                    {
                                      manifest,
                                      code: await bundle.async('text'),
                                      runtime: trustedNode ? 'node' : 'interpreter',
                                    }
                                  );
                                } else {
                                  if (!manifestFile || !manifestFile.size) {
                                    throw Error('Manifest JSON is required when uploading a raw .js script');
                                  }
                                  await api('/extensions', 'POST', {
                                    manifest: JSON.parse(await manifestFile.text()),
                                    code: await file.text(),
                                    runtime: trustedNode ? 'node' : 'interpreter',
                                  });
                                }
                                formEl.reset();
                                setSelectedPkgName('');
                                setSelectedManifestName('');
                              }, 'Extension installed');
                            }}
                          >
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                              <Field
                                label="Package (.kai) or Script (.js)"
                                hint={selectedPkgName ? `Selected: ${selectedPkgName}` : 'Max 3 MB for .kai bundles.'}
                              >
                                <Input
                                  name="package"
                                  type="file"
                                  accept=".js,.kai"
                                  required
                                  className="cursor-pointer text-xs"
                                  onChange={e => setSelectedPkgName(e.target.files?.[0]?.name || '')}
                                />
                              </Field>

                              <Field
                                label="Manifest JSON"
                                optional={isKaiSelected}
                                hint={
                                  isKaiSelected
                                    ? 'Bundled inside .kai archive automatically.'
                                    : selectedManifestName
                                    ? `Selected: ${selectedManifestName}`
                                    : 'Required only for standalone .js files.'
                                }
                              >
                                <Input
                                  name="manifest"
                                  type="file"
                                  accept=".json"
                                  disabled={isKaiSelected}
                                  className="cursor-pointer text-xs"
                                  onChange={e => setSelectedManifestName(e.target.files?.[0]?.name || '')}
                                />
                              </Field>
                            </div>
                            <div className="flex justify-end">
                              <Button disabled={busy}>Upload & Install</Button>
                            </div>
                          </form>
                        )}

                        {supportsNative && (
                          <div
                            className={`flex items-center justify-between gap-4 rounded-lg border px-4 py-3 text-xs transition-colors ${
                              trustedNode
                                ? 'border-amber-500/40 bg-amber-500/5'
                                : 'border-border/60 bg-muted/20'
                            }`}
                          >
                            <div className="flex items-start gap-2.5">
                              <span className={trustedNode ? 'mt-0.5 text-amber-600 dark:text-amber-400' : 'mt-0.5 text-muted-foreground'}>
                                <Icon.ShieldAlert />
                              </span>
                              <div>
                                <p className="font-medium text-foreground">
                                  Execute with Trusted Node Runtime
                                  <span className="ml-2 font-mono text-[10px] uppercase text-muted-foreground">
                                    {trustedNode ? 'Unisolated' : 'Sandboxed Interpreter'}
                                  </span>
                                </p>
                                <p className="mt-0.5 text-muted-foreground">
                                  Required for native Node bundles (e.g. Toko). Grants full filesystem and network access on this host.
                                </p>
                              </div>
                            </div>
                            <Switch checked={trustedNode} onChange={setTrustedNode} />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Installed Sources Resource List */}
                    <div className="rounded-xl border border-border/80 bg-card shadow-xs overflow-hidden">
                      <div className="flex items-center justify-between border-b border-border/60 px-5 py-3.5">
                        <h2 className="text-sm font-semibold">Installed Sources</h2>
                        <span className="font-mono text-xs text-muted-foreground tabular-nums">
                          {extensions.filter(e => e.enabled).length} active / {extensions.length} total
                        </span>
                      </div>

                      {extensions.length === 0 ? (
                        <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
                          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                            <Icon.Layers />
                          </div>
                          <p className="text-sm font-medium">No sources installed</p>
                          <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                            Paste an addon manifest URL or upload a package above to begin serving content to your devices.
                          </p>
                        </div>
                      ) : (
                        <div className="divide-y divide-border/60">
                          {extensions.map(row => {
                            const isExpanded = expandedExtId === row.id;
                            return (
                              <div key={row.id} className="transition-colors">
                                <div className="flex flex-col justify-between gap-4 px-5 py-4 sm:flex-row sm:items-center hover:bg-muted/20">
                                  <div className="flex items-start gap-3.5 min-w-0">
                                    <span
                                      title={row.enabled ? 'Enabled' : 'Disabled'}
                                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                                        row.enabled ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-700'
                                      }`}
                                    />
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="truncate text-sm font-medium text-foreground">
                                          {row.name}
                                        </span>
                                        <span className="font-mono text-xs text-muted-foreground tabular-nums">
                                          v{row.version}
                                        </span>
                                      </div>

                                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                                        <Badge variant="secondary" className="h-4.5 px-1.5 font-mono text-[10px] uppercase">
                                          {row.ecosystem}
                                        </Badge>
                                        <Badge variant="outline" className="h-4.5 px-1.5 font-mono text-[10px]">
                                          {row.runtime === 'node' ? 'node' : 'interpreter'}
                                        </Badge>
                                        {row.languages?.length > 0 && (
                                          <span className="font-mono text-[11px] text-muted-foreground">
                                            · {row.languages.join(', ')}
                                          </span>
                                        )}
                                        {row.priority !== 0 && (
                                          <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                                            · priority {row.priority > 0 ? `+${row.priority}` : row.priority}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                                      onClick={() => {
                                        setPlaygroundExtId(row.id);
                                        setActiveTab('playground');
                                      }}
                                    >
                                      <Icon.Play />
                                      Test
                                    </Button>

                                    <Button
                                      size="sm"
                                      variant={isExpanded ? 'secondary' : 'outline'}
                                      className="h-8 px-2.5 text-xs"
                                      onClick={() => void toggleConfigureSource(row.id)}
                                    >
                                      Configure
                                    </Button>

                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-8 px-2.5 text-xs"
                                      disabled={busy}
                                      onClick={() =>
                                        void action(async () => {
                                          await api('/extensions/' + row.id, 'PATCH', { enabled: !row.enabled });
                                        }, row.enabled ? 'Source disabled' : 'Source enabled')
                                      }
                                    >
                                      {row.enabled ? 'Disable' : 'Enable'}
                                    </Button>

                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      title="Update source"
                                      className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                                      disabled={busy}
                                      onClick={() =>
                                        void action(async () => {
                                          await api('/extensions/' + row.id + '/update', 'POST', {});
                                        }, 'Extension updated')
                                      }
                                    >
                                      <Icon.Refresh />
                                    </Button>

                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      title="Remove source"
                                      className="h-8 w-8 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                      disabled={busy}
                                      onClick={() =>
                                        void action(async () => {
                                          await api('/extensions/' + row.id, 'DELETE');
                                          if (expandedExtId === row.id) setExpandedExtId(null);
                                        }, 'Extension removed')
                                      }
                                    >
                                      <Icon.Trash />
                                    </Button>
                                  </div>
                                </div>

                                {/* Inline Configuration Drawer (Routing + Preferences) */}
                                {isExpanded && (
                                  <div className="grid grid-cols-1 gap-6 border-t border-border/60 bg-muted/25 px-5 py-5 lg:grid-cols-12">
                                    <form
                                      className="flex flex-col gap-4 lg:col-span-5"
                                      onSubmit={event => {
                                        const input = form(event);
                                        void action(async () => {
                                          await api('/extensions/' + row.id, 'PATCH', {
                                            priority: Number(input.priority),
                                            autoResolve: input.autoResolve === 'on',
                                            languages: String(input.languages)
                                              .split(',')
                                              .map(v => v.trim())
                                              .filter(Boolean),
                                          });
                                        }, 'Routing updated');
                                      }}
                                    >
                                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                        Routing & Languages
                                      </p>
                                      <div className="grid grid-cols-2 gap-3">
                                        <Field label="Priority (-1000 to 1000)">
                                          <Input
                                            name="priority"
                                            type="number"
                                            min={-1000}
                                            max={1000}
                                            defaultValue={row.priority}
                                            className="h-9 text-xs tabular-nums"
                                          />
                                        </Field>
                                        <Field label="Languages">
                                          <Input
                                            name="languages"
                                            defaultValue={row.languages.join(', ')}
                                            placeholder="en, ja"
                                            className="h-9 font-mono text-xs"
                                          />
                                        </Field>
                                      </div>
                                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <input type="checkbox" name="autoResolve" defaultChecked={row.autoResolve !== false} />
                                        Include in automatic source lookup
                                      </label>
                                      <div>
                                        <Button size="sm" variant="secondary" disabled={busy}>
                                          Save Routing
                                        </Button>
                                      </div>
                                    </form>

                                    <form
                                      className="flex flex-col gap-3 lg:col-span-7"
                                      onSubmit={event => {
                                        event.preventDefault();
                                        if (!preference) return;
                                        void action(async () => {
                                          await api('/extensions/' + preference.id, 'PATCH', {
                                            preferences: JSON.parse(preference.text),
                                          });
                                        }, 'Preferences saved');
                                      }}
                                    >
                                      <div className="flex items-center justify-between">
                                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                          Preferences JSON
                                        </p>
                                        {preference && (
                                          <span
                                            className={`font-mono text-[10px] ${
                                              isPreferenceJsonValid
                                                ? 'text-emerald-600 dark:text-emerald-400'
                                                : 'text-destructive'
                                            }`}
                                          >
                                            {isPreferenceJsonValid ? 'Valid JSON' : 'Syntax error'}
                                          </span>
                                        )}
                                      </div>

                                      {!preference || preference.id !== row.id ? (
                                        <div className="flex h-28 items-center justify-center rounded-md border border-border/60 bg-background text-xs text-muted-foreground">
                                          Loading preferences…
                                        </div>
                                      ) : (
                                        <>
                                          <Textarea
                                            rows={5}
                                            value={preference.text}
                                            onChange={e => setPreference({ ...preference, text: e.target.value })}
                                            className="font-mono text-xs bg-background"
                                          />
                                          <div className="flex items-center gap-2">
                                            <Button size="sm" disabled={busy || !isPreferenceJsonValid}>
                                              Save Preferences
                                            </Button>
                                            <Button
                                              size="sm"
                                              type="button"
                                              variant="ghost"
                                              onClick={() => {
                                                setExpandedExtId(null);
                                                setPreference(undefined);
                                              }}
                                            >
                                              Close
                                            </Button>
                                          </div>
                                        </>
                                      )}
                                    </form>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ---------------- Sub-view: Repositories ---------------- */}
                {sourceSubTab === 'repositories' && (
                  <div className="flex flex-col gap-6">
                    <div className="rounded-xl border border-border/80 bg-card p-5 shadow-xs">
                      <form
                        className="flex flex-col gap-3 sm:flex-row sm:items-end"
                        onSubmit={event => {
                          const input = form(event);
                          const formEl = event.currentTarget;
                          void action(async () => {
                            await api('/repositories', 'POST', input);
                            formEl.reset();
                          }, 'Repository added');
                        }}
                      >
                        <Field
                          label="Repository Catalog URL"
                          className="flex-1"
                        >
                          <Input
                            type="url"
                            name="url"
                            placeholder="https://repo.example.com/index.json"
                            required
                            className="font-mono text-xs"
                          />
                        </Field>
                        <Button disabled={busy}>Add Repository</Button>
                      </form>
                    </div>

                    <div className="rounded-xl border border-border/80 bg-card shadow-xs overflow-hidden">
                      <div className="border-b border-border/60 px-5 py-3.5">
                        <h2 className="text-sm font-semibold">Configured Repositories</h2>
                      </div>
                      {repositories.length === 0 ? (
                        <p className="px-5 py-10 text-center text-xs text-muted-foreground">
                          No external repositories added yet.
                        </p>
                      ) : (
                        <div className="divide-y divide-border/60">
                          {repositories.map(repo => (
                            <div
                              key={repo.id}
                              className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-muted/20"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">{repo.name}</p>
                                {repo.url && (
                                  <p className="truncate font-mono text-xs text-muted-foreground">{repo.url}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 text-xs"
                                  disabled={busy}
                                  onClick={() =>
                                    void action(async () => {
                                      const data = await api('/repositories/' + repo.id + '/catalog');
                                      setCatalogPreview({ repoName: repo.name, data });
                                    }, 'Catalog loaded')
                                  }
                                >
                                  Inspect Catalog
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 w-8 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                  disabled={busy}
                                  onClick={() =>
                                    void action(async () => {
                                      await api('/repositories/' + repo.id, 'DELETE');
                                      if (catalogPreview?.repoName === repo.name) setCatalogPreview(null);
                                    }, 'Repository removed')
                                  }
                                >
                                  <Icon.Trash />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {catalogPreview && (
                      <div className="rounded-xl border border-border/80 bg-zinc-950 text-zinc-100 overflow-hidden">
                        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5 text-xs">
                          <span className="font-mono text-zinc-400">
                            Catalog: <strong className="text-zinc-100">{catalogPreview.repoName}</strong>
                          </span>
                          <button
                            type="button"
                            onClick={() => setCatalogPreview(null)}
                            className="text-zinc-400 hover:text-zinc-100"
                          >
                            <Icon.X />
                          </button>
                        </div>
                        <pre className="max-h-80 overflow-auto p-4 font-mono text-xs leading-relaxed text-zinc-300">
                          {JSON.stringify(catalogPreview.data, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}

                {/* ---------------- Sub-view: Native Bridge ---------------- */}
                {sourceSubTab === 'native' && supportsNative && (
                  <div className="flex flex-col gap-6">
                    <div className="rounded-xl border border-border/80 bg-card p-5 shadow-xs space-y-5">
                      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                        <div>
                          <h2 className="text-sm font-semibold">JVM / Native Ecosystem Host</h2>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Requires optional Java runtime. Downloads pinned host bridges for Android/JVM extension ecosystems.
                          </p>
                        </div>

                        <div className="inline-flex self-start rounded-lg border border-border/80 bg-muted/30 p-0.5 text-xs">
                          {(['mihon', 'cloudstream', 'aniyomi'] as const).map(family => (
                            <button
                              key={family}
                              type="button"
                              onClick={() => {
                                setNativeFamily(family);
                                setNativePackages([]);
                                setNativeSources([]);
                              }}
                              className={`rounded-md px-3 py-1.5 font-medium capitalize transition-colors ${
                                nativeFamily === family
                                  ? 'bg-background text-foreground shadow-xs'
                                  : 'text-muted-foreground hover:text-foreground'
                              }`}
                            >
                              {family}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 border-t border-border/60 pt-4">
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void action(async () => {
                              await api('/native', 'POST', { op: 'prepare', ecosystem: nativeFamily });
                            }, 'Runtime prepared')
                          }
                        >
                          Prepare Runtime
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void action(async () => {
                              setNativePackages(
                                await api('/native', 'POST', { op: 'packages', ecosystem: nativeFamily })
                              );
                            }, 'Package catalog loaded')
                          }
                        >
                          Browse Packages
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void action(async () => {
                              setNativeSources(
                                await api('/native', 'POST', { op: 'sources', ecosystem: nativeFamily })
                              );
                            }, 'Sources loaded')
                          }
                        >
                          Loaded Sources
                        </Button>
                      </div>

                      <form
                        className="flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-end"
                        onSubmit={event => {
                          const input = form(event);
                          const formEl = event.currentTarget;
                          void action(async () => {
                            await api('/native', 'POST', {
                              op: 'addRepository',
                              ecosystem: nativeFamily,
                              url: input.url,
                            });
                            formEl.reset();
                          }, 'Native repository added');
                        }}
                      >
                        <Field label={`Add ${nativeFamily} repository URL`} className="flex-1">
                          <Input type="url" name="url" required placeholder="https://..." className="font-mono text-xs" />
                        </Field>
                        <Button variant="secondary" disabled={busy}>
                          Add Repo
                        </Button>
                      </form>
                    </div>

                    {nativePackages.length > 0 && (
                      <div className="rounded-xl border border-border/80 bg-card shadow-xs overflow-hidden">
                        <div className="flex flex-col gap-3 border-b border-border/60 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                          <h3 className="text-sm font-semibold">Available Packages</h3>
                          <Input
                            value={nativeFilter}
                            onChange={e => setNativeFilter(e.target.value)}
                            placeholder="Filter packages…"
                            className="h-8 text-xs sm:w-64"
                          />
                        </div>
                        <div className="max-h-80 divide-y divide-border/60 overflow-y-auto">
                          {nativePackages
                            .filter(item => item.name.toLowerCase().includes(nativeFilter.toLowerCase()))
                            .slice(0, 100)
                            .map(item => (
                              <div key={item.id} className="flex items-center justify-between px-5 py-2.5 text-xs">
                                <div>
                                  <span className="font-medium text-foreground">{item.name}</span>
                                  <span className="ml-2 font-mono text-muted-foreground">v{item.version}</span>
                                </div>
                                <Button
                                  size="sm"
                                  variant={item.installed ? 'secondary' : 'outline'}
                                  className="h-7 text-xs"
                                  disabled={busy}
                                  onClick={() =>
                                    void action(async () => {
                                      await api('/native', 'POST', {
                                        op: item.installed ? 'remove' : 'install',
                                        ecosystem: nativeFamily,
                                        packageId: item.id,
                                        repository: item.repository,
                                      });
                                      setNativePackages(
                                        await api('/native', 'POST', { op: 'packages', ecosystem: nativeFamily })
                                      );
                                    }, 'Package updated')
                                  }
                                >
                                  {item.installed ? 'Remove' : 'Install'}
                                </Button>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                    {nativeSources.length > 0 && (
                      <div className="rounded-xl border border-border/80 bg-card shadow-xs overflow-hidden">
                        <div className="border-b border-border/60 px-5 py-3.5">
                          <h3 className="text-sm font-semibold">Active Native Sources</h3>
                        </div>
                        <div className="max-h-80 divide-y divide-border/60 overflow-y-auto">
                          {nativeSources.map(item => (
                            <div key={item.id} className="flex items-center justify-between px-5 py-2.5 text-xs">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-foreground">{item.name}</span>
                                <Badge variant="outline" className="h-4.5 px-1.5 font-mono text-[10px]">
                                  {item.lang}
                                </Badge>
                              </div>
                              <Button
                                size="sm"
                                variant={item.enabled ? 'secondary' : 'outline'}
                                className="h-7 text-xs"
                                disabled={busy}
                                onClick={() =>
                                  void action(async () => {
                                    await api('/native', 'POST', {
                                      op: 'setEnabled',
                                      ecosystem: nativeFamily,
                                      sourceId: item.id,
                                      enabled: !item.enabled,
                                    });
                                    setNativeSources(
                                      await api('/native', 'POST', { op: 'sources', ecosystem: nativeFamily })
                                    );
                                  })
                                }
                              >
                                {item.enabled ? 'Disable' : 'Enable'}
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ============================================================== */}
            {/*                        TAB 2: PLAYGROUND                       */}
            {/* ============================================================== */}
            {activeTab === 'playground' && (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="lg:col-span-5">
                  <div className="rounded-xl border border-border/80 bg-card p-5 shadow-xs">
                    <div className="mb-5">
                      <h2 className="text-sm font-semibold">Source Invocation</h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Send a live query against an installed source to verify resolution and stream payloads.
                      </p>
                    </div>

                    {extensions.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border p-6 text-center">
                        <p className="text-xs text-muted-foreground">Install at least one extension before running tests.</p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-3 text-xs"
                          onClick={() => setActiveTab('sources')}
                        >
                          Go to Sources
                        </Button>
                      </div>
                    ) : (
                      <form
                        className="flex flex-col gap-4"
                        onSubmit={event => {
                          const input = form(event);
                          void action(async () => {
                            const started = performance.now();
                            const sourceId = health!.serverId + '/' + input.extension;
                            const installed = extensions.find(item => item.id === input.extension);
                            const op =
                              input.op === 'auto'
                                ? installed?.ecosystem === 'tatakai'
                                  ? 'resolve'
                                  : 'search'
                                : String(input.op);
                            const args = {
                              query: input.query,
                              title: input.query,
                              anilistId: input.anilistId ? Number(input.anilistId) : undefined,
                              episode: Number(input.episode) || 1,
                            };
                            const res = await api('/invoke', 'POST', { sourceId, op, args });
                            setTestLatencyMs(Math.round(performance.now() - started));
                            setTestResult(JSON.stringify(res, null, 2));
                          }, 'Invocation complete');
                        }}
                      >
                        <Field label="Target Extension">
                          <Select
                            name="extension"
                            required
                            value={playgroundExtId}
                            onChange={e => setPlaygroundExtId(e.target.value)}
                          >
                            {extensions.map(row => (
                              <option key={row.id} value={row.id}>
                                {row.name} ({row.ecosystem})
                              </option>
                            ))}
                          </Select>
                        </Field>

                        <Field label="Operation">
                          <Select name="op" defaultValue="auto">
                            <option value="auto">Automatic (ecosystem default)</option>
                            <option value="search">Search catalog</option>
                            <option value="resolve">Resolve streams</option>
                            <option value="chapters">Fetch chapters</option>
                          </Select>
                        </Field>

                        <Field label="Title / Search Query">
                          <Input name="query" placeholder="e.g. Frieren" required />
                        </Field>

                        <div className="grid grid-cols-2 gap-3">
                          <Field label="AniList ID" optional>
                            <Input name="anilistId" type="number" min={1} placeholder="154587" className="tabular-nums" />
                          </Field>
                          <Field label="Episode">
                            <Input name="episode" type="number" min={1} defaultValue={1} className="tabular-nums" />
                          </Field>
                        </div>

                        <Button disabled={busy} className="mt-1 w-full gap-2">
                          <Icon.Play />
                          {busy ? 'Executing…' : 'Run Invocation'}
                        </Button>
                      </form>
                    )}
                  </div>
                </div>

                <div className="lg:col-span-7 flex flex-col">
                  <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-100 shadow-xs min-h-[380px]">
                    <div className="flex items-center justify-between border-b border-zinc-800/80 px-4 py-2.5 text-xs">
                      <div className="flex items-center gap-2.5">
                        <span className="font-mono text-zinc-400">Response Payload</span>
                        {testLatencyMs !== null && (
                          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[11px] text-emerald-400 tabular-nums">
                            200 OK · {testLatencyMs} ms
                          </span>
                        )}
                      </div>
                      {testResult && (
                        <button
                          type="button"
                          onClick={() => void copyText('test', testResult)}
                          className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 transition-colors"
                        >
                          {copiedKey === 'test' ? <Icon.Check /> : <Icon.Copy />}
                          <span>{copiedKey === 'test' ? 'Copied' : 'Copy JSON'}</span>
                        </button>
                      )}
                    </div>

                    {testResult ? (
                      <pre className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed text-zinc-200">
                        {testResult}
                      </pre>
                    ) : (
                      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-zinc-500">
                        <Icon.Terminal />
                        <p className="mt-2 text-xs">Run an invocation to inspect the JSON payload here.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ============================================================== */}
            {/*                    TAB 3: DEVICES & PAIRING                    */}
            {/* ============================================================== */}
            {activeTab === 'devices' && (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                {/* Pairing Card */}
                <div className="lg:col-span-5">
                  <div className="rounded-xl border border-border/80 bg-card p-5 shadow-xs space-y-5">
                    <div>
                      <h2 className="text-sm font-semibold">Link a Tatakai App</h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Connect Tatakai web, mobile or desktop using your server URL or a one-time pairing QR code.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-foreground/90">Server Origin</Label>
                      <div className="flex items-center gap-2">
                        <Input readOnly value={location.origin} className="font-mono text-xs bg-muted/30" />
                        <Button
                          type="button"
                          variant="outline"
                          className="shrink-0 gap-1.5 text-xs"
                          onClick={() => void copyText('origin', location.origin)}
                        >
                          {copiedKey === 'origin' ? <Icon.Check /> : <Icon.Copy />}
                          {copiedKey === 'origin' ? 'Copied' : 'Copy'}
                        </Button>
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground">In Tatakai, open Settings → Extension Hub → Extension Servers and set the extension API to the Server Origin above.</p>
                    <Button asChild variant="outline" className="w-full"><a href={`${location.protocol === 'http:' ? 'http://localhost:8090' : 'https://tatakai.app'}/extensionserver/${encodeURIComponent(location.origin)}`} target="_blank" rel="noreferrer">Set extension API in Tatakai</a></Button>

                    <Button
                      disabled={busy}
                      className="w-full gap-2"
                      onClick={() =>
                        void action(async () => {
                          setPair((await api('/auth/pairing', 'POST', {})).url);
                        }, 'Pairing link expires in five minutes')
                      }
                    >
                      <Icon.Qr />
                      {pair ? 'Regenerate Pairing QR' : 'Generate Pairing QR'}
                    </Button>

                    {pair && (
                      <div className="flex flex-col items-center rounded-xl border border-border/80 bg-muted/20 p-6 text-center">
                        <div className="rounded-xl border border-zinc-200 bg-white p-3.5 shadow-xs">
                          <QRCodeSVG value={pair} size={176} />
                        </div>
                        <p className="mt-4 text-xs font-medium">Valid for 5 minutes</p>
                        <a
                          href={pair}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 max-w-full truncate font-mono text-[11px] text-muted-foreground underline hover:text-foreground"
                        >
                          {pair}
                        </a>
                      </div>
                    )}
                  </div>
                </div>

                {/* Active Sessions List */}
                <div className="lg:col-span-7">
                  <div className="rounded-xl border border-border/80 bg-card shadow-xs overflow-hidden">
                    <div className="flex items-center justify-between border-b border-border/60 px-5 py-3.5">
                      <div>
                        <h2 className="text-sm font-semibold">Authorized Sessions</h2>
                        <p className="text-xs text-muted-foreground">Devices holding valid access tokens.</p>
                      </div>
                      <span className="font-mono text-xs text-muted-foreground tabular-nums">
                        {devices.length} active
                      </span>
                    </div>

                    {devices.length === 0 ? (
                      <p className="px-5 py-12 text-center text-xs text-muted-foreground">
                        No active device sessions.
                      </p>
                    ) : (
                      <div className="divide-y divide-border/60">
                        {devices.map(device => (
                          <div
                            key={device.id}
                            className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-muted/20"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-sm font-medium">{device.label}</span>
                                {device.current && (
                                  <Badge variant="secondary" className="h-4.5 px-1.5 text-[10px]">
                                    Current
                                  </Badge>
                                )}
                              </div>
                              <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                                {device.role}
                              </p>
                            </div>

                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              disabled={busy}
                              onClick={() =>
                                void action(async () => {
                                  await api('/devices/' + device.id, 'DELETE');
                                  if (device.current) {
                                    sessionStorage.removeItem('tatakai-server-owner');
                                    setToken('');
                                  }
                                }, 'Device revoked')
                              }
                            >
                              Revoke
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ============================================================== */}
            {/*                   TAB 4: SYSTEM & SETTINGS                     */}
            {/* ============================================================== */}
            {activeTab === 'settings' && health && (
              <div className="divide-y divide-border/70">
                {/* 1. Identity */}
                <SettingsSection
                  title="Server Identity"
                  description="Display metadata and default language preferences advertised to connected Tatakai clients."
                >
                  <form
                    className="rounded-xl border border-border/80 bg-card p-5 shadow-xs space-y-4"
                    onSubmit={event => {
                      const input = form(event);
                      void action(async () => {
                        await api('/settings', 'PATCH', {
                          name: input.name,
                          logoUrl: input.logoUrl,
                          languages: String(input.languages)
                            .split(',')
                            .map(v => v.trim())
                            .filter(Boolean),
                        });
                      });
                    }}
                  >
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Field label="Server Name">
                        <Input name="name" defaultValue={config.name} required />
                      </Field>
                      <Field label="Server Logo" hint="Public HTTPS image URL shown to connected clients.">
                        <Input name="logoUrl" type="url" defaultValue={config.logoUrl || ''} placeholder="https://your-server.example/logo.png" />
                      </Field>
                      <Field label="Preferred Languages" hint="Comma-separated ISO codes (e.g. ja, en).">
                        <Input
                          name="languages"
                          defaultValue={config.languages.join(', ')}
                          placeholder="ja, en"
                          className="font-mono text-xs"
                        />
                      </Field>
                    </div>
                    <div className="flex justify-end">
                      <Button size="sm" disabled={busy}>
                        Save Identity
                      </Button>
                    </div>
                  </form>
                </SettingsSection>

                {/* 2. Security & Passwords */}
                <SettingsSection
                  title="Access & Authentication"
                  description="Control whether viewers need a password and rotate owner credentials. Changing a password signs out affected sessions."
                >
                  <div className="rounded-xl border border-border/80 bg-card p-5 shadow-xs space-y-5">
                    <div className="grid grid-cols-2 gap-3 rounded-lg border border-border/60 bg-muted/20 p-3.5 text-xs">
                      <div>
                        <span className="text-muted-foreground">Viewer Mode</span>
                        <p className="mt-0.5 font-medium">
                          {health.accessPasswordRequired ? 'Password Protected' : 'Public Read Access'}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Owner Mode</span>
                        <p className="mt-0.5 font-medium">
                          {health.adminPasswordRequired ? 'Admin Password' : 'Deployment Bootstrap Key'}
                        </p>
                      </div>
                    </div>

                    <form
                      className="space-y-4"
                      onSubmit={event => {
                        const input = form(event);
                        const formEl = event.currentTarget;
                        void action(async () => {
                          await api('/auth/password', 'POST', input);
                          formEl.reset();
                        }, 'Password updated; other affected devices were signed out');
                      }}
                    >
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Target Role">
                          <Select name="role" defaultValue="viewer">
                            <option value="viewer">Viewer access</option>
                            <option value="admin">Admin owner</option>
                          </Select>
                        </Field>

                        {health.adminPasswordRequired && (
                          <Field label="Current Admin Password">
                            <Input
                              name="currentPassword"
                              type="password"
                              autoComplete="current-password"
                              required
                            />
                          </Field>
                        )}

                        <Field
                          label="New Password"
                          optional
                          hint="Min 10 chars. Leave blank to remove password protection."
                          className={health.adminPasswordRequired ? 'sm:col-span-2' : ''}
                        >
                          <Input name="password" type="password" autoComplete="new-password" minLength={10} />
                        </Field>
                      </div>

                      <div className="flex justify-end">
                        <Button size="sm" variant="secondary" disabled={busy}>
                          Update Password
                        </Button>
                      </div>
                    </form>
                  </div>
                </SettingsSection>

                {/* 3. Engine, Proxy & Limits */}
                <SettingsSection
                  title="Engine, Caching & Proxy"
                  description="Fine-tune source execution timeouts, concurrency limits, CORS origins, and the built-in stream/image proxy."
                >
                  <form
                    className="rounded-xl border border-border/80 bg-card p-5 shadow-xs space-y-5"
                    onSubmit={event => {
                      const input = form(event);
                      void action(async () => {
                        await api('/settings', 'PATCH', {
                          timeoutMs: Number(input.timeoutMs),
                          concurrency: Number(input.concurrency),
                          cacheSeconds: Number(input.cacheSeconds),
                          mediaCacheMb: Number(input.mediaCacheMb),
                          mediaCacheSeconds: Number(input.mediaCacheSeconds),
                          allowedOrigins: String(input.origins)
                            .split('\n')
                            .map(v => v.trim())
                            .filter(Boolean),
                          proxyEnabled: input.proxy === 'on',
                        });
                      });
                    }}
                  >
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <Field label="Timeout (ms)" hint="1000 – 25000">
                        <Input
                          name="timeoutMs"
                          type="number"
                          min={1000}
                          max={25000}
                          defaultValue={config.timeoutMs}
                          className="tabular-nums"
                        />
                      </Field>
                      <Field label="Concurrency" hint="1 – 8 workers">
                        <Input
                          name="concurrency"
                          type="number"
                          min={1}
                          max={8}
                          defaultValue={config.concurrency}
                          className="tabular-nums"
                        />
                      </Field>
                      <Field label="Lookup TTL (s)" hint="0 disables">
                        <Input
                          name="cacheSeconds"
                          type="number"
                          min={0}
                          max={3600}
                          defaultValue={config.cacheSeconds}
                          className="tabular-nums"
                        />
                      </Field>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Field label="Media Cache Limit (MB)" hint="0 – 64 MB">
                        <Input
                          name="mediaCacheMb"
                          type="number"
                          min={0}
                          max={64}
                          defaultValue={config.mediaCacheMb ?? 32}
                          className="tabular-nums"
                        />
                      </Field>
                      <Field label="Media Cache TTL (s)" hint="30 – 3600 seconds">
                        <Input
                          name="mediaCacheSeconds"
                          type="number"
                          min={30}
                          max={3600}
                          defaultValue={config.mediaCacheSeconds ?? 300}
                          className="tabular-nums"
                        />
                      </Field>
                    </div>

                    <Field label="Allowed CORS Origins" hint="One origin URL per line.">
                      <Textarea
                        name="origins"
                        rows={3}
                        defaultValue={config.allowedOrigins.join('\n')}
                        className="font-mono text-xs"
                      />
                    </Field>

                    <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
                      <div>
                        <p className="text-xs font-medium">Built-in Media Proxy</p>
                        <p className="text-[11px] text-muted-foreground">
                          Relays images, subtitles, and segments with upstream headers when required by sources.
                        </p>
                      </div>
                      <Switch name="proxy" checked={proxyEnabled} onChange={setProxyEnabled} />
                    </div>

                    <div className="flex justify-end">
                      <Button size="sm" disabled={busy}>
                        Save Engine Settings
                      </Button>
                    </div>
                  </form>
                </SettingsSection>

                {/* 4. Cache Telemetry */}
                <SettingsSection
                  title="Cache Telemetry"
                  description="Extension responses are cached as encrypted JSON on disk and in memory. Playback results expire within two minutes; fresh media tickets are issued for each viewer. Live HLS playlists bypass cache."
                >
                  <div className="rounded-xl border border-border/80 bg-card p-5 shadow-xs space-y-4">
                    {cache && (
                      <>
                        <div className="grid grid-cols-3 gap-3 text-xs">
                          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                            <span className="text-muted-foreground">Cached JSON responses</span>
                            <p className="mt-1 font-mono text-base font-semibold tabular-nums">
                              {cache.lookupEntries + (cache.responseCache?.entries || 0)}
                            </p>
                          </div>
                          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                            <span className="text-muted-foreground">Media Objects</span>
                            <p className="mt-1 font-mono text-base font-semibold tabular-nums">
                              {cache.mediaEntries}
                            </p>
                          </div>
                          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                            <span className="text-muted-foreground">Memory Footprint</span>
                            <p className="mt-1 font-mono text-base font-semibold tabular-nums">
                              {(cache.mediaBytes / 1048576).toFixed(1)}{' '}
                              <span className="text-xs font-normal text-muted-foreground">
                                / {(cache.maxMediaBytes / 1048576).toFixed(0)} MB
                              </span>
                            </p>
                          </div>
                        </div>

                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full bg-foreground transition-all duration-300"
                            style={{ width: `${cacheUsagePercent}%` }}
                          />
                        </div>
                      </>
                    )}

                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            await api('/cache', 'DELETE');
                          }, 'Cache cleared')
                        }
                      >
                        Purge All Caches
                      </Button>
                    </div>
                  </div>
                </SettingsSection>

                {/* 5. Host Capabilities & Backup */}
                <SettingsSection
                  title="Capabilities & Portability"
                  description="Supported extension runtimes on this host and configuration backup tools (excludes secrets and tokens)."
                >
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="rounded-xl border border-border/80 bg-card p-5 shadow-xs space-y-3">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Ecosystem Runtimes
                      </h3>
                      <div className="divide-y divide-border/60">
                        {health.capabilities.map(item => (
                          <div key={item.ecosystem} className="py-2.5 first:pt-0 last:pb-0">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-mono font-medium uppercase">{item.ecosystem}</span>
                              <span
                                className={`inline-flex items-center gap-1.5 font-mono text-[11px] ${
                                  item.available ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'
                                }`}
                              >
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${
                                    item.available ? 'bg-emerald-500' : 'bg-zinc-400'
                                  }`}
                                />
                                {item.available ? 'Ready' : 'Unavailable'}
                              </span>
                            </div>
                            {!item.available && item.reason && (
                              <p className="mt-1 text-[11px] text-muted-foreground">{item.reason}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-xl border border-border/80 bg-card p-5 shadow-xs flex flex-col justify-between gap-4">
                      <div className="space-y-3">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Backup & Restore
                        </h3>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          Export your server preferences and repository definitions to JSON, or restore from a previous snapshot.
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full justify-center gap-2 text-xs"
                          disabled={busy}
                          onClick={() =>
                            void action(async () => {
                              const data = await api('/export');
                              const url = URL.createObjectURL(
                                new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                              );
                              const link = document.createElement('a');
                              link.href = url;
                              link.download = 'tatakai-server-settings.json';
                              link.click();
                              URL.revokeObjectURL(url);
                            }, 'Export excludes passwords, tokens, and provider credentials')
                          }
                        >
                          <Icon.Download />
                          Export Settings JSON
                        </Button>
                      </div>

                      <div className="border-t border-border/60 pt-4">
                        <Field label="Import Settings JSON">
                          <Input
                            type="file"
                            accept=".json"
                            className="cursor-pointer text-xs"
                            onChange={event => {
                              const file = event.target.files?.[0];
                              const inputEl = event.currentTarget;
                              if (file) {
                                void action(async () => {
                                  await api('/import', 'POST', JSON.parse(await file.text()));
                                  inputEl.value = '';
                                }, 'Settings imported');
                              }
                            }}
                          />
                        </Field>
                      </div>
                    </div>
                  </div>
                </SettingsSection>
              </div>
            )}
          </>
        )}
      </main>

      <footer className="mt-auto border-t border-border/60 py-6 text-center text-xs text-muted-foreground px-4">
        Source availability depends on your host, extension, and upstream service.
      </footer>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
