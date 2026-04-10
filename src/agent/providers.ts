/**
 * agent/providers.ts — Provider definitions and settings persistence.
 * Pure data layer, no DOM dependency.
 */

import type { ProviderDef, AppSettings } from '../types';

const SETTINGS_STORAGE_KEY = 'dg-agent-settings';

export const DEFAULT_MAX_STRENGTH = 50;
export const MAX_STRENGTH_CEILING = 200;

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'free',
    name: '免费体验',
    hint: '无需 API Key，每分钟限 10 条。请根据所在地区选择线路。',
    fields: [
      {
        key: 'region',
        label: '代理线路',
        type: 'select',
        default: 'cn',
        options: [
          { value: 'cn', label: '阿里云' },
          { value: 'intl', label: 'Cloudflare' },
        ],
      },
    ],
  },
  {
    id: 'qwen',
    name: '通义千问',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-...' },
      { key: 'model', label: '模型', type: 'text', placeholder: 'qwen3.5-flash' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-...' },
      { key: 'model', label: '模型', type: 'text', placeholder: 'gpt-5.3' },
      { key: 'baseUrl', label: 'Base URL', type: 'url', placeholder: 'https://api.openai.com/v1' },
    ],
  },
  {
    id: 'custom',
    name: '自定义',
    hint: '自定义模型、API Key 和接口地址',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-...' },
      { key: 'model', label: '模型', type: 'text', placeholder: 'model-name' },
      { key: 'baseUrl', label: 'Base URL', type: 'url', placeholder: 'https://api.example.com/v1' },
    ],
  },
];

function normalizeMax(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(MAX_STRENGTH_CEILING, Math.round(n)));
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppSettings;
      // Migration: legacy single-value cap → per-channel caps.
      const legacy =
        typeof parsed.maxStrength === 'number' && Number.isFinite(parsed.maxStrength)
          ? parsed.maxStrength
          : null;
      if (typeof parsed.maxStrengthA !== 'number' || !Number.isFinite(parsed.maxStrengthA)) {
        parsed.maxStrengthA = legacy ?? DEFAULT_MAX_STRENGTH;
      }
      if (typeof parsed.maxStrengthB !== 'number' || !Number.isFinite(parsed.maxStrengthB)) {
        parsed.maxStrengthB = legacy ?? DEFAULT_MAX_STRENGTH;
      }
      delete parsed.maxStrength;
      return parsed;
    }
  } catch (_) { /* */ }
  return {
    provider: 'free',
    configs: {},
    presetId: 'gentle',
    customPrompt: '',
    backgroundBehavior: 'stop',
    maxStrengthA: DEFAULT_MAX_STRENGTH,
    maxStrengthB: DEFAULT_MAX_STRENGTH,
  };
}

export function saveSettings(settings: AppSettings): void {
  try { localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings)); } catch (_) { /* */ }
}

/** Read the user-configured max strength cap for one channel (0-200). */
export function getMaxStrength(channel: 'A' | 'B'): number {
  const s = loadSettings();
  return normalizeMax(channel === 'A' ? s.maxStrengthA : s.maxStrengthB, DEFAULT_MAX_STRENGTH);
}
