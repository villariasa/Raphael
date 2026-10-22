/**
 * Translates English Raphael responses and status updates into natural,
 * polite, and loyal anime-style Japanese dialogue spoken by Raphael ("我が君", Waga Kimi)
 * for the Japanese Lady voice persona (ja-JP-NanamiNeural).
 *
 * Order of resolution:
 *   1. Canned phrases — ONLY for short, exact action-status lines (step
 *      progress, app open/close, install/verify, permission gates) where the
 *      canned Japanese is a faithful rendering and must be instant.
 *   2. Real LLM translation of the actual text via the injected AiProvider
 *      (free APIs first, local Ollama fallback — see compositeProvider.ts).
 *   3. null — the caller must degrade honestly (speak the English text with
 *      the English voice) instead of speaking a canned line that doesn't
 *      match the answer.
 */
import type { AiProvider } from '../ai/provider';

export function hasJapaneseCharacters(text: string): boolean {
  return /[぀-ヿ㐀-䶿一-鿿]/.test(text);
}

const translationCache = new Map<string, string>();
const TRANSLATION_TIMEOUT_MS = 15000;

/**
 * Canned mappings for short execution-status lines only. Conversational
 * replies and real answers must go through the LLM so the voice says the
 * actual content, not a lookalike.
 */
function cannedStatusPhrase(clean: string, lower: string): string | null {
  // 1. Task completion & core status
  if (/^handled[,\s]+my liege/i.test(lower) || /^done\.?$/i.test(lower) || /^handled\.?$/i.test(lower)) {
    return '我が君、すべて完了いたしました！';
  }
  if (/^task (?:completed|finished)\.?$/i.test(lower) || /^completed\.?$/i.test(lower)) {
    return '処理が正常に完了いたしました、我が君。';
  }
  if (/^waiting for (?:your )?permission/i.test(lower)) {
    return '我が君、ご指示と承認をお願いいたします。';
  }
  if (/^permission granted/i.test(lower)) {
    return '了解いたしました、直ちに実行いたします。';
  }
  if (/^permission denied/i.test(lower)) {
    return '承知いたしました、処理を取りやめます。';
  }
  if (/^thinking\.{0,3}$/i.test(lower)) {
    return '思案中ですので、少々お待ちください。';
  }
  if (/^(?:action failed|task aborted)/i.test(lower)) {
    return 'ご指示通り、タスクを中断いたしました。';
  }

  // 2. Step progress
  const stepMatch = clean.match(/^step\s+(\d+)(?:\s+(?:of|\/)\s+(\d+))?/i);
  if (stepMatch) {
    const cur = stepMatch[1];
    const total = stepMatch[2];
    return total ? `ステップ${cur}、全${total}工程を実行中。` : `ステップ${cur}を実行中。`;
  }

  // 3. Application operations & window organizing
  if (/visual studio code|vs\s*code/i.test(lower) && /open|launch|start/i.test(lower)) {
    return 'VS Codeを起動いたします、我が君。';
  }
  if (/^.{0,40}(fullscreen|maximi)/i.test(lower) && /window|screen/i.test(lower)) {
    return '我が君、ウィンドウを全画面に配置いたしました。';
  }
  if (/window/i.test(lower) && /right\s*screen|to\s*the\s*right|on\s*the\s*right/i.test(lower)) {
    return '我が君、ウィンドウを画面右側に整列いたしました。';
  }
  if (/window/i.test(lower) && /left\s*screen|to\s*the\s*left|on\s*the\s*left/i.test(lower)) {
    return '我が君、ウィンドウを画面左側に整列いたしました。';
  }
  const openAppMatch = clean.match(
    /^(?:search\s+(?:and\s+)?|open|launch|start|opening|launching)\s+(?:application\s+|app\s+)?["“]?([^"”\n\.,]+?)["”]?[\.,]?(?:\s+(?:my\s+liege|please))?[\.!]?$/i
  );
  if (openAppMatch) {
    const app = openAppMatch[1].trim();
    if (!/folder|file|browser/i.test(app)) {
      return `${app}を検索して起動いたします、我が君。`;
    }
  }
  const closeAppMatch = clean.match(
    /^(?:close|closing)\s+(?:application\s+|app\s+)?["“]?([^"”\n\.,]+?)["”]?[\.,]?(?:\s+(?:my\s+liege|please))?[\.!]?$/i
  );
  if (closeAppMatch) {
    return `${closeAppMatch[1].trim()}を終了いたします。`;
  }

  // 4. Browser & web actions
  if (/^open(?:ing)?\s+(?:my\s+|the\s+)?(?:default\s+)?browser/i.test(lower)) {
    return 'ブラウザを開きます、我が君。';
  }
  const searchMatch = clean.match(/^(?:search(?:ing)?\s+(?:google\s+for\s+|for\s+)?|google\s+for\s+)["“]?(.+?)["”]?[\.!]?$/i);
  if (searchMatch) {
    return `「${searchMatch[1].trim()}」を検索いたします。`;
  }
  if (/^open(?:ing)?\s+(?:https?:\/\/|www\.)/i.test(lower) || /^open\s+url/i.test(lower)) {
    return 'ウェブサイトを開きます、我が君。';
  }

  // 5. Filesystem & shell status
  if (/^(?:creat(?:e|ing)|make|mkdir)\b.*\bfolder\b/i.test(clean) || /^folder (?:created|already existed)/i.test(lower)) {
    return 'フォルダを作成いたしました、我が君。';
  }
  if (/^(?:creat(?:e|ing)|make|write)\b.*\bfile\b/i.test(clean) || /^file created/i.test(lower)) {
    return 'ファイルを作成いたしました、我が君。';
  }
  if (/^execut(?:e|ing)\s+command|^executed:/i.test(lower)) {
    return 'コマンドを実行いたしました、我が君。';
  }

  // 6. System environment status
  if (/^detect(?:ing|ed) (?:your )?windows environment/i.test(lower)) {
    return 'システム環境を確認いたしました、我が君。';
  }

  // 7. Install / verify status
  if (/^preparing to install|^preparing the installation/i.test(lower)) {
    return '我が君、インストールの準備を整えております。';
  }
  if (/installed successfully|successfully installed|installation.*completed/i.test(lower)) {
    return '我が君、アプリケーションのインストールは正常に完了いたしました！';
  }
  if (/^verif(?:ying|ied)/i.test(lower)) {
    return '我が君、検証は正常に完了いたしました。';
  }
  if (/administrator privileges required/i.test(lower)) {
    return '我が君、この処理の実行には管理者権限が必要です。';
  }

  return null;
}

