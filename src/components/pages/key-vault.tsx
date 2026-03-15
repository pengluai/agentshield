import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Plus, Copy, Trash2, AlertTriangle, Download, X, Check } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { cn } from '@/lib/utils';
import { MODULE_THEMES } from '@/constants/colors';
import { t } from '@/constants/i18n';
import { ModuleHeroPage } from '@/components/module-hero-page';
import { GlassmorphicCard } from '@/components/glassmorphic-card';
import { ProUpgradeBanner } from '@/components/pro-upgrade-banner';
import { useLicenseStore } from '@/stores/licenseStore';
import { requestRuntimeGuardActionApproval } from '@/services/runtime-guard';
import { isTauriEnvironment } from '@/services/tauri';
import type { ExposedKey } from '@/services/scanner';

const FREE_VAULT_KEY_LIMIT = 10;

/** Shape returned by the Rust `vault_*` commands */
interface VaultKeyInfo {
  id: string;
  name: string;
  service: string;
  masked_value: string;
  created_at: string;
  last_used: string | null;
  encrypted: boolean;
}

interface KeyVaultHomeProps {
  onViewKey?: (keyId: string) => void;
}

export function KeyVaultHome({ onViewKey }: KeyVaultHomeProps) {
  const theme = MODULE_THEMES.keyVault;

  return (
    <ModuleHeroPage
      moduleName={t.keyVault}
      description={t.keyVaultDesc}
      ctaText={t.manageKeys}
      ctaColor={theme.accent}
      gradient={{ from: theme.from, via: theme.via, to: theme.to }}
      onCtaClick={() => onViewKey?.('1')}
      icon={
        <div
          className="w-[200px] h-[200px] rounded-3xl flex items-center justify-center"
          style={{
            background: `linear-gradient(135deg, ${theme.accent}30 0%, ${theme.accent}10 100%)`,
            boxShadow: `0 0 60px ${theme.accent}30`,
          }}
        >
          <Lock className="w-24 h-24 text-amber-400" />
        </div>
      }
    />
  );
}

interface KeyVaultDetailProps {
  keyId: string;
  onBack: () => void;
}

