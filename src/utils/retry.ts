import * as vscode from "vscode";

export class VertexAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VertexAuthenticationError";
  }
}

export interface RetryLogEntry {
  attempt: number;
  delayMs: number;
  error: string;
  timestamp: string;
}

export interface RetryOptions {
  /** Base delay in milliseconds for exponential backoff (default: 2000) */
  baseDelayMs?: number;
  /** Maximum delay in milliseconds between retries (default: 30000) */
  maxDelayMs?: number;
  /** Optional logger function to output messages */
  log?: (msg: string) => void;
  /** Cancellation token to abort the retry loop early */
  token?: vscode.CancellationToken;
  /** Maximum total retry duration in milliseconds (default from settings or 30 minutes) */
  maxRetryDurationMs?: number;
  /** Time in milliseconds before a notification is shown for a long-running retry (default from settings or 1 minute) */
  warningThresholdMs?: number;
}

/**
 * Executes an async operation with automatic exponential backoff retries.
 * Designed to handle rate limits (429) and temporary service unavailabilities (503).
 *
 * @param operation The async function to execute.
 * @param options Configuration for the retry behavior.
 * @returns The result of the operation if successful.
 */
export async function withRetry<T>(operation: () => Promise<T>, options?: RetryOptions): Promise<T> {
  const baseDelayMs = options?.baseDelayMs ?? 2000;
  const maxDelayMs = options?.maxDelayMs ?? 30000;
  const maxRetryDurationMs = options?.maxRetryDurationMs ?? getRetryMaxDurationMsFromSettings();
  const warningThresholdMs = options?.warningThresholdMs ?? getRetryWarningThresholdMsFromSettings();

  let attempt = 0;
  const retryLog: RetryLogEntry[] = [];
  const startTime = Date.now();
  let warningShown = false;

  // We use a custom abort controller to stop the sleep early if the user cancels via progress UI
  const sleepAbortController = new AbortController();

  // Listen to the original cancellation token to abort sleep as well
  const tokenListener = options?.token?.onCancellationRequested(() => {
    sleepAbortController.abort();
  });

  try {
    while (true) {
      if (options?.token?.isCancellationRequested || sleepAbortController.signal.aborted) {
        throw new Error("Cancelled by user");
      }

      try {
        const result = await operation();
        logRetrySummary(true, attempt, retryLog, undefined, options?.log);
        return result;
      } catch (e: any) {
        const elapsedMs = Date.now() - startTime;
        if (!isRetryableError(e) || elapsedMs >= maxRetryDurationMs) {
          logRetrySummary(false, attempt, retryLog, e, options?.log);
          throw e;
        }

        attempt++;
        const delayMs = calculateDelay(attempt, baseDelayMs, maxDelayMs);
        const timeLeftMs = Math.max(0, maxRetryDurationMs - elapsedMs);
        const actualDelayMs = Math.min(delayMs, timeLeftMs);

        if (actualDelayMs <= 0) {
          logRetrySummary(false, attempt, retryLog, e, options?.log);
          throw e;
        }

        handleRetryAttempt(attempt, actualDelayMs, e, retryLog, options?.log);

        // Show progress warning if threshold is reached
        if (elapsedMs >= warningThresholdMs && !warningShown) {
          warningShown = true;
          // Wrap the REST of the retry loop in the progress notification
          return await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: "Vertex AI Models Chat Provider",
              cancellable: true,
            },
            async (progress, progressToken) => {
              progressToken.onCancellationRequested(() => {
                sleepAbortController.abort();
              });

              progress.report({
                message: `The request has been failing for an extended time. Retrying for up to ${Math.round((maxRetryDurationMs - elapsedMs) / 60000)} minutes...`,
              });

              try {
                await sleep(actualDelayMs, sleepAbortController.signal);
              } catch (sleepError: any) {
                if (sleepError.name === "AbortError") {
                  throw new Error("Cancelled by user");
                }
                throw sleepError;
              }

              // Continue the loop inside the withProgress wrapper
              while (true) {
                if (options?.token?.isCancellationRequested || progressToken.isCancellationRequested || sleepAbortController.signal.aborted) {
                  throw new Error("Cancelled by user");
                }

                try {
                  const result = await operation();
                  logRetrySummary(true, attempt, retryLog, undefined, options?.log);
                  return result;
                } catch (e2: any) {
                  const elapsedMs2 = Date.now() - startTime;
                  if (!isRetryableError(e2) || elapsedMs2 >= maxRetryDurationMs) {
                    logRetrySummary(false, attempt, retryLog, e2, options?.log);
                    throw e2;
                  }

                  attempt++;
                  const delayMs2 = calculateDelay(attempt, baseDelayMs, maxDelayMs);
                  const timeLeftMs2 = Math.max(0, maxRetryDurationMs - elapsedMs2);
                  const actualDelayMs2 = Math.min(delayMs2, timeLeftMs2);

                  if (actualDelayMs2 <= 0) {
                    logRetrySummary(false, attempt, retryLog, e2, options?.log);
                    throw e2;
                  }

                  const remainingMinutes = Math.max(0, Math.round((maxRetryDurationMs - elapsedMs2) / 60000));
                  progress.report({
                    message: `Retrying... (up to ${remainingMinutes} minutes remaining)`,
                  });

                  handleRetryAttempt(attempt, actualDelayMs2, e2, retryLog, options?.log);

                  try {
                    await sleep(actualDelayMs2, sleepAbortController.signal);
                  } catch (sleepError: any) {
                    if (sleepError.name === "AbortError") {
                      throw new Error("Cancelled by user");
                    }
                    throw sleepError;
                  }
                }
              }
            }
          );
        } else {
          try {
            await sleep(actualDelayMs, sleepAbortController.signal);
          } catch (sleepError: any) {
            if (sleepError.name === "AbortError") {
               throw new Error("Cancelled by user");
            }
            throw sleepError;
          }
        }
      }
    }
  } finally {
    tokenListener?.dispose();
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException("Aborted", "AbortError"));
    }

    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    }

    signal?.addEventListener("abort", onAbort);
  });
}

