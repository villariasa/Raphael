import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import type { VoiceOption } from '../../../shared/ipc';
import { localizeToJapaneseLady } from './japaneseVoiceLocalizer';

export type TtsResult =
  | { ok: true; buffer: Buffer; mime: string }
  | { ok: false; reason: string };

function run(cmd: string, args: string[], input?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${cmd} exited with code ${code}`));
    });
    if (input !== undefined) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

/**
 * Real OS-level TTS → WAV, no third-party service, no fabricated audio.
 * Picks the platform's native synthesizer. If none is available on this
 * host, returns ok:false so the caller can surface that honestly instead
 * of faking a waveform.
 */
export class TtsManager {
  private installedPys = new Set<string>();

  private async ensureEdgeTts(py: string): Promise<void> {
    if (this.installedPys.has(py)) return;
    this.installedPys.add(py);
    try {
      await run(py, ['-m', 'pip', 'install', 'edge-tts']);
    } catch {}
  }

  async synthesizeToWav(text: string, voice: VoiceOption = 'en-US-female'): Promise<TtsResult> {
    // Strip control chars/newlines and cap length before this text reaches
    // any synthesizer — it may originate from LLM output, not just the user.
    const clean = text.trim().replace(/[\x00-\x09\x0b-\x1f\x7f]/g, ' ').slice(0, 2000);
    if (!clean) return { ok: false, reason: 'Empty text.' };

    const tmpFile = path.join(os.tmpdir(), `raphael-tts-${crypto.randomUUID()}.wav`);

    // 1. Try high-quality Neural TTS (edge-tts) for Japanese lady and English
    const isJapanese = voice === 'ja-JP-female' || /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(clean);
    let speechText = clean;
    if (isJapanese) {
      speechText = await localizeToJapaneseLady(clean);
    }
    const neuralVoice = isJapanese ? 'ja-JP-NanamiNeural' : 'en-US-JennyNeural';
    const neuralTmp = path.join(os.tmpdir(), `raphael-neural-${crypto.randomUUID()}.mp3`);

    const pythonCandidates = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
    for (const py of pythonCandidates) {
      try {
        await run(py, ['-m', 'edge_tts', '--voice', neuralVoice, '--text', speechText, '--write-media', neuralTmp]);
        const buffer = await fs.readFile(neuralTmp);
        fs.unlink(neuralTmp).catch(() => {});
        if (buffer && buffer.length > 100) {
          return { ok: true, buffer, mime: 'audio/mp3' };
        }
      } catch {
        // Try installing edge-tts if not yet present, then try next candidate
        this.ensureEdgeTts(py).catch(() => {});
      }
    }

    try {
      if (process.platform === 'win32') {
        const escaped = speechText.replace(/'/g, "''");
        const culture = voice === 'ja-JP-female' ? 'ja-JP' : 'en-US';
        const script = [
          'Add-Type -AssemblyName System.Speech;',
          '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;',
          `try { $synth.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::Female, [System.Speech.Synthesis.VoiceAge]::NotSet, 0, (New-Object System.Globalization.CultureInfo('${culture}'))) } catch { try { $synth.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::Female) } catch {} }`,
          `$synth.SetOutputToWaveFile('${tmpFile.replace(/\\/g, '\\\\')}');`,
          `$synth.Speak('${escaped}');`,
          '$synth.Dispose();'
        ].join(' ');
        await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
      } else if (process.platform === 'darwin') {
        // Kyoko ships by default on macOS for Japanese; Samantha for US
        // English. Fall back to the system default if a voice isn't
        // actually installed rather than failing the whole request.
        const preferredVoice = voice === 'ja-JP-female' ? 'Kyoko' : 'Samantha';
        try {
          await run('say', ['-v', preferredVoice, '-o', tmpFile, '--data-format=LEI16@22050', '--', speechText]);
        } catch {
          await run('say', ['-o', tmpFile, '--data-format=LEI16@22050', '--', speechText]);
        }
      } else {
        // Linux: prefer espeak-ng, fall back to espeak. Neither supports a
        // `--` end-of-options sentinel reliably, so reject anything that
        // could be parsed as a flag instead.
        const engine = (await binaryExists('espeak-ng')) ? 'espeak-ng' : (await binaryExists('espeak')) ? 'espeak' : null;
        if (!engine) {
          return { ok: false, reason: 'No TTS engine found on this system (install espeak-ng, or run on Windows/macOS).' };
        }
        if (speechText.startsWith('-')) {
          return { ok: false, reason: 'Text cannot start with "-".' };
        }
        // en+f3 is espeak's built-in female voice variant. espeak-ng's
        // Japanese voice ("ja") has no distinct gender variants, but will
        // at least speak Japanese text phonetically rather than silently
        // falling back to English.
        const espeakVoice = voice === 'ja-JP-female' ? 'ja' : 'en+f3';
        await run(engine, ['-v', espeakVoice, '-w', tmpFile, speechText]);
      }

      const buffer = await fs.readFile(tmpFile);
      return { ok: true, buffer, mime: 'audio/wav' };
    } catch (err: any) {
      return { ok: false, reason: err?.message ?? 'TTS synthesis failed.' };
    } finally {
      fs.unlink(tmpFile).catch(() => {});
    }
  }
}

function binaryExists(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('which', [bin]);
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}
