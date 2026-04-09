/**
 * agent/conversation.ts — Conversation state and message orchestration.
 * Uses ConversationItem[] as native state, mapping directly to Responses API input.
 */

import type { ConversationItem, ConversationRecord } from '../types';
import { getItemText } from '../types';
import * as history from './history';
import { buildSystemPrompt } from './prompts';
import { chat } from './ai-service';
import { tools, executeTool } from './tools';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const conversationItems: ConversationItem[] = [];
let currentConversation: ConversationRecord | null = null;
let isProcessing = false;
let activePresetId = 'gentle';

const MAX_ITEMS = 200;

// ---------------------------------------------------------------------------
// Callbacks — UI layer registers these
// ---------------------------------------------------------------------------

export interface ConversationCallbacks {
  onUserMessage: (text: string) => void;
  onAssistantStream: (text: string, msgId?: string) => string;
  onAssistantFinalize: (msgId: string) => void;
  onToolCall: (name: string, args: Record<string, unknown>, result: string) => void;
  onTypingStart: () => void;
  onTypingEnd: () => void;
  onError: (message: string) => void;
  onHistoryChange: () => void;
}

let callbacks: ConversationCallbacks | null = null;

export function registerCallbacks(cb: ConversationCallbacks): void {
  callbacks = cb;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getHistory(): readonly ConversationItem[] {
  return conversationItems;
}

export function getCurrentConversation(): ConversationRecord | null {
  return currentConversation;
}

export function getActivePresetId(): string {
  return activePresetId;
}

export function setActivePresetId(id: string): void {
  activePresetId = id;
}

export function getIsProcessing(): boolean {
  return isProcessing;
}

export function loadConversation(conv: ConversationRecord): void {
  conversationItems.length = 0;
  currentConversation = conv;
  activePresetId = conv.presetId || 'gentle';

  for (const item of conv.items) {
    conversationItems.push(item);
  }
}

export function startNewConversation(): void {
  conversationItems.length = 0;
  currentConversation = null;
}

/**
 * Send a user message: orchestrates AI call, tool execution, streaming.
 */
export async function sendMessage(text: string, customPrompt: string): Promise<void> {
  if (isProcessing || !callbacks) return;
  isProcessing = true;

  callbacks.onUserMessage(text);
  conversationItems.push({ role: 'user', content: text });

  if (!currentConversation) {
    currentConversation = history.createConversation(activePresetId);
  }

  callbacks.onTypingStart();
  let currentMsgId: string | null = null;
  let streamedText = '';

  try {
    const systemPrompt = buildSystemPrompt(activePresetId, customPrompt);

    const newItems = await chat(
      conversationItems,
      systemPrompt,
      tools,
      {
        onToolCall: async (toolName: string, toolArgs: Record<string, unknown>) => {
          callbacks!.onTypingEnd();
          if (streamedText && currentMsgId) {
            callbacks!.onAssistantFinalize(currentMsgId);
            streamedText = '';
            currentMsgId = null;
          }
          let result: string;
          try {
            result = await executeTool(toolName, toolArgs);
          } catch (err: any) {
            result = JSON.stringify({ error: err.message });
          }
          callbacks!.onToolCall(toolName, toolArgs, result);
          callbacks!.onTypingStart();
          return result;
        },
        onStreamText: (chunk: string) => {
          callbacks!.onTypingEnd();
          streamedText += chunk;
          currentMsgId = callbacks!.onAssistantStream(streamedText, currentMsgId || undefined);
        },
      },
    );

    callbacks.onTypingEnd();

    // Append all new items to conversation state
    conversationItems.push(...newItems);

    console.log('[Current context]', JSON.parse(JSON.stringify(conversationItems)));

    // Extract final assistant text for UI finalization
    const lastAssistant = [...newItems].reverse().find((item) => {
      const display = getItemText(item);
      return display?.role === 'assistant';
    });
    const finalText = streamedText || (lastAssistant ? getItemText(lastAssistant)?.text : '') || '';

    if (finalText) {
      if (!currentMsgId) {
        currentMsgId = callbacks.onAssistantStream(finalText, undefined);
      }
      callbacks.onAssistantFinalize(currentMsgId);
    }
  } catch (err: any) {
    callbacks.onTypingEnd();
    callbacks.onError(err.message || String(err));
  } finally {
    isProcessing = false;

    if (currentConversation) {
      currentConversation.items = [...conversationItems];
      currentConversation.title = history.generateTitle(conversationItems);
      currentConversation.updatedAt = Date.now();
      history.saveConversation(currentConversation);
      callbacks?.onHistoryChange();
    }

    pruneItems();
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function pruneItems(): void {
  if (conversationItems.length <= MAX_ITEMS) return;
  // Find a safe cut point that doesn't split function_call / function_call_output pairs
  let cut = conversationItems.length - MAX_ITEMS;
  while (cut < conversationItems.length) {
    const item = conversationItems[cut] as any;
    if (item.type === 'function_call' || item.type === 'function_call_output') {
      cut++;
    } else {
      break;
    }
  }
  if (cut > 0) conversationItems.splice(0, cut);
}
