// Owns version-change disclosure state and its persisted acknowledgement.
// Called by RootStore and the what's-new panel; depends on storage/core data only.
import { makeAutoObservable } from 'mobx';
import appPackage from '../../package.json';
import { whatsNewForVersion, type WhatsNewRelease } from '../whatsNew';
import { whatsNewPersistence, type WhatsNewSnapshot } from '../services/storage/whatsNewStorage';
import type { PersistenceProvider } from '../services/storage/persistenceProvider';

export interface WhatsNewStoreOptions {
  version?: string;
  persistence?: PersistenceProvider<WhatsNewSnapshot>;
}

/**
 * Shows release notes once after an upgrade. A first-ever launch records its
 * version without interrupting the user, while an upgrade stays visible until
 * they dismiss it.
 */
export class WhatsNewStore {
  release: WhatsNewRelease | null = null;
  /** True only while constructing the first-ever local app state. */
  isFirstRun: boolean;
  /** Independent from chat history so a deleted tour is never recreated. */
  tourThreadSeeded: boolean;
  private readonly version: string;
  private readonly persistence: PersistenceProvider<WhatsNewSnapshot>;

  constructor(options: WhatsNewStoreOptions = {}) {
    this.version = options.version ?? appPackage.version;
    this.persistence = options.persistence ?? whatsNewPersistence;

    const snapshot = this.persistence.load();
    const lastSeenVersion = snapshot.lastSeenVersion;
    this.isFirstRun = !lastSeenVersion;
    this.tourThreadSeeded = snapshot.tourThreadSeeded === true;
    if (!lastSeenVersion) {
      this.persistence.save({ lastSeenVersion: this.version });
    } else if (lastSeenVersion !== this.version) {
      this.release = whatsNewForVersion(this.version) ?? {
        version: this.version,
        items: [{
          title: 'GatesAI Chat has been updated',
          detail: `You are now running version ${this.version}.`,
        }],
      };
    }

    makeAutoObservable<this, 'version' | 'persistence'>(this, {
      version: false,
      persistence: false,
    }, { autoBind: true });
  }

  get isOpen(): boolean {
    return this.release !== null;
  }

  dismiss(): void {
    if (!this.release) return;
    this.persistence.save({ lastSeenVersion: this.version });
    this.release = null;
  }

  markTourThreadSeeded(): void {
    if (this.tourThreadSeeded) return;
    this.persistence.save({ lastSeenVersion: this.version, tourThreadSeeded: true });
    this.tourThreadSeeded = true;
  }
}
