import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import type { VoiceOption, SpeechTimestamp } from '../../../shared/ipc';
import { localizeToJapaneseLady } from './japaneseVoiceLocalizer';

export type TtsResult =
  | {
      ok: true;
      buffer: Buffer;
      mime: string;
      timestamps?: SpeechTimestamp[];
      spokenText?: string;
      japaneseText?: string;
    }
  | { ok: false; reason: string };

export function parseSubtitles(content: string): SpeechTimestamp[] {
  const lines = content.split(/\r?\n/);
  const results: SpeechTimestamp[] = [];
  const timeRegex = /(?:(\d{1,2}):)?(\d{2}):(\d{2})[,.](\d{3})\s+-->\s+(?:(\d{1,2}):)?(\d{2}):(\d{2})[,.](\d{3})/;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(timeRegex);
    if (match) {
      const h1 = match[1] ? parseInt(match[1], 10) : 0;
      const m1 = parseInt(match[2], 10);
      const s1 = parseInt(match[3], 10);
      const ms1 = parseInt(match[4], 10);
      const start = h1 * 3600 + m1 * 60 + s1 + ms1 / 1000;

      const h2 = match[5] ? parseInt(match[5], 10) : 0;
      const m2 = parseInt(match[6], 10);
      const s2 = parseInt(match[7], 10);
      const ms2 = parseInt(match[8], 10);
      const end = h2 * 3600 + m2 * 60 + s2 + ms2 / 1000;

      let text = '';
      let j = i + 1;
      while (j < lines.length && lines[j].trim() && !timeRegex.test(lines[j])) {
        text += (text ? ' ' : '') + lines[j].trim();
        j++;
      }
      if (text) {
        results.push({ text, start, end });
      }
    }
  }
  return results;
}

