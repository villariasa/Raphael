import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

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
  async synthesizeToWav(text: string): Promise<TtsResult> {
    // Strip control chars/newlines and cap length before this text reaches
    // any synthesizer — it may originate from LLM output, not just the user.
    const clean = text.trim().replace(/[\x00-\x09\x0b-\x1f\x7f]/g, ' ').slice(0, 2000);
    if (!clean) return { ok: false, reason: 'Empty text.' };

    const tmpFile = path.join(os.tmpdir(), `raphael-tts-${crypto.randomUUID()}.wav`);

    try {
      if (process.platform === 'win32') {
        // Windows SAPI via System.Speech, rendered to a WAV file.
        const escaped = clean.replace(/'/g, "''");
        const script = [
          'Add-Type -AssemblyName System.Speech;',
          '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;',
          `$synth.SetOutputToWaveFile('${tmpFile.replace(/\\/g, '\\\\')}');`,
          `$synth.Speak('${escaped}');`,
          '$synth.Dispose();'
        ].join(' ');
        await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
      } else if (process.platform === 'darwin') {
        // `--` stops `say` from treating a leading '-' in clean as a flag.
        await run('say', ['-o', tmpFile, '--data-format=LEI16@22050', '--', clean]);
      } else {
        // Linux: prefer espeak-ng, fall back to espeak. Neither supports a
        // `--` end-of-options sentinel reliably, so reject anything that
        // could be parsed as a flag instead.
        const engine = (await binaryExists('espeak-ng')) ? 'espeak-ng' : (await binaryExists('espeak')) ? 'espeak' : null;
        if (!engine) {
          return { ok: false, reason: 'No TTS engine found on this system (install espeak-ng, or run on Windows/macOS).' };
        }
        if (clean.startsWith('-')) {
          return { ok: false, reason: 'Text cannot start with "-".' };
        }
        await run(engine, ['-w', tmpFile, clean]);
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
