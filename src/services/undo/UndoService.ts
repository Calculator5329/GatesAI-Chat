// Session-scoped command history for reversible destructive actions.
// Commands own their inverse; persistence remains the responsibility of the
// store that registers them.

export interface UndoCommand {
  label: string;
  undo: () => void;
}

export interface UndoSnapshot {
  canUndo: boolean;
  nextLabel: string | null;
  eventId: number;
  event: 'registered' | 'undone' | 'cleared' | null;
}

const DEFAULT_MAX_DEPTH = 20;

export class UndoService {
  private readonly commands: UndoCommand[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly maxDepth: number;
  private eventId = 0;
  private snapshot: UndoSnapshot = {
    canUndo: false,
    nextLabel: null,
    eventId: 0,
    event: null,
  };

  constructor(maxDepth = DEFAULT_MAX_DEPTH) {
    if (!Number.isInteger(maxDepth) || maxDepth < 1) {
      throw new Error('Undo stack depth must be a positive integer.');
    }
    this.maxDepth = maxDepth;
  }

  register(command: UndoCommand): void {
    this.commands.push(command);
    if (this.commands.length > this.maxDepth) this.commands.shift();
    this.publish('registered');
  }

  undo(): boolean {
    const command = this.commands.pop();
    if (!command) return false;
    try {
      command.undo();
    } catch (error) {
      this.commands.push(command);
      this.publish('registered');
      throw error;
    }
    this.publish('undone');
    return true;
  }

  clear(): void {
    if (this.commands.length === 0) return;
    this.commands.length = 0;
    this.publish('cleared');
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): UndoSnapshot => this.snapshot;

  private publish(event: UndoSnapshot['event']): void {
    this.eventId += 1;
    this.snapshot = {
      canUndo: this.commands.length > 0,
      nextLabel: this.commands.at(-1)?.label ?? null,
      eventId: this.eventId,
      event,
    };
    this.listeners.forEach(listener => listener());
  }
}