export function KeyVaultDetail({ keyId, onBack }: KeyVaultDetailProps) {
  const [vaultKeys, setVaultKeys] = useState<VaultKeyInfo[]>([]);
  const [exposedKeys, setExposedKeys] = useState<ExposedKey[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const theme = MODULE_THEMES.keyVault;
  const unlimitedKeys = useLicenseStore((state) => state.checkFeature('unlimited_keys'));
  const atFreeLimit = !unlimitedKeys && vaultKeys.length >= FREE_VAULT_KEY_LIMIT;
  const browserShell = !isTauriEnvironment();
  const previewMessage = t.desktopOnlyInBrowserShell.replace('{feature}', t.moduleKeyVault);

  // Load vault keys and exposed keys on mount
  useEffect(() => {
    async function load() {
      if (browserShell) {
        setFeedback(previewMessage);
        return;
      }

      try {
        const [stored, exposed] = await Promise.all([
          invoke<VaultKeyInfo[]>('vault_list_keys'),
          invoke<ExposedKey[]>('vault_scan_exposed_keys'),
        ]);
        setVaultKeys(stored);
        setExposedKeys(exposed);
      } catch (e) {
        console.error('Failed to load vault data:', e);
      }
    }
    void load();
  }, []);

  const handleDeleteKey = useCallback(async (vaultKey: VaultKeyInfo) => {
    if (browserShell) {
      setFeedback(previewMessage);
      return;
    }

    try {
      const approval = await requestRuntimeGuardActionApproval({
        component_id: 'agentshield:key-vault',
        component_name: t.moduleKeyVault,
        platform_id: 'agentshield',
        platform_name: 'AgentShield',
        request_kind: 'credential_delete',
        trigger_event: 'key_vault_delete_request',
        action_kind: 'credential_delete',
        action_source: 'user_requested_key_delete',
        action_targets: [vaultKey.name],
        action_preview: [
          `目标密钥: ${vaultKey.name}`,
          `服务: ${vaultKey.service}`,
          '放行后会从 AgentShield 保险库与系统钥匙串中删除该密钥',
        ],
        sensitive_capabilities: ['导出密钥'],
        is_destructive: true,
        is_batch: false,
      });

      if (approval.status !== 'approved' || !approval.approval_ticket) {
        setFeedback('已弹出密钥删除审批。请先确认，再次点击删除。');
        return;
      }

      await invoke<boolean>('vault_delete_key', {
        keyId: vaultKey.id,
        approvalTicket: approval.approval_ticket,
      });
      setVaultKeys(prev => prev.filter(k => k.id !== vaultKey.id));
      setFeedback('密钥已删除');
    } catch (e) {
      console.error('Failed to delete key:', e);
      setFeedback(`删除失败：${String(e)}`);
    }
  }, [browserShell, previewMessage]);

  const handleCopyKey = useCallback(async (vaultKey: VaultKeyInfo) => {
    if (browserShell) {
      setFeedback(previewMessage);
      return false;
    }

    try {
      const approval = await requestRuntimeGuardActionApproval({
        component_id: 'agentshield:key-vault',
        component_name: t.moduleKeyVault,
        platform_id: 'agentshield',
        platform_name: 'AgentShield',
        request_kind: 'credential_export',
        trigger_event: 'key_vault_copy_request',
        action_kind: 'credential_export',
        action_source: 'user_requested_key_export',
        action_targets: [vaultKey.name],
        action_preview: [
          `目标密钥: ${vaultKey.name}`,
          `服务: ${vaultKey.service}`,
          '放行后会读取系统钥匙串中的明文并复制到剪贴板',
        ],
        sensitive_capabilities: ['导出密钥'],
        is_destructive: true,
        is_batch: false,
      });

      if (approval.status !== 'approved' || !approval.approval_ticket) {
        setFeedback('已弹出密钥导出审批。请先确认，再次点击复制。');
        return false;
      }

      const rawValue = await invoke<string>('vault_reveal_key_value', {
        keyId: vaultKey.id,
        approvalTicket: approval.approval_ticket,
      });
      await navigator.clipboard.writeText(rawValue);
      setFeedback(`已复制 ${vaultKey.name} 到剪贴板`);
      return true;
    } catch (error) {
      console.error('Failed to copy secret from vault:', error);
      setFeedback(`复制失败：${String(error)}`);
      return false;
    }
  }, [browserShell, previewMessage]);

  const handleImportKey = useCallback(async (id: string) => {
    if (browserShell) {
      setFeedback(previewMessage);
      return;
    }

    try {
      await invoke<boolean>('vault_import_exposed_key', { keyId: id });
      setExposedKeys(prev => prev.filter(k => k.id !== id));
      // Refresh vault keys to include the newly imported key
      const stored = await invoke<VaultKeyInfo[]>('vault_list_keys');
      setVaultKeys(stored);
      setFeedback('已导入密钥保险库');
    } catch (e) {
      console.error('Failed to import exposed key:', e);
      setFeedback(`导入失败：${String(e)}`);
    }
  }, []);

  const handleAddKey = useCallback(
    async (name: string, service: string, value: string) => {
      if (browserShell) {
        setFeedback(previewMessage);
        return;
      }

      try {
        const newKey = await invoke<VaultKeyInfo>('vault_add_key', { name, service, value });
        setVaultKeys(prev => [...prev, newKey]);
        setShowAddForm(false);
        setFeedback('密钥已安全保存到系统钥匙串');
      } catch (e) {
        console.error('Failed to add key:', e);
        setFeedback(`保存失败：${String(e)}`);
      }
    },
    [browserShell, previewMessage]
  );

  return (
    <div
      className="min-h-screen"
      style={{
        background: `linear-gradient(135deg, ${theme.from} 0%, ${theme.via} 45%, ${theme.to}80 100%)`,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-6">
        <div>
          <h1 className="text-2xl font-bold text-white">{t.keyVault}</h1>
          <p className="text-white/60 text-sm mt-1">
            {unlimitedKeys ? `${vaultKeys.length} (${t.proFeature3})` : `${vaultKeys.length}/${FREE_VAULT_KEY_LIMIT} (${t.freeLimit})`}
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(prev => !prev)}
          disabled={atFreeLimit && !showAddForm}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 text-white text-sm font-medium hover:bg-white/20 transition-colors"
        >
          {showAddForm ? (
            <>
              <X className="w-4 h-4" />
              {t.cancel}
            </>
          ) : (
            <>
              <Plus className="w-4 h-4" />
              {t.addKey}
            </>
          )}
        </button>
      </div>

      {/* Content */}
      <div className="px-6 pb-6 space-y-4">
        {/* Inline add form */}
        <AnimatePresence>
          {showAddForm && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <AddKeyForm
                onSubmit={handleAddKey}
                onCancel={() => setShowAddForm(false)}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {feedback && (
          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/80">
            {feedback}
          </div>
        )}

        {atFreeLimit && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            免费版已达到 {FREE_VAULT_KEY_LIMIT} 个密钥上限。删除旧密钥或升级 Pro 后可继续添加。
          </div>
        )}

        {/* Warning for exposed keys found in config files */}
        <AnimatePresence>
          {exposedKeys.map(exposed => (
            <motion.div
              key={exposed.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <GlassmorphicCard
                className="border-2 border-amber-500/50"
                glowColor="#F59E0B"
              >
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-5 h-5 text-amber-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-white mb-1">
                      {exposed.service} ({exposed.masked_value})
                    </h3>
                    <p className="text-sm text-amber-300/80 mb-3">
                      {t.plaintextWarning.replace('{platform}', exposed.platform)}
                    </p>
                    <button
                      onClick={() => handleImportKey(exposed.id)}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      {t.importToVault}
                    </button>
                  </div>
                </div>
              </GlassmorphicCard>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Secure keys list */}
        <AnimatePresence>
          {vaultKeys.map((key, index) => (
            <motion.div
              key={key.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -40 }}
              transition={{ delay: index * 0.05 }}
            >
              <KeyCard
                vaultKey={key}
                onCopy={() => handleCopyKey(key)}
                onDelete={() => handleDeleteKey(key)}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Pro upgrade banner */}
      {!unlimitedKeys && (
        <div className="px-6 pb-6">
          <ProUpgradeBanner variant="banner" text={t.unlimitedKeys} />
        </div>
      )}
    </div>
  );
}

// ─── Inline Add Key Form ──────────────────────────────────────────────────────

interface AddKeyFormProps {
  onSubmit: (name: string, service: string, value: string) => void;
  onCancel: () => void;
}

function AddKeyForm({ onSubmit, onCancel }: AddKeyFormProps) {
  const [name, setName] = useState('');
  const [service, setService] = useState('');
  const [value, setValue] = useState('');

  const canSubmit = name.trim() && service.trim() && value.trim();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(name.trim(), service.trim(), value.trim());
  };

  return (
    <GlassmorphicCard>
      <form onSubmit={handleSubmit} className="space-y-3">
        <h3 className="font-semibold text-white mb-2">{t.addKey}</h3>
        <input
          type="text"
          placeholder={t.keyNamePlaceholder}
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-black/30 text-white text-sm placeholder-white/30 outline-none focus:ring-1 focus:ring-amber-400/50"
        />
        <input
          type="text"
          placeholder={t.servicePlaceholder}
          value={service}
          onChange={e => setService(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-black/30 text-white text-sm placeholder-white/30 outline-none focus:ring-1 focus:ring-amber-400/50"
        />
        <input
          type="password"
          placeholder={t.keyValuePlaceholder}
          value={value}
          onChange={e => setValue(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-black/30 text-white text-sm placeholder-white/30 outline-none focus:ring-1 focus:ring-amber-400/50"
        />
        <div className="flex items-center gap-2 pt-1">
          <button
            type="submit"
            disabled={!canSubmit}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              canSubmit
                ? 'bg-amber-500 text-white hover:bg-amber-600'
                : 'bg-white/10 text-white/30 cursor-not-allowed'
            )}
          >
            <Check className="w-4 h-4" />
            {t.confirm}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-white/10 text-white/70 text-sm font-medium hover:bg-white/20 transition-colors"
          >
            {t.cancel}
          </button>
        </div>
      </form>
    </GlassmorphicCard>
  );
}

// ─── Key Card ─────────────────────────────────────────────────────────────────

interface KeyCardProps {
  vaultKey: VaultKeyInfo;
  onCopy: () => Promise<boolean>;
  onDelete: () => void;
}

function KeyCard({ vaultKey, onCopy, onDelete }: KeyCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      const copied = await onCopy();
      if (copied) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (error) {
      console.error('Failed to copy secret from vault:', error);
    }
  };

  return (
    <GlassmorphicCard>
      <div className="flex items-center gap-4">
        {/* Lock icon */}
        <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
          <Lock className="w-6 h-6 text-amber-400" />
        </div>

        {/* Key info */}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-white">{vaultKey.name}</h3>
          <p className="text-sm text-white/50">{vaultKey.service}</p>
        </div>

        {/* Masked value */}
        <div className="flex items-center gap-2">
          <code className="px-3 py-1.5 rounded-lg bg-black/30 text-white/70 text-sm font-mono">
            {vaultKey.masked_value}
          </code>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopy}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
            title={t.copyKey}
          >
            {copied ? (
              <span className="text-green-400 text-xs">{t.copied}</span>
            ) : (
              <Copy className="w-4 h-4 text-white/50" />
            )}
          </button>
          <button
            onClick={onDelete}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors text-red-400"
            title={t.deleteKey}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </GlassmorphicCard>
  );
}
