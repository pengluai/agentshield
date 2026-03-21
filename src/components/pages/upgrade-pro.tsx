import { useState, useCallback } from "react";
import { tauriInvoke as invoke } from '@/services/tauri';
import { motion } from "framer-motion";
import { Crown, Zap, Shield, Key, Bell, Star, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLicenseStore } from "@/stores/licenseStore";
import { isEnglishLocale, t } from '@/constants/i18n';
import { isTauriEnvironment } from '@/services/tauri';
import { openExternalUrl } from "@/services/runtime-settings";

interface UpgradeProProps {
  onBack?: () => void;
}

type PurchaseOptionId = 'monthly' | 'yearly' | 'lifetime';

interface PurchaseOption {
  id: PurchaseOptionId;
  skuCode: string;
  title: string;
  price: string;
  pricePer?: string;
  validity: string;
  checkoutUrl: string;
  recommended?: boolean;
}

const FALLBACK_CHECKOUT_URLS: Record<PurchaseOptionId, string> = {
  monthly: 'https://www.creem.io/payment/prod_2T8qrIwLHQ3AlG4KtTB849',
  yearly: 'https://www.creem.io/payment/prod_7kbjugsRm1gGN6lKXOR1NG',
  lifetime: 'https://www.creem.io/payment/prod_4rh2nT74Cqk4IQ5EfvcjbH',
};

const DEFAULT_PRODUCTION_LICENSE_GATEWAY_URL = 'https://api.51silu.com';

const LOCAL_ONLY_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
]);

const PLACEHOLDER_HOSTS = new Set([
  'example.com',
  'invalid',
  'test',
]);

function isLocalOnlyHost(hostname: string) {
  return LOCAL_ONLY_HOSTS.has(hostname.toLowerCase());
}

function isPlaceholderHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (PLACEHOLDER_HOSTS.has(host)) {
    return true;
  }
  return (
    host.endsWith('.example.com')
    || host.endsWith('.invalid')
    || host.endsWith('.test')
  );
}

function isCheckoutUrlUsable(url: string) {
  const normalized = url.trim();
  if (!normalized) {
    return false;
  }
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'https:') {
      return false;
    }
    return !isLocalOnlyHost(parsed.hostname) && !isPlaceholderHost(parsed.hostname);
  } catch {
    return false;
  }
}

function isGatewayUrlUsable(url: string) {
  const normalized = url.trim();
  if (!normalized) {
    return false;
  }
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol === 'https:') {
      return !isLocalOnlyHost(parsed.hostname) && !isPlaceholderHost(parsed.hostname);
    }
    if (import.meta.env.DEV && parsed.protocol === 'http:') {
      return isLocalOnlyHost(parsed.hostname);
    }
    return false;
  } catch {
    return false;
  }
}

function resolveCheckoutBaseUrl(optionId: PurchaseOptionId, configuredUrl: string) {
  const normalized = configuredUrl.trim();
  if (isCheckoutUrlUsable(normalized)) {
    return normalized;
  }
  const fallback = FALLBACK_CHECKOUT_URLS[optionId] ?? '';
  return isCheckoutUrlUsable(fallback) ? fallback : '';
}

function resolveLicenseGatewayBaseUrl(configuredUrl: string) {
  const normalized = configuredUrl.trim();
  if (isGatewayUrlUsable(normalized)) {
    return normalized;
  }
  return DEFAULT_PRODUCTION_LICENSE_GATEWAY_URL;
}

const FREE_FEATURES = [
  { icon: Shield, textKey: 'freeFeature1' as const },
  { icon: Key, textKey: 'freeFeature2' as const },
  { icon: Bell, textKey: 'freeFeature3' as const },
];

const PRO_FEATURES = [
  { icon: Shield, textKey: 'proFeature1' as const },
  { icon: Zap, textKey: 'proFeature2' as const },
  { icon: Key, textKey: 'proFeature3' as const },
  { icon: Bell, textKey: 'proFeature4' as const },
  { icon: Star, textKey: 'proFeature5' as const },
  { icon: Crown, textKey: 'proFeature6' as const },
  { icon: Shield, textKey: 'proFeature7' as const },
];