/**
 * Returns the Japanese rendering of `text`, or null when no faithful
 * Japanese version could be produced (no canned match and the LLM
 * translation failed). Never returns a generic placeholder.
 */
export async function localizeToJapaneseLady(text: string, ai?: AiProvider): Promise<string | null> {
  const clean = text.trim();
  if (!clean) return null;
  if (hasJapaneseCharacters(clean)) return clean;

  const lower = clean.toLowerCase();
  const cached = translationCache.get(lower);
  if (cached) return cached;

  const canned = cannedStatusPhrase(clean, lower);
  if (canned) return canned;

  if (!ai) return null;

  try {
    const chat = ai.chat(
      [
        {
          role: 'system',
          content:
            'Translate the English message into authentic, natural Japanese text using Kanji, Hiragana, and Katakana (日本語/漢字・ひらがなで出力). Address the user as 我が君 (My Liege) where the original says "My Liege". Preserve the full meaning — do not shorten or summarize. Do NOT output Romaji. Output ONLY the Japanese text, no English, no markdown, no quotes.'
        },
        { role: 'user', content: clean.slice(0, 1500) }
      ],
      process.env.RAPHAEL_MODEL || 'llama3.2'
    );
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Translation timed out.')), TRANSLATION_TIMEOUT_MS)
    );
    const translated = (await Promise.race([chat, timeout])).trim();
    if (translated && hasJapaneseCharacters(translated)) {
      const result = translated.replace(/^["'「]+|["'」]+$/g, '');
      translationCache.set(lower, result);
      return result;
    }
  } catch {
    // fall through to null — caller degrades to English speech honestly
  }

  return null;
}
