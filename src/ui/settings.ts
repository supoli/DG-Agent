/**
 * ui/settings.ts — Settings modal rendering & provider config.
 */

import {
  PROVIDERS,
  loadSettings,
  saveSettings as persistSettings,
  DEFAULT_MAX_STRENGTH,
  MAX_STRENGTH_CEILING,
} from '../agent/providers';
import type { AppSettings } from '../types';
import * as bluetooth from '../agent/bluetooth';
import { updateStrengthCapMarker } from './device';
import { $ } from './index';

let activePresetIdRef: () => string;
let customPromptRef: () => string;

export function init(getPresetId: () => string, getCustomPrompt: () => string): void {
  activePresetIdRef = getPresetId;
  customPromptRef = getCustomPrompt;
}

export function open(): void {
  $('settings-modal')!.classList.remove('hidden');
  const saved = loadSettings();
  updateCurrentAiLabel();
  renderTabs();
  renderConfig(saved.provider);
  renderBehaviorSettings(saved);
}

export function close(): void {
  $('settings-modal')!.classList.add('hidden');
  saveCurrentSettings();
}

export function selectProvider(id: string): void {
  const saved = loadSettings();
  saved.provider = id;
  persistSettings(saved);

  renderTabs();
  renderConfig(id);
  renderBehaviorSettings(saved);
  updateCurrentAiLabel();
}

export function updateCurrentAiLabel(): void {
  const saved = loadSettings();
  const prov = PROVIDERS.find((x) => x.id === saved.provider);
  const el = $('settings-current-ai');
  if (el) el.innerHTML = `当前模型：<strong>${prov?.name || saved.provider}</strong>`;
}

export function saveCurrentSettings(): void {
  const saved = loadSettings();

  const inputs = document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.provider-cfg-input');
  if (inputs.length > 0) {
    const currentCfg: Record<string, string> = {};
    inputs.forEach((inp) => { currentCfg[inp.dataset.key!] = inp.value; });
    saved.configs[saved.provider] = currentCfg;
  }

  saved.presetId = activePresetIdRef();
  saved.customPrompt = customPromptRef();

  persistSettings(saved);
}

export function getBackgroundBehavior(): 'stop' | 'keep' {
  return loadSettings().backgroundBehavior || 'stop';
}

function renderBehaviorSettings(saved: AppSettings): void {
  const container = $('provider-config')!;

  const section = document.createElement('div');
  section.className = 'behavior-settings';

  const title = document.createElement('h3');
  title.className = 'behavior-settings-title';
  title.textContent = '安全设置';
  section.appendChild(title);

  const group = document.createElement('div');
  group.className = 'setting-group setting-group-inline';

  const label = document.createElement('label');
  label.textContent = '切换后台时停止输出';
  label.htmlFor = 'cfg-bg-behavior';

  const toggle = document.createElement('button');
  toggle.id = 'cfg-bg-behavior';
  const isStop = (saved.backgroundBehavior || 'stop') === 'stop';
  toggle.className = 'toggle-btn' + (isStop ? ' active' : '');
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-checked', String(isStop));

  const knob = document.createElement('span');
  knob.className = 'toggle-knob';
  toggle.appendChild(knob);

  toggle.addEventListener('click', () => {
    const current = toggle.classList.contains('active');
    toggle.classList.toggle('active', !current);
    toggle.setAttribute('aria-checked', String(!current));
    const s = loadSettings();
    s.backgroundBehavior = current ? 'keep' : 'stop';
    persistSettings(s);
  });

  group.appendChild(label);
  group.appendChild(toggle);
  section.appendChild(group);

  const hint = document.createElement('p');
  hint.className = 'provider-hint';
  hint.textContent = '开启后，切换到其他应用或标签页时将自动停止所有波形并将强度归零';
  section.appendChild(hint);

  // Max strength caps (per channel) ----------------------------------------
  const capsWrap = document.createElement('div');
  capsWrap.className = 'max-strength-wrap';

  const capsHeader = document.createElement('div');
  capsHeader.className = 'max-strength-header';
  capsHeader.textContent = '最大强度上限';
  capsWrap.appendChild(capsHeader);

  const capsRow = document.createElement('div');
  capsRow.className = 'max-strength-row';

  const makeStepper = (channel: 'A' | 'B'): HTMLDivElement => {
    const initial = normalizeCap(
      channel === 'A' ? saved.maxStrengthA : saved.maxStrengthB,
    );

    const card = document.createElement('div');
    card.className = 'strength-stepper';
    card.dataset.channel = channel;

    const chLabel = document.createElement('span');
    chLabel.className = 'strength-stepper-channel';
    chLabel.textContent = channel;
    card.appendChild(chLabel);

    const control = document.createElement('div');
    control.className = 'strength-stepper-control';

    const dec = document.createElement('button');
    dec.type = 'button';
    dec.className = 'strength-stepper-btn';
    dec.textContent = '−';
    dec.setAttribute('aria-label', `${channel} 通道减小`);

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'strength-stepper-input';
    input.min = '0';
    input.max = String(MAX_STRENGTH_CEILING);
    input.step = '1';
    input.value = String(initial);
    input.inputMode = 'numeric';
    input.id = `cfg-max-strength-${channel.toLowerCase()}`;

    const inc = document.createElement('button');
    inc.type = 'button';
    inc.className = 'strength-stepper-btn';
    inc.textContent = '+';
    inc.setAttribute('aria-label', `${channel} 通道增大`);

    const commit = (): void => {
      const next = normalizeCap(Number(input.value));
      input.value = String(next);

      const s = loadSettings();
      if (channel === 'A') s.maxStrengthA = next;
      else s.maxStrengthB = next;
      persistSettings(s);
      updateStrengthCapMarker();

      // If device is connected and current strength exceeds the new cap,
      // pull this channel back down immediately.
      try {
        const status = bluetooth.getStatus();
        if (status.connected) {
          const cur = channel === 'A' ? status.strengthA : status.strengthB;
          if (cur > next) bluetooth.setStrength(channel, next);
        }
      } catch (_) { /* ignore */ }
    };

    const bump = (delta: number): void => {
      input.value = String(normalizeCap(Number(input.value) + delta));
      commit();
    };

    dec.addEventListener('click', () => bump(-1));
    inc.addEventListener('click', () => bump(1));
    input.addEventListener('change', commit);
    input.addEventListener('blur', commit);

    control.appendChild(dec);
    control.appendChild(input);
    control.appendChild(inc);
    card.appendChild(control);

    return card;
  };

  capsRow.appendChild(makeStepper('A'));
  capsRow.appendChild(makeStepper('B'));
  capsWrap.appendChild(capsRow);
  section.appendChild(capsWrap);

  const maxHint = document.createElement('p');
  maxHint.className = 'provider-hint';
  maxHint.textContent = `AI 指令的输出强度会分别被限制在 A/B 通道的上限之内（0-${MAX_STRENGTH_CEILING}），默认 ${DEFAULT_MAX_STRENGTH}`;
  section.appendChild(maxHint);

  container.appendChild(section);
}

