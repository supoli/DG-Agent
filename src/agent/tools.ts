/**
 * tools.ts — Tool definitions and executor for Coyote device control.
 * Each tool co-locates its schema and handler. Common boilerplate is unified.
 */

import type { ToolDef, WaveStep } from '../types';
import * as bt from './bluetooth';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const CH = { type: 'string', enum: ['A', 'B'], description: '通道 A 或 B' } as const;

function snap() {
  const s = bt.getStatus();
  return { strengthA: s.strengthA, strengthB: s.strengthB, waveActiveA: s.waveActiveA, waveActiveB: s.waveActiveB };
}

function clamp(value: number, channel: string): { value: number; limited: boolean } {
  const limits = bt.getStrengthLimits();
  const limit = channel.toUpperCase() === 'A' ? limits.limitA : limits.limitB;
  const clamped = Math.min(Math.max(0, value), limit);
  return { value: clamped, limited: clamped !== value };
}

// ---------------------------------------------------------------------------
// Tool registry — definition + handler in one place
// ---------------------------------------------------------------------------

interface ToolEntry {
  def: ToolDef;
  handler: (args: any) => any;
}

const registry: ToolEntry[] = [
  {
    def: {
      name: 'set_strength',
      description: '设置指定通道的绝对强度值',
      parameters: {
        type: 'object', properties: {
          channel: CH,
          value: { type: 'integer', minimum: 0, maximum: 200, description: '强度值 0-200' },
        }, required: ['channel', 'value'],
      },
    },
    handler({ channel, value }) {
      const safe = clamp(value, channel);
      bt.setStrength(channel, safe.value);
      return { channel, requested: value, actual: safe.value, limited: safe.limited };
    },
  },
  {
    def: {
      name: 'add_strength',
      description: '相对调整指定通道的强度',
      parameters: {
        type: 'object', properties: {
          channel: CH,
          delta: { type: 'integer', description: '变化量，正数增加，负数减少' },
        }, required: ['channel', 'delta'],
      },
    },
    handler({ channel, delta }) {
      const current = channel.toUpperCase() === 'A' ? bt.getStatus().strengthA : bt.getStatus().strengthB;
      const safe = clamp(current + delta, channel);
      const actualDelta = safe.value - current;
      if (actualDelta !== 0) bt.addStrength(channel, actualDelta);
      return { channel, requestedDelta: delta, actualDelta, result: safe.value, limited: safe.limited };
    },
  },
  {
    def: {
      name: 'set_strength_limit',
      description: '设置两个通道的强度上限',
      parameters: {
        type: 'object', properties: {
          limit_a: { type: 'integer', minimum: 0, maximum: 200 },
          limit_b: { type: 'integer', minimum: 0, maximum: 200 },
        }, required: ['limit_a', 'limit_b'],
      },
    },
    handler({ limit_a, limit_b }) {
      bt.setStrengthLimit(limit_a, limit_b);
      return { limit_a, limit_b };
    },
  },
  {
    def: {
      name: 'send_wave',
      description: '发送波形。二选一：(1) 只提供 preset；(2) 同时提供 frequency + intensity',
      parameters: {
        type: 'object', properties: {
          channel: CH,
          preset: { type: 'string', enum: ['breath', 'tide', 'pulse_low', 'pulse_mid', 'pulse_high', 'tap'], description: '预设波形名' },
          frequency: { type: 'integer', minimum: 10, maximum: 1000, description: '自定义频率(ms)' },
          intensity: { type: 'integer', minimum: 0, maximum: 100, description: '自定义强度百分比' },
          duration_frames: { type: 'integer', default: 10, description: '帧数，每帧100ms' },
          loop: { type: 'boolean', default: true },
        }, required: ['channel'],
      },
    },
    handler({ channel, preset, frequency, intensity, duration_frames, loop }) {
      if (preset && (frequency != null || intensity != null))
        return { error: 'preset 和 frequency/intensity 互斥，请只选一种' };
      if (!preset && (frequency == null || intensity == null))
        return { error: '非预设模式需要同时提供 frequency 和 intensity' };
      bt.sendWave(channel, preset || null, frequency || null, intensity || null, duration_frames || 10, loop !== false);
      return { channel, preset, frequency, intensity, loop: loop !== false };
    },
  },
  {
    def: {
      name: 'design_wave',
      description: '设计自定义波形。steps 数组每步含 freq(10-1000)、intensity(0-100)、repeat(默认1)',
      parameters: {
        type: 'object', properties: {
          channel: CH,
          steps: {
            type: 'array', items: {
              type: 'object',
              properties: { freq: { type: 'integer' }, intensity: { type: 'integer' }, repeat: { type: 'integer' } },
              required: ['freq', 'intensity'],
            },
          },
          loop: { type: 'boolean', default: true },
        }, required: ['channel', 'steps'],
      },
    },
    handler({ channel, steps, loop }: { channel: string; steps: WaveStep[]; loop?: boolean }) {
      bt.designWave(channel, steps, loop !== false);
      return { channel, stepsCount: steps.length, loop: loop !== false };
    },
  },
  {
    def: {
      name: 'stop_wave',
      description: '停止波形输出',
      parameters: {
        type: 'object', properties: {
          channel: { ...CH, description: '指定通道，不填则停止所有' },
        },
      },
    },
    handler({ channel }) {
      bt.stopWave(channel || null);
      return { channel: channel || 'all' };
    },
  },
  {
    def: {
      name: 'get_status',
      description: '获取设备当前状态',
      parameters: { type: 'object', properties: {} },
    },
    handler() {
      return { ...bt.getStatus(), _hint: '状态已获取，请直接根据此结果回复用户，不要再次调用任何工具。' };
    },
  },
];

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const tools: ToolDef[] = registry.map((t) => t.def);

const handlerMap = new Map(registry.map((t) => [t.def.name, t.handler]));

export async function executeTool(name: string, args: Record<string, any>): Promise<string> {
  const handler = handlerMap.get(name);
  if (!handler) return JSON.stringify({ error: `Unknown tool: ${name}` });

  try {
    const result = handler(args);
    const isGetStatus = name === 'get_status';
    return JSON.stringify({
      success: true,
      ...result,
      ...(!isGetStatus && { deviceState: snap(), _hint: '以上 deviceState 是设备当前真实状态，请根据此状态回复用户。' }),
    });
  } catch (err: unknown) {
    console.error(`[tools] ${name}:`, err);
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}
