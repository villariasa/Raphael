import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';
import type { OllamaProvider } from './ollama';
import type { AiSetupProgress } from '../../../shared/ipc';

const execFileAsync = promisify(execFile);

export class OllamaManager {
  private currentProgress: AiSetupProgress = {
    stage: 'idle',
    message: 'Initializing AI runtime...'
  };
  private progressListeners: ((progress: AiSetupProgress) => void)[] = [];
  private setupPromise: Promise<boolean> | null = null;

  constructor(
    private readonly ollama: OllamaProvider,
    private readonly targetModel: string = 'llama3.2'
  ) {}

  onProgress(listener: (progress: AiSetupProgress) => void): () => void {
    this.progressListeners.push(listener);
    listener(this.currentProgress);
    return () => {
      this.progressListeners = this.progressListeners.filter((l) => l !== listener);
    };
  }

  getProgress(): AiSetupProgress {
    return this.currentProgress;
  }

  private setProgress(progress: Partial<AiSetupProgress> & { stage: AiSetupProgress['stage']; message: string }): void {
    this.currentProgress = {
      model: this.targetModel,
      ...progress
    };
    for (const listener of this.progressListeners) {
      try {
        listener(this.currentProgress);
      } catch {
        // ignore listener errors
      }
    }
  }

  async findOllamaExecutable(): Promise<string | null> {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const p = path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe');
      if (fs.existsSync(p)) return p;
    }

    const programFiles = process.env.ProgramFiles;
    if (programFiles) {
      const p = path.join(programFiles, 'Ollama', 'ollama.exe');
      if (fs.existsSync(p)) return p;
    }

    try {
      const { stdout } = await execFileAsync('where.exe', ['ollama']);
      const firstLine = stdout.trim().split(/\r?\n/)[0]?.trim();
      if (firstLine && fs.existsSync(firstLine)) return firstLine;
    } catch {
      // not in PATH
    }

    return null;
  }

  async downloadAndInstallOllama(): Promise<boolean> {
    this.setProgress({
      stage: 'installing_ollama',
      message: 'Downloading Ollama installer...',
      percent: 0
    });

    const tempDir = os.tmpdir();
    const installerPath = path.join(tempDir, 'OllamaSetup.exe');

    try {
      const response = await fetch('https://ollama.com/download/OllamaSetup.exe');
      if (!response.ok || !response.body) {
        throw new Error(`Failed to download OllamaSetup.exe: ${response.status} ${response.statusText}`);
      }

      const totalBytes = Number(response.headers.get('content-length') || '0');
      let downloadedBytes = 0;
      const fileStream = fs.createWriteStream(installerPath);

      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          downloadedBytes += value.length;
          fileStream.write(Buffer.from(value));
          if (totalBytes > 0) {
            const percent = Math.round((downloadedBytes / totalBytes) * 100);
            this.setProgress({
              stage: 'installing_ollama',
              message: `Downloading Ollama (${percent}%)...`,
              percent
            });
          }
        }
      }
      fileStream.end();

      await new Promise<void>((resolve, reject) => {
        fileStream.on('finish', resolve);
        fileStream.on('error', reject);
      });

      this.setProgress({
        stage: 'installing_ollama',
        message: 'Installing Ollama silently...',
        percent: 100
      });

      // Run Inno Setup installer silently
      await execFileAsync(installerPath, ['/SP-', '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], {
        windowsHide: true,
        timeout: 120000
      });

      // Cleanup installer
      try {
        fs.unlinkSync(installerPath);
      } catch {
        // ignore cleanup error
      }

      return true;
    } catch (err: any) {
      this.setProgress({
        stage: 'error',
        message: `Failed to install Ollama: ${err.message}`,
        error: err.message
      });
      return false;
    }
  }

  async startOllamaProcess(): Promise<boolean> {
    let exePath = await this.findOllamaExecutable();
    if (!exePath) {
      const installed = await this.downloadAndInstallOllama();
      if (!installed) return false;
      exePath = await this.findOllamaExecutable();
    }

    if (!exePath) {
      this.setProgress({
        stage: 'error',
        message: 'Ollama executable not found after setup.',
        error: 'Binary not found'
      });
      return false;
    }

    this.setProgress({
      stage: 'starting',
      message: 'Starting Ollama service...'
    });

    try {
      const proc = spawn(exePath, ['serve'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      proc.unref();
    } catch (err: any) {
      this.setProgress({
        stage: 'error',
        message: `Could not start Ollama: ${err.message}`,
        error: err.message
      });
      return false;
    }

    // Wait for Ollama to become reachable
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await this.ollama.isReachable()) {
        return true;
      }
    }

    this.setProgress({
      stage: 'error',
      message: 'Ollama service did not respond in time.',
      error: 'Timeout waiting for Ollama'
    });
    return false;
  }

  async ensureModelAvailable(): Promise<boolean> {
    const models = await this.ollama.listModels();
    const hasModel = models.some(
      (m) => m === this.targetModel || m === `${this.targetModel}:latest` || m.startsWith(`${this.targetModel}:`)
    );

    if (hasModel) {
      this.setProgress({
        stage: 'ready',
        message: `Model ${this.targetModel} is ready.`
      });
      return true;
    }

    this.setProgress({
      stage: 'downloading_model',
      message: `Downloading ${this.targetModel} AI model (~2.0 GB)...`,
      percent: 0
    });

    try {
      const res = await fetch(`${this.ollama.getBaseUrl()}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.targetModel, stream: true })
      });

      if (!res.ok || !res.body) {
        throw new Error(`Ollama model pull request failed: ${res.status} ${res.statusText}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (data.total && data.completed) {
              const percent = Math.round((data.completed / data.total) * 100);
              this.setProgress({
                stage: 'downloading_model',
                message: `Downloading ${this.targetModel} (${percent}%)...`,
                percent
              });
            } else if (data.status) {
              this.setProgress({
                stage: 'downloading_model',
                message: `${data.status}...`
              });
            }
          } catch {
            // ignore non-json chunk
          }
        }
      }

      this.setProgress({
        stage: 'ready',
        message: `Model ${this.targetModel} downloaded and ready.`
      });
      return true;
    } catch (err: any) {
      this.setProgress({
        stage: 'error',
        message: `Failed to download model ${this.targetModel}: ${err.message}`,
        error: err.message
      });
      return false;
    }
  }

  async setup(): Promise<boolean> {
    if (this.setupPromise) {
      return this.setupPromise;
    }

    this.setupPromise = (async () => {
      let reachable = await this.ollama.isReachable();
      if (!reachable) {
        reachable = await this.startOllamaProcess();
      }

      if (!reachable) {
        return false;
      }

      const modelReady = await this.ensureModelAvailable();
      return modelReady;
    })().finally(() => {
      this.setupPromise = null;
    });

    return this.setupPromise;
  }
}
