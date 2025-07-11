/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react-hooks';
import { useGeminiStream } from './useGeminiStream';
import {
  Config,
  GeminiClient,
  GeminiEventType,
  ServerGeminiToolCallRequestEvent,
  ServerGeminiToolCallResponseEvent,
  ToolCallRequestInfo,
} from '@google/gemini-cli-core';
import { Settings } from '../../config/settings';
import { MessageType, StreamingState } from '../types';

vi.mock('./useReactToolScheduler', () => ({
  useReactToolScheduler: vi.fn().mockImplementation((onComplete) => {
    // Mock scheduleToolCalls to immediately call onComplete for testing
    const scheduleToolCalls = async (toolCalls: ToolCallRequestInfo[]) => {
      // Simulate tool execution and completion
      const completedToolCalls = toolCalls.map((tc) => ({
        ...tc,
        status: 'success', // or 'error', 'cancelled' as needed
        response: { responseParts: [{ functionResponse: { name: tc.name, response: { success: true } } }] },
        responseSubmittedToGemini: false, // Simulate not yet submitted to Gemini
      }));
      await onComplete(completedToolCalls);
    };
    const markToolsAsSubmitted = vi.fn();
    return [
      [], // toolCalls (initial state)
      scheduleToolCalls,
      markToolsAsSubmitted,
    ];
  }),
}));


describe('useGeminiStream', () => {
  let mockGeminiClient: GeminiClient;
  let mockConfig: Config;
  let mockSettings: Settings;
  let mockAddItem: ReturnType<typeof vi.fn>;
  let mockSetShowHelp: ReturnType<typeof vi.fn>;
  let mockOnDebugMessage: ReturnType<typeof vi.fn>;
  let mockHandleSlashCommand: ReturnType<typeof vi.fn>;
  let mockGetPreferredEditor: ReturnType<typeof vi.fn>;
  let mockOnAuthError: ReturnType<typeof vi.fn>;
  let mockPerformMemoryRefresh: ReturnType<typeof vi.fn>;
  let mockSetModelSwitchedFromQuotaError: ReturnType<typeof vi.fn>;


  beforeEach(() => {
    mockGeminiClient = {
      sendMessageStream: vi.fn(),
      getHistory: vi.fn().mockResolvedValue([]),
      addHistory: vi.fn(),
    } as unknown as GeminiClient;

    mockSettings = {};
    mockConfig = new Config({
      sessionId: 'test-session',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);


    mockAddItem = vi.fn();
    mockSetShowHelp = vi.fn();
    mockOnDebugMessage = vi.fn();
    mockHandleSlashCommand = vi.fn().mockResolvedValue(false);
    mockGetPreferredEditor = vi.fn();
    mockOnAuthError = vi.fn();
    mockPerformMemoryRefresh = vi.fn().mockResolvedValue(undefined);
    mockSetModelSwitchedFromQuotaError = vi.fn();

    vi.clearAllMocks();
  });

  const mockToolCallRequestEvent = (
    callId: string,
    name: string,
    args: object,
  ): ServerGeminiToolCallRequestEvent => ({
    type: GeminiEventType.ToolCallRequest,
    value: {
      callId,
      name,
      args,
      isClientInitiated: false,
      prompt_id: 'test-prompt-id',
    },
  });

  const mockToolCallResponseEvent = (
    callId: string,
    name: string,
    response: object,
  ): ServerGeminiToolCallResponseEvent => ({
    type: GeminiEventType.ToolCallResponse,
    value: {
      callId,
      name,
      response,
      isClientInitiated: false,
      prompt_id: 'test-prompt-id',
    },
  });


  it('should add tool responses to history when hideMcpToolResponses is false (default)', async () => {
    mockConfig = new Config({
      sessionId: 'test-session',
      hideMcpToolResponses: false, // Explicitly set to default for clarity
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const mockStream = (async function* () {
      yield mockToolCallRequestEvent('call1', 'testTool', { arg1: 'val1' });
      // Simulate a delay or other events if necessary
      yield { type: GeminiEventType.Content, value: 'Thinking...' };
    })();
    mockGeminiClient.sendMessageStream = vi.fn().mockReturnValue(mockStream);


    const { result, waitForNextUpdate } = renderHook(() =>
      useGeminiStream(
        mockGeminiClient,
        [],
        mockAddItem,
        mockSetShowHelp,
        mockConfig,
        mockOnDebugMessage,
        mockHandleSlashCommand,
        false,
        mockGetPreferredEditor,
        mockOnAuthError,
        mockPerformMemoryRefresh,
        false,
        mockSetModelSwitchedFromQuotaError,
      ),
    );

    act(() => {
      result.current.submitQuery('test query');
    });

    await waitForNextUpdate(); // Wait for stream processing and tool completion

    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.TOOL_GROUP,
        tools: expect.arrayContaining([
          expect.objectContaining({
            name: 'testTool',
            status: 'success', // Assuming success from mockReactToolScheduler
          }),
        ]),
      }),
      expect.any(Number),
    );
  });

  it('should NOT add tool responses to history when hideMcpToolResponses is true', async () => {
    mockConfig = new Config({
      sessionId: 'test-session',
      hideMcpToolResponses: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const mockStream = (async function* () {
      yield mockToolCallRequestEvent('call2', 'anotherTool', { argX: 'valY' });
      yield { type: GeminiEventType.Content, value: 'Working on it...' };
    })();
    mockGeminiClient.sendMessageStream = vi.fn().mockReturnValue(mockStream);

    const { result, waitForNextUpdate } = renderHook(() =>
      useGeminiStream(
        mockGeminiClient,
        [],
        mockAddItem,
        mockSetShowHelp,
        mockConfig,
        mockOnDebugMessage,
        mockHandleSlashCommand,
        false,
        mockGetPreferredEditor,
        mockOnAuthError,
        mockPerformMemoryRefresh,
        false,
        mockSetModelSwitchedFromQuotaError,
      ),
    );

    act(() => {
      result.current.submitQuery('another test query');
    });

    await waitForNextUpdate();

    // Check that addItem was NOT called with a TOOL_GROUP message type
    expect(mockAddItem).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.TOOL_GROUP,
      }),
      expect.any(Number),
    );
    // It might be called for other message types (like USER, GEMINI, INFO, ERROR)
    // So we ensure it's not specifically the tool group.
    mockAddItem.mock.calls.forEach(call => {
      expect(call[0].type).not.toBe(MessageType.TOOL_GROUP);
    });
  });
});
