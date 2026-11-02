import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  copyTextToClipboard,
  copyReviewDraftWithTelemetry,
  _resetClipboardInFlight,
} from './clipboard';
import * as analyticsModule from './api/analytics';

describe('Clipboard Utility (M4-T07 / SCR-CUST-08)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetClipboardInFlight();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetClipboardInFlight();
  });

  describe('copyTextToClipboard', () => {
    it('rejects empty, whitespace-only, or invalid inputs with EMPTY_TEXT', async () => {
      expect(await copyTextToClipboard('')).toEqual({
        success: false,
        code: 'EMPTY_TEXT',
        message: 'Cannot copy empty or whitespace-only text.',
      });

      expect(await copyTextToClipboard('   \t\n  ')).toEqual({
        success: false,
        code: 'EMPTY_TEXT',
        message: 'Cannot copy empty or whitespace-only text.',
      });

      expect(await copyTextToClipboard(null)).toEqual({
        success: false,
        code: 'EMPTY_TEXT',
        message: 'Cannot copy empty or whitespace-only text.',
      });

      expect(await copyTextToClipboard(undefined)).toEqual({
        success: false,
        code: 'EMPTY_TEXT',
        message: 'Cannot copy empty or whitespace-only text.',
      });
    });

    it('copies exact customer-approved text and resolves with success', async () => {
      const draft = 'Amazing haircut and great latte! Stylist Rahul paid careful attention to detail.';
      const writeTextSpy = vi.fn().mockResolvedValue(undefined);

      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextSpy },
        configurable: true,
        writable: true,
      });

      const result = await copyTextToClipboard(draft);

      expect(result).toEqual({ success: true });
      expect(writeTextSpy).toHaveBeenCalledTimes(1);
      expect(writeTextSpy).toHaveBeenCalledWith(draft);
    });

    it('preserves emojis, Unicode characters, and multiline line breaks without modification', async () => {
      const complexDraft = 'Loved the fade 💇‍♂️ and coffee ☕️!\n\nSpotless stations and friendly staff ✨';
      const writeTextSpy = vi.fn().mockResolvedValue(undefined);

      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextSpy },
        configurable: true,
        writable: true,
      });

      const result = await copyTextToClipboard(complexDraft);

      expect(result).toEqual({ success: true });
      expect(writeTextSpy).toHaveBeenCalledWith(complexDraft);
    });

    it('returns UNSUPPORTED when navigator.clipboard is unavailable', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined,
        configurable: true,
        writable: true,
      });

      const result = await copyTextToClipboard('Valid draft text');

      expect(result).toEqual({
        success: false,
        code: 'UNSUPPORTED',
        message: 'System clipboard API is not supported in this browser environment.',
      });
    });

    it('returns NOT_ALLOWED when browser throws NotAllowedError', async () => {
      const notAllowedErr = new Error('Permission denied');
      notAllowedErr.name = 'NotAllowedError';

      const writeTextSpy = vi.fn().mockRejectedValue(notAllowedErr);

      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextSpy },
        configurable: true,
        writable: true,
      });

      const result = await copyTextToClipboard('Valid draft text');

      expect(result).toEqual({
        success: false,
        code: 'NOT_ALLOWED',
        message: 'Clipboard write permission was denied by the browser.',
      });
    });

    it('returns UNKNOWN on generic unexpected rejection', async () => {
      const genericErr = new Error('Unexpected OS clipboard lock failure');
      const writeTextSpy = vi.fn().mockRejectedValue(genericErr);

      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextSpy },
        configurable: true,
        writable: true,
      });

      const result = await copyTextToClipboard('Valid draft text');

      expect(result).toEqual({
        success: false,
        code: 'UNKNOWN',
        message: 'Unexpected OS clipboard lock failure',
      });
    });

    it('prevents duplicate concurrent copy operations while one is pending', async () => {
      let resolveFirstPromise!: () => void;
      const pendingPromise = new Promise<void>((resolve) => {
        resolveFirstPromise = resolve;
      });

      const writeTextSpy = vi.fn().mockReturnValue(pendingPromise);

      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextSpy },
        configurable: true,
        writable: true,
      });

      // Start first copy (in-flight)
      const firstCallPromise = copyTextToClipboard('First draft');

      // Attempt second concurrent copy immediately
      const secondCallResult = await copyTextToClipboard('Second draft');

      expect(secondCallResult).toEqual({
        success: false,
        code: 'OPERATION_IN_FLIGHT',
        message: 'A clipboard copy operation is already in progress.',
      });

      // Resolve first
      resolveFirstPromise();
      const firstResult = await firstCallPromise;
      expect(firstResult).toEqual({ success: true });

      // Now a third call should succeed
      writeTextSpy.mockResolvedValueOnce(undefined);
      const thirdResult = await copyTextToClipboard('Third draft');
      expect(thirdResult).toEqual({ success: true });
    });
  });

  describe('copyReviewDraftWithTelemetry', () => {
    const context = {
      publicQrId: 'luxe000001',
      sessionUuid: '11111111-2222-3333-8888-999999999999',
    };

    it('emits EVENT_COPY_ATTEMPTED and EVENT_COPY_SUCCESS on successful copy without leaking draft text', async () => {
      const draft = 'Clean, authentic customer review.';
      const writeTextSpy = vi.fn().mockResolvedValue(undefined);
      const trackEventSpy = vi.spyOn(analyticsModule, 'trackEvent').mockResolvedValue({
        status: 'accepted',
      });

      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextSpy },
        configurable: true,
        writable: true,
      });

      const result = await copyReviewDraftWithTelemetry(draft, context);

      expect(result).toEqual({ success: true });
      expect(writeTextSpy).toHaveBeenCalledWith(draft);

      // Verify EVENT_COPY_ATTEMPTED and EVENT_COPY_SUCCESS were emitted
      expect(trackEventSpy).toHaveBeenCalledTimes(2);
      expect(trackEventSpy).toHaveBeenNthCalledWith(1, {
        publicQrId: context.publicQrId,
        eventName: 'EVENT_COPY_ATTEMPTED',
        sessionUuid: context.sessionUuid,
      });
      expect(trackEventSpy).toHaveBeenNthCalledWith(2, {
        publicQrId: context.publicQrId,
        eventName: 'EVENT_COPY_SUCCESS',
        sessionUuid: context.sessionUuid,
      });

      // Assert draft text is strictly NOT in any analytics payload
      const payloads = JSON.stringify(trackEventSpy.mock.calls);
      expect(payloads).not.toContain(draft);
    });

    it('emits EVENT_COPY_ATTEMPTED but NEVER emits EVENT_COPY_SUCCESS on clipboard write failure', async () => {
      const trackEventSpy = vi.spyOn(analyticsModule, 'trackEvent').mockResolvedValue({
        status: 'accepted',
      });

      const notAllowedErr = new Error('Permission denied');
      notAllowedErr.name = 'NotAllowedError';

      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockRejectedValue(notAllowedErr) },
        configurable: true,
        writable: true,
      });

      const result = await copyReviewDraftWithTelemetry('Valid draft', context);

      expect(result.success).toBe(false);

      // Only EVENT_COPY_ATTEMPTED emitted, NOT EVENT_COPY_SUCCESS
      expect(trackEventSpy).toHaveBeenCalledTimes(1);
      expect(trackEventSpy).toHaveBeenCalledWith({
        publicQrId: context.publicQrId,
        eventName: 'EVENT_COPY_ATTEMPTED',
        sessionUuid: context.sessionUuid,
      });
    });

    it('does not fail clipboard copy if telemetry tracking throws or rejects', async () => {
      vi.spyOn(analyticsModule, 'trackEvent').mockRejectedValue(new Error('Network error'));

      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
        configurable: true,
        writable: true,
      });

      const result = await copyReviewDraftWithTelemetry('Valid draft', context);

      expect(result).toEqual({ success: true });
    });
  });
});
