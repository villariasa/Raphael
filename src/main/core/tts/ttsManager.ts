import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import type { VoiceOption } from '../../../shared/ipc';

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
  private jaVoiceChecked: boolean | null = null;

  async isVoiceInstalled(voice: VoiceOption): Promise<boolean> {
    if (voice === 'en-US-female') return true;
    if (this.jaVoiceChecked !== null) return this.jaVoiceChecked;

    try {
      if (process.platform === 'win32') {
        const script = `
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$found = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'ja*' -or $_.VoiceInfo.Name -like '*Haruka*' -or $_.VoiceInfo.Name -like '*Ayumi*' }
if ($found) { Write-Output "YES" } else { Write-Output "NO" }
`;
        const tmpPs = path.join(os.tmpdir(), `check-voice-${crypto.randomUUID()}.ps1`);
        await fs.writeFile(tmpPs, script, 'utf8');
        let out = '';
        const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpPs]);
        child.stdout.on('data', (d) => (out += d.toString()));
        await new Promise((r) => child.on('close', r));
        await fs.unlink(tmpPs).catch(() => {});
        this.jaVoiceChecked = out.includes('YES');
        return this.jaVoiceChecked;
      }
      return true;
    } catch {
      return false;
    }
  }

  async synthesizeToWav(text: string, voice: VoiceOption = 'en-US-female'): Promise<TtsResult> {
    // Strip control chars/newlines and cap length before this text reaches
    // any synthesizer — it may originate from LLM output, not just the user.
    const clean = text.trim().replace(/[\x00-\x09\x0b-\x1f\x7f]/g, ' ').slice(0, 2000);
    if (!clean) return { ok: false, reason: 'Empty text.' };

    if (voice === 'ja-JP-female') {
      const installed = await this.isVoiceInstalled('ja-JP-female');
      if (!installed) {
        return {
          ok: false,
          reason: 'Japanese voice (Microsoft Haruka) is not installed on this PC. Please install it in Windows Settings > Time & Language > Speech > Add voices > Japanese.'
        };
      }
    }

    const tmpFile = path.join(os.tmpdir(), `raphael-tts-${crypto.randomUUID()}.wav`);

    try {
      if (process.platform === 'win32') {
        const escaped = clean.replace(/'/g, "''");
        const culture = voice === 'ja-JP-female' ? 'ja-JP' : 'en-US';
        const script = [
          'Add-Type -AssemblyName System.Speech;',
          '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;',
          `$synth.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::Female, [System.Speech.Synthesis.VoiceAge]::NotSet, 0, (New-Object System.Globalization.CultureInfo('${culture}')));`,
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
          await run('say', ['-v', preferredVoice, '-o', tmpFile, '--data-format=LEI16@22050', '--', clean]);
        } catch {
          await run('say', ['-o', tmpFile, '--data-format=LEI16@22050', '--', clean]);
        }
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
        // en+f3 is espeak's built-in female voice variant. espeak-ng's
        // Japanese voice ("ja") has no distinct gender variants, but will
        // at least speak Japanese text phonetically rather than silently
        // falling back to English.
        const espeakVoice = voice === 'ja-JP-female' ? 'ja' : 'en+f3';
        await run(engine, ['-v', espeakVoice, '-w', tmpFile, clean]);
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
