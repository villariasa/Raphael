/**
 * Translates English Raphael responses and status updates into natural,
 * polite, and loyal anime-style Japanese dialogue spoken by Raphael ("我が君", Waga Kimi)
 * for the Japanese Lady voice persona (ja-JP-NanamiNeural).
 * 
 * Allows the screen UI to continue showing English subtitles/status while the audio
 * speaks authentically in Japanese.
 */

export function hasJapaneseCharacters(text: string): boolean {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(text);
}

export async function localizeToJapaneseLady(text: string): Promise<string> {
  const clean = text.trim();
  if (!clean) return clean;
  if (hasJapaneseCharacters(clean)) return clean;

  const lower = clean.toLowerCase();

  // 1. Task Completion & Core Status
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

  // 3. Application Operations
  if (/visual studio code|vs\s*code/i.test(lower) && /open|launch|start/i.test(lower)) {
    return 'VS Codeを起動いたします、我が君。';
  }
  const openAppMatch = clean.match(/^(?:open|launch|start|opening|launching)\s+(?:application\s+|app\s+)?["“]?([^"”\n\.,]+?)["”]?[\.,]?(?:\s+(?:my\s+liege|please))?[\.!]?$/i);
  if (openAppMatch) {
    const app = openAppMatch[1].trim();
    if (!/folder|file|browser/i.test(app)) {
      return `${app}を起動いたします、我が君。`;
    }
  }

  const closeAppMatch = clean.match(/^(?:close|closing)\s+(?:application\s+|app\s+)?["“]?([^"”\n\.,]+?)["”]?[\.,]?(?:\s+(?:my\s+liege|please))?[\.!]?$/i);
  if (closeAppMatch) {
    return `${closeAppMatch[1].trim()}を終了いたします。`;
  }

  // 4. Browser & Web
  if (/open(?:ing)?\s+(?:my\s+|the\s+)?(?:default\s+)?browser/i.test(lower)) {
    return 'ブラウザを開きます、我が君。';
  }
  const searchMatch = clean.match(/^(?:search(?:ing)?\s+(?:google\s+for\s+|for\s+)?|google\s+for\s+)["“]?(.+?)["”]?[\.!]?$/i);
  if (searchMatch) {
    return `「${searchMatch[1].trim()}」を検索いたします。`;
  }
  if (/^open(?:ing)?\s+(?:https?:\/\/|www\.)/i.test(lower) || /^open\s+url/i.test(lower)) {
    return 'ウェブサイトを開きます、我が君。';
  }

  // 5. Filesystem & Shell Commands
  const folderMatch = clean.match(/(?:creat(?:e|ing)|make|mkdir)\s+(?:a\s+)?(?:new\s+)?folder/i);
  if (folderMatch) {
    return 'フォルダを作成いたしました、我が君。';
  }
  const fileMatch = clean.match(/(?:creat(?:e|ing)|make|write)\s+(?:a\s+)?(?:new\s+)?file/i);
  if (fileMatch) {
    return 'ファイルを作成いたしました、我が君。';
  }
  if (/^execut(?:e|ing)\s+command|^executed:/i.test(lower)) {
    return 'コマンドを実行いたしました、我が君。';
  }

  // 6. System Environment
  if (/detecting (?:your )?windows environment|detected windows|system environment/i.test(lower)) {
    return 'システム環境を確認いたしました、我が君。';
  }

  // 7. Core Raphael Conversational Lines
  if (/voice synthesis is active/i.test(lower)) {
    return 'ラファエルの音声合成システムは正常に稼働中です。いつでも命令をどうぞ。';
  }
  if (/^(?:hello|hi|hey)\b/i.test(lower)) {
    return 'こんにちは、我が君。お役に立てることはありますか？';
  }
  if (/good morning/i.test(lower)) {
    return 'おはようございます、我が君。今日もよろしくお願いします。';
  }
  if (/good evening|good night/i.test(lower)) {
    return 'こんばんは、我が君。ごゆっくりお休みください。';
  }
  if (/who are you|what is your name/i.test(lower)) {
    return '私はラファエル。我が君に仕える専属AIアシスタントです。';
  }
  if (/what can you do|how can you help/i.test(lower)) {
    return 'アプリの起動やファイルの作成、Web検索など、様々なPC操作を我が君のために実行できます。';
  }
  if (/thank you|thanks/i.test(lower)) {
    return 'どういたしまして、我が君。お役に立てて光栄です。';
  }
  if (/couldn't get a read|can't do that/i.test(lower)) {
    return '我が君、直接その操作を行うことはできません。別の指示をお願いできますか？';
  }

  // 8. General conversational fallback with quick Ollama translation (2.5s timeout)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const res = await fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'llama3.2:latest',
        messages: [
          {
            role: 'system',
            content: 'Translate the English message into natural, concise Japanese spoken by a loyal cool anime girl assistant addressing her user as 我が君 (My Liege). Output ONLY the Japanese sentence, no English, no markdown, no quotes.'
          },
          { role: 'user', content: clean.slice(0, 200) }
        ],
        stream: false,
        options: { num_predict: 50, temperature: 0.2 }
      })
    });
    clearTimeout(timeout);
    const data = (await res.json()) as any;
    const translated = data?.message?.content?.trim();
    if (translated && hasJapaneseCharacters(translated)) {
      return translated.replace(/^["'「]+|["'」]+$/g, '');
    }
  } catch {
    // If Ollama is offline or times out, gracefully use standard in-character speech
  }

  // In-character fallback for arbitrary long English responses
  return '我が君、画面の回答をご確認ください。';
}