function getRetryMaxDurationMsFromSettings(): number {
  const durationMinutes = vscode.workspace.getConfiguration("vertexAiChat").get<number>("retryMaxDurationMinutes", 30);
  return Math.max(1, durationMinutes) * 60_000;
}

function getRetryWarningThresholdMsFromSettings(): number {
  const thresholdMinutes = vscode.workspace.getConfiguration("vertexAiChat").get<number>("retryWarningThresholdMinutes", 1);
  return Math.max(1, thresholdMinutes) * 60_000;
}

function calculateDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  return Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1)) + Math.random() * 1000;
}

function logRetrySummary(success: boolean, attempt: number, retryLog: RetryLogEntry[], error: any, log?: (msg: string) => void) {
  if (attempt === 0 || !log) {
    return;
  }
  const message = success
    ? `✅ Operation succeeded after ${attempt} retries.`
    : `❌ Operation failed after ${attempt} retries. Final error: ${error.message || error}`;
  log(message);
  log(`   Retry history: ${JSON.stringify(retryLog, null, 2)}`);
}

function handleRetryAttempt(attempt: number, delayMs: number, e: any, retryLog: RetryLogEntry[], log?: (msg: string) => void) {
  const errorMsg = e.message || e.toString();
  retryLog.push({
    attempt,
    delayMs: Math.round(delayMs),
    error: errorMsg,
    timestamp: new Date().toISOString(),
  });

  if (log) {
    log(`⚠️ Retryable error encountered: "${errorMsg}". Retrying in ${Math.round(delayMs)}ms (attempt ${attempt})...`);
  }
}

// Native Node.js / Fetch network error codes that are safe to retry
const NETWORK_ERROR_CODES = new Set([
  "ECONNRESET", // Connection reset by peer
  "ETIMEDOUT", // Operation timeout
  "ECONNREFUSED", // Connection refused (e.g. server down)
  "ENOTFOUND", // DNS lookup failed
  "EAI_AGAIN", // Temporary DNS error
  "UND_ERR_CONNECT_TIMEOUT", // Undici/Node.js fetch specific timeout
]);

/**
 * Determines if an error is transient and should trigger a retry.
 * Matches common rate limiting (429) and server overload (502/503) patterns.
 */
export function isRetryableError(e: any): boolean {
  if (!e) {
    return false;
  }

  const msg = (e.message || e.toString()).toLowerCase();

  // 429 Too Many Requests / Resource Exhausted
  if (msg.includes("429") || msg.includes("too many requests") || msg.includes("resource_exhausted") || msg.includes("resource exhausted") || msg.includes("quota")) {
    return true;
  }

  // 503 Service Unavailable / 502 Bad Gateway
  if (msg.includes("503") || msg.includes("service unavailable") || msg.includes("overloaded") || msg.includes("502") || msg.includes("bad gateway")) {
    return true;
  }

  // Manage specific error messages that indicate transient issues (e.g. network problems, timeouts)
  if (
    msg.includes("fetch failed") ||
    msg.includes("network error") ||
    msg.includes("socket hang up") ||
    msg.includes("timeout") ||
    msg.includes("sorry, your request failed") // Common message from Google APIs under heavy load
  ) {
    return true;
  }

  // Check HTTP status codes
  if (e.status === 429 || e.status === 503 || e.status === 502 || e.status === "RESOURCE_EXHAUSTED" || e.code === 429 || e.code === 503 || e.code === 502) {
    return true;
  }

  // Check the main error code or the cause (if the error is wrapped)
  if (NETWORK_ERROR_CODES.has(e.code) || (e.cause && NETWORK_ERROR_CODES.has(e.cause.code))) {
    return true;
  }

  return false;
}

/**
 * Checks if an error is authentication-related (e.g. invalid ADC credentials)
 * and if so, throws a user-friendly error instructing them to re-authenticate.
 */
export function checkAuthError(e: any): void {
  if (!e) {
    return;
  }

  const msg = (e.message || e.toString()).toLowerCase();
  if (msg.includes("invalid_grant") || msg.includes("invalid_rapt") || msg.includes("could not load the default credentials") || msg.includes("reauth related error") || e.status === 401 || e.code === 401) {
    throw new VertexAuthenticationError("Google Cloud credentials have expired or are invalid. Please run 'gcloud auth application-default login' in your terminal.");
  }
}
