import { JsonStore } from './jsonStore';
import type { VoiceOption } from '../../shared/ipc';

interface SettingsData {
  voice: VoiceOption;
}

/** Local-first user preferences — never leaves the machine. */
export class SettingsStore {
  private readonly store: JsonStore<SettingsData>;

  constructor(dataDir: string) {
    this.store = new JsonStore<SettingsData>(dataDir, 'settings.json', { voice: 'en-US-female' });
  }

  getVoice(): VoiceOption {
    return this.store.read().voice;
  }

  setVoice(voice: VoiceOption): void {
    const data = this.store.read();
    data.voice = voice;
    this.store.write(data);
  }
}
