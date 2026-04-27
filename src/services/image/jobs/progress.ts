export interface ProgressEvent {
  value: number;
  max: number;
}

/**
 * Per-backend progress + cancel adapter. Created by the runner before
 * dispatch; subscribed for the duration of the backend call. Cancel is
 * idempotent and safe to call after `dispose`.
 */
export interface JobProgress {
  /** Subscribe to events. Returns the disposer. */
  subscribe(onEvent: (e: ProgressEvent) => void): () => void;
  /** Send an interrupt request to the backend. */
  cancel(): Promise<void>;
  /** Tear down the underlying connection. Idempotent. */
  dispose(): void;
}
