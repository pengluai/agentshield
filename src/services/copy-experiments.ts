import { isEnglishLocale } from '@/constants/i18n';

const tr = (zh: string, en: string) => (isEnglishLocale ? en : zh);

export type RiskCopyVariant = 'control' | 'anxiety';
export type RiskCopyPlacement = 'runtime_approval' | 'rule_updates';
export type RiskCopyEventType = 'exposure' | 'action';

export interface RiskCopyPayload {
  hookLine: string;
  footerLine?: string;
  ctaLine?: string;
}

interface RiskCopyEvent {
  experiment_id: string;
  placement: RiskCopyPlacement;
  variant: RiskCopyVariant;
  event_type: RiskCopyEventType;
  action?: string;
  metadata?: Record<string, string>;
  at: string;
}

const RISK_COPY_EXPERIMENT_ID = 'risk-copy-v1';
const EXPERIMENT_DEVICE_KEY = 'agentshield-exp-device-id';
const EXPERIMENT_VARIANT_KEY = `agentshield-exp:${RISK_COPY_EXPERIMENT_ID}:variant`;
const EXPERIMENT_EVENT_LOG_KEY = 'agentshield-exp-events';
const EXPERIMENT_EVENT_LOG_LIMIT = 200;

const RISK_COPY_VARIANTS: readonly RiskCopyVariant[] = ['control', 'anxiety'];

const PAYLOADS: Record<RiskCopyPlacement, Record<RiskCopyVariant, RiskCopyPayload>> = {
  runtime_approval: {
    control: {
      hookLine: tr(
        '免费版需要你逐次确认；完整版会更快同步规则并减少重复手动确认。',
        'Free plan requires manual approval each time. Upgrade for faster rule sync and fewer repeated confirmations.'
      ),
      footerLine: tr(
        '不点允许，这次操作就不会被放行',
        'If you don\'t approve, this action will not be allowed'
      ),
      ctaLine: tr(
        '升级完整版可获得更快规则更新与更少重复确认。',
        'Upgrade for faster rule updates and fewer repeated confirmations.'
      ),
    },
    anxiety: {
      hookLine: tr(
        '免费版每次都要手动确认，漏看一次就可能放行高危动作；升级完整版可减少重复确认并优先下发新拦截规则。',
        'Free plan requires manual approval every time — missing one could allow a high-risk action. Upgrade to reduce repeated confirmations and get priority rule updates.'
      ),
      footerLine: tr(
        '只要你不点允许，这次高危动作就会继续被拦住。',
        'As long as you don\'t approve, this high-risk action will remain blocked.'
      ),
      ctaLine: tr(
        '升级完整版后，规则更新更快，未知风险窗口更短。',
        'After upgrading, rule updates are faster and the unknown risk window is shorter.'
      ),
    },
  },
  rule_updates: {
    control: {
      hookLine: tr(
        '免费版规则库延后更新，手动同步最短间隔为 7 天。',
        'Free plan rule updates are delayed. Manual sync interval is at least 7 days.'
      ),
      ctaLine: tr(
        '升级完整版可开启自动热更新，减少未知威胁空窗期。',
        'Upgrade to enable automatic hot updates and reduce the unknown threat window.'
      ),
    },
    anxiety: {
      hookLine: tr(
        '免费版规则落后时，新出现的恶意 Skill / MCP 可能先一步执行高危动作。',
        'When free plan rules lag behind, newly emerged malicious Skills / MCPs may execute high-risk actions first.'
      ),
      ctaLine: tr(
        '升级完整版后可实时更新规则，尽量缩短暴露窗口。',
        'After upgrading, rules update in real time to minimize the exposure window.'
      ),
    },
  },
};

function canUseStorage() {
  return typeof localStorage !== 'undefined';
}

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function getDeviceId() {
  if (!canUseStorage()) {
    return 'ephemeral-device';
  }

  const saved = localStorage.getItem(EXPERIMENT_DEVICE_KEY);
  if (saved) {
    return saved;
  }

  const generated = `device-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(EXPERIMENT_DEVICE_KEY, generated);
  return generated;
}

function readEvents(): RiskCopyEvent[] {
  if (!canUseStorage()) {
    return [];
  }

  try {
    const raw = localStorage.getItem(EXPERIMENT_EVENT_LOG_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed as RiskCopyEvent[];
  } catch {
    return [];
  }
}

function writeEvents(events: RiskCopyEvent[]) {
  if (!canUseStorage()) {
    return;
  }

  localStorage.setItem(
    EXPERIMENT_EVENT_LOG_KEY,
    JSON.stringify(events.slice(-EXPERIMENT_EVENT_LOG_LIMIT))
  );
}

function appendEvent(event: Omit<RiskCopyEvent, 'experiment_id' | 'at'>) {
  const nextEvent: RiskCopyEvent = {
    experiment_id: RISK_COPY_EXPERIMENT_ID,
    at: new Date().toISOString(),
    ...event,
  };
  writeEvents([...readEvents(), nextEvent]);
}

export function getRiskCopyVariant(): RiskCopyVariant {
  if (canUseStorage()) {
    const saved = localStorage.getItem(EXPERIMENT_VARIANT_KEY);
    if (saved === 'control' || saved === 'anxiety') {
      return saved;
    }
  }

  const seed = `${RISK_COPY_EXPERIMENT_ID}:${getDeviceId()}`;
  const variant = RISK_COPY_VARIANTS[hashString(seed) % RISK_COPY_VARIANTS.length];
  if (canUseStorage()) {
    localStorage.setItem(EXPERIMENT_VARIANT_KEY, variant);
  }
  return variant;
}

export function getRiskCopyPayload(
  placement: RiskCopyPlacement,
  variant: RiskCopyVariant = getRiskCopyVariant()
): RiskCopyPayload {
  return PAYLOADS[placement][variant];
}

export function trackRiskCopyExposure(
  placement: RiskCopyPlacement,
  metadata: Record<string, string> = {}
) {
  appendEvent({
    placement,
    variant: getRiskCopyVariant(),
    event_type: 'exposure',
    metadata,
  });
}

export function trackRiskCopyAction(
  placement: RiskCopyPlacement,
  action: string,
  metadata: Record<string, string> = {}
) {
  appendEvent({
    placement,
    variant: getRiskCopyVariant(),
    event_type: 'action',
    action,
    metadata,
  });
}

export function listRiskCopyEventsForDebug() {
  return readEvents();
}
