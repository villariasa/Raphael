import { JsonStore } from './jsonStore';
import type { VoiceOption, UiSettings } from '../../shared/ipc';
import { DEFAULT_UI_SETTINGS } from '../../shared/ipc';

interface SettingsData {
  voice: VoiceOption;
  micEnabled: boolean;
  ui: UiSettings;
}

/** Local-first user preferences — never leaves the machine. */
export class SettingsStore {
  private readonly store: JsonStore<SettingsData>;

  constructor(dataDir: string) {
    this.store = new JsonStore<SettingsData>(dataDir, 'settings.json', {
      voice: 'en-US-female',
      micEnabled: false,
      ui: { ...DEFAULT_UI_SETTINGS }
    });
  }

  getUiSettings(): UiSettings {
    // Merge over defaults so older settings files without `ui` still work.
    return { ...DEFAULT_UI_SETTINGS, ...(this.store.read().ui ?? {}) };
  }

  setUiSettings(patch: Partial<UiSettings>): UiSettings {
    const data = this.store.read();
    const next = { ...DEFAULT_UI_SETTINGS, ...(data.ui ?? {}), ...patch };
    data.ui = next;
    this.store.write(data);
    return next;
  }

  getVoice(): VoiceOption {
    return this.store.read().voice;
  }

  setVoice(voice: VoiceOption): void {
    const data = this.store.read();
    data.voice = voice;
    this.store.write(data);
  }

  getMicEnabled(): boolean {
    return !!this.store.read().micEnabled;
  }

  setMicEnabled(enabled: boolean): void {
    const data = this.store.read();
    data.micEnabled = enabled;
    this.store.write(data);
  }
}