function normalizeCap(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_MAX_STRENGTH;
  return Math.max(0, Math.min(MAX_STRENGTH_CEILING, Math.round(n)));
}

function renderTabs(): void {
  const container = $('settings-provider-tabs')!;
  container.innerHTML = '';
  const saved = loadSettings();

  PROVIDERS.forEach((p) => {
    const tab = document.createElement('button');
    tab.className = 'provider-tab' + (p.id === saved.provider ? ' active' : '');
    tab.textContent = p.name;
    tab.addEventListener('click', () => selectProvider(p.id));
    container.appendChild(tab);
  });
}

function renderConfig(providerId: string): void {
  const container = $('provider-config')!;
  container.innerHTML = '';

  const provider = PROVIDERS.find((p) => p.id === providerId);
  if (!provider) return;

  const saved = loadSettings();
  const values = saved.configs?.[providerId] || {};

  if (provider.hint) {
    const hint = document.createElement('p');
    hint.className = 'provider-hint';
    hint.textContent = provider.hint;
    container.appendChild(hint);
  }

  if (provider.fields.length === 0) return;

  provider.fields.forEach((f) => {
    const group = document.createElement('div');
    group.className = 'setting-group';

    const label = document.createElement('label');
    label.textContent = f.label;
    label.htmlFor = `cfg-${f.key}`;

    let control: HTMLInputElement | HTMLSelectElement;
    if (f.type === 'select' && f.options) {
      const select = document.createElement('select');
      const currentVal = values[f.key] || f.default || f.options[0].value;
      f.options.forEach((opt) => {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        if (opt.value === currentVal) o.selected = true;
        select.appendChild(o);
      });
      control = select;
    } else {
      const input = document.createElement('input');
      input.type = f.type || 'text';
      input.placeholder = f.placeholder || '';
      input.value = values[f.key] || f.default || '';
      control = input;
    }
    control.id = `cfg-${f.key}`;
    control.dataset.provider = providerId;
    control.dataset.key = f.key;
    control.classList.add('provider-cfg-input');
    group.appendChild(label);
    group.appendChild(control);
    container.appendChild(group);
  });

  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn-primary';
  saveBtn.textContent = '保存';
  saveBtn.addEventListener('click', () => {
    saveCurrentSettings();
    saveBtn.textContent = '已保存 ✓';
    saveBtn.classList.add('btn-saved');
    setTimeout(() => {
      saveBtn.textContent = '保存';
      saveBtn.classList.remove('btn-saved');
    }, 1500);
  });
  actions.appendChild(saveBtn);
  container.appendChild(actions);
}