export function parseSapiTiming(jsonStr: string): SpeechTimestamp[] {
  try {
    const raw = JSON.parse(jsonStr);
    const list = Array.isArray(raw) ? raw : [raw];
    const results: SpeechTimestamp[] = [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (!item || typeof item.text !== 'string') continue;
      const start = typeof item.sec === 'number' ? item.sec : 0;
      const nextStart =
        i + 1 < list.length && typeof list[i + 1]?.sec === 'number'
          ? list[i + 1].sec
          : start + Math.max(0.2, item.text.length * 0.05);
      const end = Math.max(start + 0.1, nextStart);
      results.push({ text: item.text, start, end });
    }
    return results;
  } catch {
    return [];
  }
}

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

    // When voice is ja-JP-female or contains Japanese characters, speak in Japanese
    const isJapanese = voice === 'ja-JP-female' || /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(clean);
    let speechText = clean;
    let japaneseText: string | undefined;

    if (isJapanese) {
      let prefix = '';
      let body = clean;
      const prefixMatch = clean.match(
        /^(?:(H[ōo]koku|Kait[ōo]|Koku)\.(?:\s*(?:Report|Solution|Notice)\.?)?|(報告|回答|告)[。、\.]?)\s*/i
      );
      if (prefixMatch) {
        const pStr = (prefixMatch[1] || prefixMatch[2] || '').toLowerCase();
        if (/h[ōo]koku|報告/i.test(pStr)) prefix = '報告。';
        else if (/kait[ōo]|回答/i.test(pStr)) prefix = '回答。';
        else if (/koku|告/i.test(pStr)) prefix = '告。';
        body = clean.slice(prefixMatch[0].length).trim();
      }

      const localizedBody = await localizeToJapaneseLady(body || clean);
      speechText = prefix ? `${prefix}${localizedBody}` : localizedBody;
      japaneseText = speechText;
    }

    const neuralVoice = isJapanese ? 'ja-JP-NanamiNeural' : 'en-US-JennyNeural';
    const neuralTmp = path.join(os.tmpdir(), `raphael-neural-${crypto.randomUUID()}.mp3`);
    const subTmp = path.join(os.tmpdir(), `raphael-sub-${crypto.randomUUID()}.vtt`);

    const pythonCandidates = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
    for (const py of pythonCandidates) {
      try {
        await run(py, [
          '-m',
          'edge_tts',
          '--voice',
          neuralVoice,
          '--text',
          speechText,
          '--write-media',
          neuralTmp,
          '--write-subtitles',
          subTmp
        ]);
        const buffer = await fs.readFile(neuralTmp);
        let timestamps: SpeechTimestamp[] | undefined;
        try {
          const subContent = await fs.readFile(subTmp, 'utf8');
          timestamps = parseSubtitles(subContent);
        } catch {}

        fs.unlink(neuralTmp).catch(() => {});
        fs.unlink(subTmp).catch(() => {});

        if (buffer && buffer.length > 100) {
          return { ok: true, buffer, mime: 'audio/mp3', timestamps, spokenText: speechText, japaneseText };
        }
      } catch {
        // Try installing edge-tts if not yet present, then try next candidate
        this.ensureEdgeTts(py).catch(() => {});
      }
    }

    const timingTmp = path.join(os.tmpdir(), `raphael-timing-${crypto.randomUUID()}.json`);

    try {
      let timestamps: SpeechTimestamp[] | undefined;

      if (process.platform === 'win32') {
        const escaped = speechText.replace(/'/g, "''");
        const culture = voice === 'ja-JP-female' ? 'ja-JP' : 'en-US';
        const script = [
          'Add-Type -AssemblyName System.Speech;',
          '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;',
          '$events = New-Object System.Collections.Generic.List[PSObject];',
          '$action = { param($sender, $e) $events.Add([PSCustomObject]@{ text = $e.Text; sec = $e.AudioPosition.TotalSeconds }) };',
          '$job = Register-ObjectEvent -InputObject $synth -EventName SpeakProgress -Action $action;',
          `try { $synth.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::Female, [System.Speech.Synthesis.VoiceAge]::NotSet, 0, (New-Object System.Globalization.CultureInfo('${culture}'))) } catch { try { $synth.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::Female) } catch {} }`,
          `$synth.SetOutputToWaveFile('${tmpFile.replace(/\\/g, '\\\\')}');`,
          `$synth.Speak('${escaped}');`,
          '$synth.Dispose();',
          'Start-Sleep -Milliseconds 50;',
          `$events | ConvertTo-Json -Compress | Set-Content -Path '${timingTmp.replace(/\\/g, '\\\\')}' -Encoding utf8;`
        ].join(' ');
        await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);

        try {
          const timingContent = await fs.readFile(timingTmp, 'utf8');
          timestamps = parseSapiTiming(timingContent);
        } catch {}
      } else if (process.platform === 'darwin') {
        const preferredVoice = voice === 'ja-JP-female' ? 'Kyoko' : 'Samantha';
        try {
          await run('say', ['-v', preferredVoice, '-o', tmpFile, '--data-format=LEI16@22050', '--', speechText]);
        } catch {
          await run('say', ['-o', tmpFile, '--data-format=LEI16@22050', '--', speechText]);
        }
      } else {
        const engine = (await binaryExists('espeak-ng')) ? 'espeak-ng' : (await binaryExists('espeak')) ? 'espeak' : null;
        if (!engine) {
          return { ok: false, reason: 'No TTS engine found on this system (install espeak-ng, or run on Windows/macOS).' };
        }
        if (speechText.startsWith('-')) {
          return { ok: false, reason: 'Text cannot start with "-".' };
        }
        const espeakVoice = voice === 'ja-JP-female' ? 'ja' : 'en+f3';
        await run(engine, ['-v', espeakVoice, '-w', tmpFile, speechText]);
      }

      const buffer = await fs.readFile(tmpFile);
      return { ok: true, buffer, mime: 'audio/wav', timestamps, spokenText: speechText, japaneseText };
    } catch (err: any) {
      return { ok: false, reason: err?.message ?? 'TTS synthesis failed.' };
    } finally {
      fs.unlink(tmpFile).catch(() => {});
      fs.unlink(timingTmp).catch(() => {});
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
