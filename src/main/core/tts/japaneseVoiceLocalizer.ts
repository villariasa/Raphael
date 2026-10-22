/**
 * Translates English Raphael responses and status updates into natural,
 * polite, and loyal anime-style Japanese dialogue spoken by Raphael ("我が君", Waga Kimi)
 * for the Japanese Lady voice persona (ja-JP-NanamiNeural).
 *
 * When the Japanese voice is selected, every spoken phrase and animated on-screen
 * subtitle MUST be in authentic Japanese (Kanji/Kana). It never degrades to English.
 */
import type { AiProvider } from '../ai/provider';

export function hasJapaneseCharacters(text: string): boolean {
  return /[぀-ヿ㐀-䶿一-鿿]/.test(text);
}

const translationCache = new Map<string, string>();
const TRANSLATION_TIMEOUT_MS = 3500;

/**
 * Canned mappings for fast responses, action-status lines, and greetings.
 */
function cannedStatusPhrase(clean: string, lower: string): string | null {
  // 1. Core greetings & Persona questions
  if (/^(?:hi|hello|hey|yo|sup|good\s+(?:morning|afternoon|evening|day))\s*(?:raphael)?[\.!]?$/i.test(clean)) {
    return '我が君、お呼びでしょうか。何なりとお申し付けください。';
  }
  if (/^(?:who\s+are\s+you|what\s+is\s+your\s+name|what\s+are\s+you)\??$/i.test(clean) || /i am raphael/i.test(lower)) {
    return '私はラファエル、我が君に忠誠を誓う自律型AIデスクトップオペレーターです。';
  }
  if (/^(?:what\s+can\s+you\s+do|help|what\s+are\s+your\s+features)\??$/i.test(clean) || /i can search,? install/i.test(lower)) {
    return '我が君、アプリの検索や起動、ウィンドウの全画面・分割配置、ファイル操作やコマンド実行など、すべてお任せください。';
  }
  if (/^(?:thank\s+you|thanks|thank\s+u|thx)\s*(?:raphael)?[\.!]?$/i.test(clean) || /always an honor/i.test(lower)) {
    return '我が君にお仕えできて光栄です。';
  }
  if (/^(?:how\s+are\s+you|how\s+are\s+things)\??$/i.test(clean) || /operating at peak efficiency/i.test(lower)) {
    return '我が君、全機能最高効率にて稼働中です。次のご指示をお待ちしております。';
  }

  // 2. Task completion & core status
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

  // 3. Step progress
  const stepMatch = clean.match(/^step\s+(\d+)(?:\s+(?:of|\/)\s+(\d+))?/i);
  if (stepMatch) {
    const cur = stepMatch[1];
    const total = stepMatch[2];
    return total ? `ステップ${cur}、全${total}工程を実行中。` : `ステップ${cur}を実行中。`;
  }

  // 4. Application operations & window organizing
  if (/visual studio code|vs\s*code/i.test(lower) && /open|launch|start/i.test(lower)) {
    return 'VS Codeを起動いたします、我が君。';
  }
  if (/github\s*desktop/i.test(lower) && /open|launch|start/i.test(lower)) {
    return 'GitHub Desktopを起動いたします、我が君。';
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

  // 5. Browser & web actions
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

  // 6. Filesystem & shell status
  if (/^(?:creat(?:e|ing)|make|mkdir)\b.*\bfolder\b/i.test(clean) || /^folder (?:created|already existed)/i.test(lower)) {
    return 'フォルダを作成いたしました、我が君。';
  }
  if (/^(?:creat(?:e|ing)|make|write)\b.*\bfile\b/i.test(clean) || /^file created/i.test(lower)) {
    return 'ファイルを作成いたしました、我が君。';
  }
  if (/^execut(?:e|ing)\s+command|^executed:/i.test(lower)) {
    return 'コマンドを実行いたしました、我が君。';
  }

  // 7. System environment & voice status
  if (/^detect(?:ing|ed) (?:your )?windows environment/i.test(lower) || /system.*(info|profile)/i.test(lower)) {
    return 'システム環境を確認いたしました、我が君。';
  }
  if (/voice (?:input )?ready/i.test(lower)) {
    return '音声入力の準備が完了いたしました、我が君。いつでもお話しください。';
  }
  if (/voice (?:engine )?is preparing/i.test(lower)) {
    return '我が君、音声認識エンジンの準備中でございます。少々お待ちください。';
  }

  // 8. Install / verify status
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
 * Intelligent Japanese fallback when LLM is offline or times out.
 * Ensures that if Japanese voice is selected, the output is ALWAYS authentic Japanese.
 */
function fallbackJapanesePhrase(clean: string): string {
  const lower = clean.toLowerCase();

  if (/error|failed|unable|exception/i.test(lower)) {
    return '我が君、処理中に予期せぬ不具合が発生いたしました。';
  }
  if (/success|complete|finished|done|ready/i.test(lower)) {
    return '我が君、ご指定の処理はすべて滞りなく完了いたしました。';
  }
  if (/open|launch|start/i.test(lower)) {
    return '我が君、対象のアプリケーションを起動いたします。';
  }
  if (/move|organize|window|screen/i.test(lower)) {
    return '我が君、ウィンドウの配置を整列いたしました。';
  }
  if (/search|find/i.test(lower)) {
    return '我が君、ご指示の情報を検索しております。';
  }

  // Generic natural response acknowledging My Liege
  return `我が君、仰せの通りに実行いたします。`;
}

/**
 * Returns the Japanese rendering of `text`. Guarantees authentic Kanji/Kana
 * output for the Japanese Lady persona so Raphael never speaks in English
 * when Japanese is selected.
 */
export async function localizeToJapaneseLady(text: string, ai?: AiProvider): Promise<string> {
  const clean = text.trim();
  if (!clean) return '我が君、仰せの通りに。';
  if (hasJapaneseCharacters(clean)) return clean;

  const lower = clean.toLowerCase();
  const cached = translationCache.get(lower);
  if (cached) return cached;

  // 1. Instant accurate canned status mapping
  const canned = cannedStatusPhrase(clean, lower);
  if (canned) {
    translationCache.set(lower, canned);
    return canned;
  }

  // 2. Real LLM translation if provider is reachable
  if (ai) {
    try {
      const chat = ai.chat(
        [
          {
            role: 'system',
            content:
              'Translate the English message into authentic, natural, polite anime-style Japanese dialogue using Kanji, Hiragana, and Katakana (日本語/漢字・ひらがなで出力). Address the user as 我が君 (My Liege) where the original says "My Liege". Preserve the full meaning. Do NOT output Romaji. Output ONLY the Japanese text, without English, markdown, or quotation marks.'
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
      // LLM offline or timed out — fall through to guaranteed Japanese phrase
    }
  }

  // 3. Fallback Japanese guarantee: NEVER return English or null
  const fallback = fallbackJapanesePhrase(clean);
  translationCache.set(lower, fallback);
  return fallback;
}
