/**
 * Resilient Clipboard Utilities (M4-T07 / SCR-CUST-08)
 *
 * Specifications:
 *   - docs/UI_UX.md (v1.1) §7.8 (SCR-CUST-08)
 *   - docs/PRD.md (v1.1) FR-CUST-007
 *   - docs/TEST_PLAN.md (v1.1) TC-CUST-14, TC-CUST-15, TC-MOB-03
 *
 * Implements safe, customer-initiated clipboard copy with defensive exception handling,
 * in-flight double-click guards, and zero persistent storage of review drafts.
 */

export type ClipboardErrorCode =
  | 'EMPTY_TEXT'
  | 'UNSUPPORTED'
  | 'NOT_ALLOWED'
  | 'OPERATION_IN_FLIGHT'
  | 'UNKNOWN';

export interface ClipboardCopySuccess {
  success: true;
}

export interface ClipboardCopyFailure {
  success: false;
  code: ClipboardErrorCode;
  message: string;
}

export type ClipboardCopyResult = ClipboardCopySuccess | ClipboardCopyFailure;

let isCopyInFlight = false;

/**
 * Resets the in-flight lock. Intended for test suite teardown.
 */
export function _resetClipboardInFlight(): void {
  isCopyInFlight = false;
}

/**
 * Copies customer-approved review text to the system clipboard using navigator.clipboard.writeText.
 *
 * Requirements:
 * - Must be called following explicit user gesture (click/tap).
 * - Empty or whitespace-only text is rejected immediately.
 * - Concurrency lock prevents concurrent/duplicate copy dispatches.
 * - Handles missing clipboard API, PermissionDenied/NotAllowedError, and generic rejections.
 * - Preserves Unicode, emojis, newlines, and punctuation without corruption.
 * - Never modifies the input draft text.
 * - Zero persistence to localStorage, sessionStorage, or remote telemetry.
 */
export async function copyTextToClipboard(text?: string | null): Promise<ClipboardCopyResult> {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return {
      success: false,
      code: 'EMPTY_TEXT',
      message: 'Cannot copy empty or whitespace-only text.',
    };
  }

  if (isCopyInFlight) {
    return {
      success: false,
      code: 'OPERATION_IN_FLIGHT',
      message: 'A clipboard copy operation is already in progress.',
    };
  }

  isCopyInFlight = true;

  try {
    // 1. Verify availability of the browser Clipboard API
    if (
      typeof navigator === 'undefined' ||
      !navigator.clipboard ||
      typeof navigator.clipboard.writeText !== 'function'
    ) {
      return {
        success: false,
        code: 'UNSUPPORTED',
        message: 'System clipboard API is not supported in this browser environment.',
      };
    }

    // 2. Perform native asynchronous clipboard write
    await navigator.clipboard.writeText(text);

    return { success: true };
  } catch (err) {
    const errorName = err instanceof Error ? err.name : '';
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Differentiate explicit permission denials from unknown environment errors
    if (errorName === 'NotAllowedError' || /permission|denied|not allowed/i.test(errorMessage)) {
      return {
        success: false,
        code: 'NOT_ALLOWED',
        message: 'Clipboard write permission was denied by the browser.',
      };
    }

    return {
      success: false,
      code: 'UNKNOWN',
      message: errorMessage || 'An unexpected error occurred while writing to the clipboard.',
    };
  } finally {
    isCopyInFlight = false;
  }
}