export function UpgradePro({ onBack }: UpgradeProProps) {
  const { plan, isPro, isTrial, trialDaysLeft, setLicenseInfo } = useLicenseStore();
  const [activating, setActivating] = useState(false);
  const [purchasingSku, setPurchasingSku] = useState<PurchaseOption['id'] | null>(null);
  const [licenseKey, setLicenseKey] = useState("");
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'error' | 'success' | 'info'; message: string } | null>(null);
  const [promoCode, setPromoCode] = useState('');
  const [promoResult, setPromoResult] = useState<{
    valid: boolean;
    discount_pct: number;
    affiliate_id: string;
    affiliate_name: string | null;
    message: string;
  } | null>(null);
  const [validatingPromo, setValidatingPromo] = useState(false);
  const previewMessage = t.desktopOnlyInBrowserShell.replace('{feature}', t.moduleUpgradePro);
  const purchaseOptions: PurchaseOption[] = [
    {
      id: 'monthly',
      skuCode: 'AGSH_PRO_30D',
      title: isEnglishLocale ? 'Monthly' : '月付',
      price: isEnglishLocale ? '$4.9' : '¥29',
      pricePer: isEnglishLocale ? '/mo' : '/月',
      validity: t.validFor30Days,
      checkoutUrl: resolveCheckoutBaseUrl('monthly', import.meta.env.VITE_CHECKOUT_MONTHLY_URL ?? ''),
    },
    {
      id: 'yearly',
      skuCode: 'AGSH_PRO_365D',
      title: isEnglishLocale ? 'Yearly' : '年付',
      price: isEnglishLocale ? '$39.9' : '¥198',
      pricePer: isEnglishLocale ? '/yr' : '/年',
      validity: isEnglishLocale ? 'Save 32%' : '省 43%',
      checkoutUrl: resolveCheckoutBaseUrl('yearly', import.meta.env.VITE_CHECKOUT_YEARLY_URL ?? ''),
      recommended: true,
    },
    {
      id: 'lifetime',
      skuCode: 'AGSH_PRO_LIFETIME',
      title: isEnglishLocale ? 'Lifetime' : '永久',
      price: isEnglishLocale ? '$79.9' : '¥398',
      pricePer: '',
      validity: isEnglishLocale ? 'Pay once, own forever' : '一次付清，永久使用',
      checkoutUrl: resolveCheckoutBaseUrl('lifetime', import.meta.env.VITE_CHECKOUT_LIFETIME_URL ?? ''),
    },
  ];

  const validatePromo = useCallback(async () => {
    const code = promoCode.trim().toUpperCase();
    if (!code) { setPromoResult(null); return; }
    setValidatingPromo(true);
    try {
      const gatewayUrl = resolveLicenseGatewayBaseUrl(import.meta.env.VITE_LICENSE_GATEWAY_URL ?? '');
      const resp = await fetch(`${gatewayUrl}/api/promos/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await resp.json();
      setPromoResult(data);
    } catch {
      setPromoResult({ valid: false, discount_pct: 0, affiliate_id: '', affiliate_name: null, message: t.promoInvalid });
    } finally {
      setValidatingPromo(false);
    }
  }, [promoCode]);

  const getDiscountedPrice = (price: number) => {
    if (promoResult?.valid && promoResult.discount_pct > 0) {
      return Math.round(price * (100 - promoResult.discount_pct)) / 100;
    }
    return price;
  };

  const buildCheckoutUrl = (baseUrl: string, skuCode: string) => {
    try {
      const url = new URL(baseUrl);
      url.searchParams.set('metadata[sku_code]', skuCode);
      url.searchParams.set('metadata[campaign]', 'desktop_upgrade');
      url.searchParams.set('metadata[source]', 'agentshield_app');
      if (promoResult?.valid && promoCode.trim()) {
        url.searchParams.set('discount_code', promoCode.trim().toUpperCase());
        url.searchParams.set('metadata[affiliate_id]', promoResult.affiliate_id);
        url.searchParams.set('metadata[promo_code]', promoCode.trim().toUpperCase());
      }
      return url.toString();
    } catch {
      return baseUrl;
    }
  };

  const handleActivate = async () => {
    if (!licenseKey.trim()) return;

    if (!isTauriEnvironment()) {
      setFeedback({ tone: 'info', message: previewMessage });
      return;
    }

    setActivating(true);
    setFeedback(null);
    try {
      const result = await invoke<{ plan: string; status: string; expires_at: string | null; trial_days_left: number | null }>('activate_license', {
        key: licenseKey.trim()
      });
      if (result.plan === 'pro' && result.status === 'active') {
        setLicenseInfo({
          plan: result.plan as any,
          status: result.status as any,
          expiresAt: result.expires_at ?? undefined,
          trialDaysLeft: result.trial_days_left ?? undefined,
          features: [],
        });
        setFeedback({ tone: 'success', message: t.proActivatedDesc });
        setShowKeyInput(false);
        setLicenseKey('');
      } else {
        setFeedback({ tone: 'error', message: t.activateFailed });
      }
    } catch (e) {
      setFeedback({ tone: 'error', message: `${t.activateFailed}: ${String(e)}` });
    } finally {
      setActivating(false);
    }
  };

  const handleStartTrial = async () => {
    if (!isTauriEnvironment()) {
      setFeedback({ tone: 'info', message: previewMessage });
      return;
    }

    setActivating(true);
    setFeedback(null);
    try {
      const result = await invoke<{ plan: string; status: string; expires_at: string | null; trial_days_left: number | null }>('start_trial');
      if (result.plan === 'trial' && result.status === 'active') {
        setLicenseInfo({
          plan: result.plan as any,
          status: result.status as any,
          expiresAt: result.expires_at ?? undefined,
          trialDaysLeft: result.trial_days_left ?? undefined,
          features: [],
        });
        setFeedback({
          tone: 'success',
          message: t.trialActive.replace('{days}', String(result.trial_days_left ?? 14)),
        });
      } else {
        setFeedback({ tone: 'error', message: t.trialFailed });
      }
    } catch (e) {
      setFeedback({ tone: 'error', message: `${t.trialFailed}: ${String(e)}` });
    } finally {
      setActivating(false);
    }
  };

  const handlePurchase = async (option: PurchaseOption) => {
    const checkoutBaseUrl = option.checkoutUrl.trim();
    if (!isCheckoutUrlUsable(checkoutBaseUrl)) {
      setFeedback({ tone: 'error', message: t.checkoutLinkMissing });
      return;
    }

    setPurchasingSku(option.id);
    setFeedback(null);
    try {
      const checkoutUrl = buildCheckoutUrl(checkoutBaseUrl, option.skuCode);
      await openExternalUrl(checkoutUrl);
      setFeedback({ tone: 'info', message: t.purchaseOpenedInBrowser });
    } catch (e) {
      setFeedback({ tone: 'error', message: `${t.openPurchaseFailed}: ${String(e)}` });
    } finally {
      setPurchasingSku(null);
    }
  };

  if (isPro) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-center"
        >
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
            <Crown className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">{t.proActivated}</h1>
          <p className="text-white/60 mb-8">{t.proActivatedDesc}</p>
          {onBack && (
            <button
              onClick={onBack}
              className="px-6 py-3 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors"
            >
              {t.back}
            </button>
          )}
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden p-6">
      <div className="max-w-5xl mx-auto w-full flex flex-col h-full">
        {/* Header — compact */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-4 shrink-0"
        >
          <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
            <Crown className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-1">{t.upgradePro}</h1>
          <p className="text-white/60 text-sm">{t.upgradeProSubtitle}</p>
        </motion.div>

        {/* Main content — flex-1 */}
        <div className="flex-1 min-h-0 grid grid-cols-2 gap-5">
          {/* Left: Free plan + Pro features */}
          <div className="flex flex-col gap-4 overflow-visible">
            {/* Free Plan — compact */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
              className={cn(
                "p-5 rounded-2xl border shrink-0",
                plan === "free"
                  ? "bg-white/10 border-white/20"
                  : "bg-white/5 border-white/10"
              )}
            >
              <div className="flex items-baseline justify-between mb-3">
                <div>
                  <h2 className="text-lg font-semibold text-white">Free</h2>
                  <p className="text-sm text-white/50">{t.freeBasicProtection}</p>
                </div>
                <p className="text-2xl font-bold text-white">
                  {isEnglishLocale ? '$0' : '¥0'}
                </p>
              </div>
              <div className="space-y-2">
                {FREE_FEATURES.map((feature, i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <feature.icon className="w-4 h-4 text-white/50 shrink-0" />
                    <span className="text-sm text-white/70">{t[feature.textKey]}</span>
                  </div>
                ))}
              </div>
              {plan === "free" && (
                <div className="mt-3 py-1.5 text-center text-xs text-white/50 rounded-lg border border-white/10">
                  {t.currentPlan}
                </div>
              )}
            </motion.div>

            {/* Pro Features list */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 }}
              className="flex-1 min-h-0 p-5 pt-6 rounded-2xl border-2 border-amber-500/50 bg-gradient-to-br from-amber-500/10 to-orange-500/10 relative overflow-visible"
            >
              <div className="absolute -top-3 right-4 px-3 py-1 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 text-xs font-bold text-white z-10">
                {t.recommended}
              </div>
              <h2 className="text-lg font-semibold text-white mb-3">Pro</h2>
              <div className="space-y-2.5">
                {PRO_FEATURES.map((feature, i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <feature.icon className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="text-sm text-white">{t[feature.textKey]}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>

          {/* Right: Pricing cards + Actions */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="flex flex-col gap-4"
          >
            {/* Promo code input */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <h4 className="text-sm font-medium text-white/70 mb-2">
                {t.promoCode}
              </h4>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={promoCode}
                  onChange={(e) => { setPromoCode(e.target.value.toUpperCase()); setPromoResult(null); }}
                  placeholder={t.promoCodePlaceholder}
                  className="flex-1 rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-white uppercase placeholder:normal-case placeholder-white/30 outline-none focus:ring-2 focus:ring-amber-500/50"
                />
                <button
                  onClick={() => void validatePromo()}
                  disabled={!promoCode.trim() || validatingPromo}
                  className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/15 disabled:opacity-50 transition-colors"
                >
                  {validatingPromo ? t.promoChecking : t.promoApply}
                </button>
              </div>
              {promoResult && (
                <div className={`mt-2 text-sm ${promoResult.valid ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {promoResult.valid
                    ? t.promoDiscountApplied.replace('{pct}', String(promoResult.discount_pct))
                    : promoResult.message}
                </div>
              )}
            </div>

            {/* Pricing cards */}
            <div className="flex flex-col gap-3">
              {purchaseOptions.map((option) => (
                <div
                  key={option.id}
                  className={cn(
                    "rounded-xl border p-4 flex items-center gap-4",
                    option.recommended
                      ? "border-amber-500/50 bg-amber-500/10 ring-1 ring-amber-500/30"
                      : "border-white/10 bg-white/5",
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-white">{option.title}</h4>
                      {option.recommended && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500 text-white">
                          {t.recommended}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-white/50 mt-0.5">{option.validity}</p>
                  </div>
                  <div className="text-right shrink-0">
                    {promoResult?.valid && promoResult.discount_pct > 0 ? (
                      <>
                        <del className="text-sm text-white/40">{option.price}</del>
                        <span className="text-2xl font-bold text-emerald-400 ml-1">
                          {(() => {
                            const num = parseFloat(option.price.replace(/[^0-9.]/g, ''));
                            const prefix = option.price.replace(/[0-9.]/g, '');
                            return `${prefix}${getDiscountedPrice(num)}`;
                          })()}
                        </span>
                      </>
                    ) : (
                      <span className="text-2xl font-bold text-white">{option.price}</span>
                    )}
                    {option.pricePer && (
                      <span className="text-sm text-white/50">{option.pricePer}</span>
                    )}
                  </div>
                  <button
                    onClick={() => void handlePurchase(option)}
                    disabled={purchasingSku !== null}
                    className={cn(
                      "shrink-0 px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50",
                      option.recommended
                        ? "bg-amber-500 text-white hover:bg-amber-600"
                        : "bg-white/10 text-white hover:bg-white/15"
                    )}
                  >
                    {purchasingSku === option.id ? (
                      <div className="w-4 h-4 mx-auto border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      t.buyActivationCode
                    )}
                  </button>
                </div>
              ))}
            </div>

            <p className="text-center text-xs text-white/40">{t.oneTimePaymentNoSubscription}</p>

            {/* Trial button */}
            {!isTrial && (
              <button
                onClick={handleStartTrial}
                disabled={activating}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-semibold hover:from-amber-600 hover:to-orange-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {activating ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    {t.freeTrial30}
                  </>
                )}
              </button>
            )}
            {isTrial && (
              <div className="py-2 text-center text-sm text-amber-400 rounded-lg border border-amber-500/30 bg-amber-500/10">
                {t.trialActive.replace('{days}', String(trialDaysLeft ?? 0))}
              </div>
            )}

            {/* License key input */}
            <button
              onClick={() => setShowKeyInput(!showKeyInput)}
              className="w-full py-2.5 rounded-xl border border-white/20 text-white/80 hover:bg-white/10 transition-colors flex items-center justify-center gap-2 text-sm"
            >
              <Key className="w-4 h-4" />
              {t.enterLicenseKey}
              <ArrowRight className="w-4 h-4" />
            </button>

            {showKeyInput && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="rounded-xl bg-white/5 border border-white/10 p-4"
              >
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={licenseKey}
                    onChange={(e) => setLicenseKey(e.target.value)}
                    placeholder="AGSH.<payload>.<signature>"
                    className="flex-1 px-3 py-2.5 rounded-lg bg-white/10 border border-white/10 text-white text-sm placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                  />
                  <button
                    onClick={handleActivate}
                    disabled={activating || !licenseKey.trim()}
                    className="px-5 py-2.5 rounded-lg bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition-colors disabled:opacity-50"
                  >
                    {activating ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      t.activate
                    )}
                  </button>
                </div>
              </motion.div>
            )}

            {feedback && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  'p-3 rounded-xl border text-sm',
                  feedback.tone === 'success'
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-200'
                    : feedback.tone === 'info'
                      ? 'bg-sky-500/10 border-sky-500/20 text-sky-200'
                      : 'bg-rose-500/10 border-rose-500/20 text-rose-200'
                )}
              >
                {feedback.message}
              </motion.div>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
