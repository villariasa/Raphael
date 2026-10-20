import { randomUUID } from 'crypto';
import { IMPLEMENTED_ACTION_KINDS, SafeAction, Plan } from '../../../shared/action';
import type { AiProvider } from '../ai/provider';

const FOLDER_PATTERNS = [
  /create (?:a )?folder (?:called |named )?["“]?([^"”\n]+?)["”]?$/i,
  /make (?:a )?(?:new )?folder (?:called |named )?["“]?([^"”\n]+?)["”]?$/i,
  /mkdir ["“]?([^"”\n]+?)["”]?$/i
];

const SYSTEM_INFO_PATTERNS = [
  /what('?s| is) my system/i,
  /show (me )?(my )?(system|environment) (info|information|profile)/i,
  /detect (my )?(environment|system)/i
];

/**
 * Rule-based intent → Safe Action Model translation (§16, §18). This is
 * intentionally simple and deterministic for MVP: it only ever emits
 * action kinds the executor implements. Anything it doesn't recognize
 * becomes an empty, clearly-labeled "not supported yet" plan rather than
 * a guessed or hallucinated action — the LLM is consulted only to restate
 * what Raphael *would* need to do, never to author an action directly.
 */
export class Planner {
  constructor(private readonly ai: AiProvider, private readonly model: string) {}

  async plan(userText: string): Promise<Plan> {
    const text = userText.trim();

    for (const pattern of FOLDER_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        const folderName = match[1].trim();
        const action: SafeAction = {
          action: 'create_folder',
          description: `Create a folder named "${folderName}" on your Desktop.`,
          params: { name: folderName },
          requiresAdmin: false,
          permissions: ['filesystem_write']
        };
        return {
          id: randomUUID(),
          summary: `Create folder "${folderName}"`,
          steps: [action]
        };
      }
    }

    for (const pattern of SYSTEM_INFO_PATTERNS) {
      if (pattern.test(text)) {
        const action: SafeAction = {
          action: 'read_system_info',
          description: 'Read your Windows environment profile (OS, architecture, shell, package managers).',
          params: {},
          requiresAdmin: false,
          permissions: ['system_read']
        };
        return {
          id: randomUUID(),
          summary: 'Read system environment profile',
          steps: [action]
        };
      }
    }

    return this.unsupportedPlan(text);
  }

  private async unsupportedPlan(text: string): Promise<Plan> {
    let explanation = `Raphael doesn't yet have an implemented action for "${text}". Supported right now: ${IMPLEMENTED_ACTION_KINDS.join(', ')}.`;

    if (await this.ai.isReachable()) {
      try {
        const reply = await this.ai.chat(
          [
            {
              role: 'system',
              content:
                'You are Raphael, a desktop assistant still in early development. The user asked for something Raphael cannot execute yet. In ONE short sentence, tell them it is not implemented yet. Never claim you performed an action. Never suggest a shell command.'
            },
            { role: 'user', content: text }
          ],
          this.model
        );
        if (reply.trim()) explanation = reply.trim();
      } catch {
        // fall back to the static explanation above
      }
    }

    return {
      id: randomUUID(),
      summary: explanation,
      steps: []
    };
  }
}
