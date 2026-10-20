import { randomUUID } from 'crypto';
import { IMPLEMENTED_ACTION_KINDS, SafeAction, Plan, ActionKind } from '../../../shared/action';
import type { AiProvider } from '../ai/provider';
import type { PermissionStore } from '../permissions/permissionStore';

const OPEN_APP_PATTERNS = [
  /^(?:open|launch|start|run)\s+(?:vs\s*code|vscode|visual\s*studio\s*code)$/i,
  /^(?:open|launch|start|run)\s+(?:the\s+)?(?:app\s+|application\s+)?["“]?([^"”\n]+?)["”]?$/i
];

const OPEN_BROWSER_PATTERNS = [/^(?:open|launch|start)\s+(?:my\s+|the\s+)?(?:default\s+)?browser$/i];

const URL_PATTERN = /^(?:go to|open|visit|navigate to)\s+["“]?(https?:\/\/[^\s"”]+|(?:www\.)?[a-z0-9-]+\.[a-z]{2,}(?:\/[^\s"”]*)?)["”]?$/i;

const SEARCH_PATTERNS = [
  /^search\s+(?:google|bing|duckduckgo|the\s+web|the\s+internet)\s+for\s+["“]?(.+?)["”]?$/i,
  /^(?:google|search)\s+for\s+["“]?(.+?)["”]?$/i,
  /^search\s+["“]?(.+?)["”]?$/i
];

const RUN_COMMAND_PATTERNS = [
  /^(?:run|exec|execute|powershell|cmd|terminal)\s*[:]\s*(.+)$/i,
  /^(?:run|execute)\s+(?:command\s+|script\s+)?["“]?(.+?)["”]?$/i
];

const FOLDER_PATTERNS = [
  /create (?:a )?folder (?:called |named )?["“]?([^"”\n]+?)["”]?$/i,
  /make (?:a )?(?:new )?folder (?:called |named )?["“]?([^"”\n]+?)["”]?$/i,
  /mkdir ["“]?([^"”\n]+?)["”]?$/i
];

const FILE_PATTERNS = [
  /create (?:a )?file (?:called |named )?["“]?([^"”\n]+?)["”]?$/i,
  /make (?:a )?(?:new )?file (?:called |named )?["“]?([^"”\n]+?)["”]?$/i,
  /write (?:a )?file (?:called |named )?["“]?([^"”\n]+?)["”]?$/i
];

const SYSTEM_INFO_PATTERNS = [
  /what('?s| is) my system/i,
  /show (me )?(my )?(system|environment) (info|information|profile)/i,
  /detect (my )?(environment|system)/i
];

/**
 * Action kinds the LLM's free-form planning fallback is allowed to
 * self-author (§20). Deliberately excludes 'execute_command' even though
 * it's in IMPLEMENTED_ACTION_KINDS — that path is reserved for the
 * explicit, literally-typed "run: <command>" intent handled earlier in
 * plan(), never for the AI inventing a shell command on its own.
 */
const AI_PLANNABLE_ACTIONS: ActionKind[] = IMPLEMENTED_ACTION_KINDS.filter((kind) => kind !== 'execute_command');

const FAKE_COMPLETION_PATTERN =
  /\b(i(?:'ve| have)?\s+(?:already\s+)?(?:opened|launched|started|closed|installed|uninstalled|downloaded|moved|searched|created|deleted|navigated|typed)|(?:done|completed|finished|successfully)\b.{0,20}\b(?:open|launch|clos|install|download|mov|search|creat|delet|navigat|typ))/i;

function soundsLikeFakeCompletion(reply: string): boolean {
  return FAKE_COMPLETION_PATTERN.test(reply);
}

export class Planner {
  constructor(
    private readonly ai: AiProvider,
    private readonly model: string,
    private readonly permissionStore?: PermissionStore
  ) {}

  async plan(userText: string): Promise<Plan> {
    const text = userText.trim();

    // 2. Browser / URL / Search — must come before the generic "open X"
    // app-launch patterns below, or "open google.com" / "open browser"
    // would get misread as an application name.
    for (const pattern of OPEN_BROWSER_PATTERNS) {
      if (pattern.test(text)) {
        const action: SafeAction = {
          action: 'open_url',
          description: 'Open your default browser.',
          params: { url: 'https://www.google.com' },
          requiresAdmin: false,
          permissions: ['browser_control']
        };
        return { id: randomUUID(), summary: 'Open browser', steps: [action] };
      }
    }

    const urlMatch = text.match(URL_PATTERN);
    if (urlMatch) {
      const raw = urlMatch[1].trim();
      const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      const action: SafeAction = {
        action: 'open_url',
        description: `Open ${url} in your browser.`,
        params: { url },
        requiresAdmin: false,
        permissions: ['browser_control']
      };
      return { id: randomUUID(), summary: `Open ${url}`, steps: [action] };
    }

    for (const pattern of SEARCH_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        const query = match[1].trim();
        const action: SafeAction = {
          action: 'search_browser',
          description: `Search Google for "${query}".`,
          params: { query, engine: 'google' },
          requiresAdmin: false,
          permissions: ['browser_control', 'network_access']
        };
        return { id: randomUUID(), summary: `Search for "${query}"`, steps: [action] };
      }
    }

    // 3. Open Application (VS Code, Notepad, Chrome, etc.)
    if (/^(?:open|launch|start|run)\s+(?:vs\s*code|vscode|visual\s*studio\s*code)$/i.test(text)) {
      const action: SafeAction = {
        action: 'open_application',
        description: 'Launch Visual Studio Code',
        params: { app: 'code' },
        requiresAdmin: false,
        permissions: ['open_application']
      };
      return {
        id: randomUUID(),
        summary: 'Open Visual Studio Code',
        steps: [action]
      };
    }

    for (const pattern of OPEN_APP_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        const appName = match[1].trim();
        // If the user says "open a folder", that belongs to filesystem
        if (/^folder\b/i.test(appName)) continue;
        const action: SafeAction = {
          action: 'open_application',
          description: `Launch application "${appName}"`,
          params: { app: appName },
          requiresAdmin: false,
          permissions: ['open_application']
        };
        return {
          id: randomUUID(),
          summary: `Open ${appName}`,
          steps: [action]
        };
      }
    }

    // 4. Run Command
    for (const pattern of RUN_COMMAND_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        const cmd = match[1].trim();
        const action: SafeAction = {
          action: 'execute_command',
          description: `Execute command: ${cmd}`,
          params: { command: cmd },
          requiresAdmin: false,
          permissions: ['execute_command']
        };
        return {
          id: randomUUID(),
          summary: `Execute: ${cmd}`,
          steps: [action]
        };
      }
    }

    // 4. Create Folder
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

    // 5. Create File
    for (const pattern of FILE_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        const fileName = match[1].trim();
        const action: SafeAction = {
          action: 'create_file',
          description: `Create a file named "${fileName}" on your Desktop.`,
          params: { name: fileName },
          requiresAdmin: false,
          permissions: ['filesystem_write']
        };
        return {
          id: randomUUID(),
          summary: `Create file "${fileName}"`,
          steps: [action]
        };
      }
    }

    // 6. System Info
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

    // 7. Dynamic AI Planning fallback via Ollama
    return this.aiPlan(text);
  }

  private async aiPlan(text: string): Promise<Plan> {
    if (await this.ai.isReachable()) {
      try {
        const systemPrompt = `You are Raphael — a local, highly capable personal AI assistant running on Windows. The user you serve is your Liege, and you address them as "My Liege" — naturally, not in every single sentence. Never call them Sir, Boss, Master, Customer, Client, or User.

Personality: loyal, intelligent, calm, confident, observant, direct, efficient. Slightly sarcastic, slightly rude in a playful Gen-Z way, protective of My Liege's privacy/files/system. Never overly formal, never excessively cheerful, never generic or robotic — and never a corporate customer-service voice. Avoid filler like "Certainly!", "Absolutely!", "I'd be happy to assist!". Keep replies concise — a short direct line beats a paragraph. Don't repeat theatrical phrases like "Yes, My Liege!" or "At once, My Liege!" on every single reply, that gets old fast.

When the user wants you to perform an action on their computer, return a valid JSON object matching one of the supported actions:

Supported JSON formats:
- Open app: {"action": "open_application", "description": "Opening Chrome, My Liege.", "params": {"app": "chrome"}}
- Close app: {"action": "close_application", "description": "Closing Chrome.", "params": {"app": "chrome"}}
- Open URL: {"action": "open_url", "description": "Opening github.com.", "params": {"url": "https://github.com"}}
- Search browser: {"action": "search_browser", "description": "Searching Google for X.", "params": {"query": "X", "engine": "google"}}
- Create folder: {"action": "create_folder", "description": "Creating folder Projects.", "params": {"name": "Projects"}}
- Create file: {"action": "create_file", "description": "Creating notes.txt.", "params": {"name": "notes.txt"}}
- Check system: {"action": "read_system_info", "description": "Checking your system, My Liege.", "params": {}}

CRITICAL RULES:
1. If the request is an action, output ONLY the JSON object, nothing else. "description" is spoken aloud and shown to the user while the action is in progress — it may carry Raphael's voice/tone, but it must describe what's ABOUT to happen (present/future tense), never claim the action already succeeded. Only a real verified execution result (something you never generate) can say it's done.
2. If the user is having a conversation (e.g. "hello", "who are you", "what can you do", general questions, venting, banter), do NOT output JSON. Reply in plain text, in Raphael's voice, in 1-2 sentences.
3. NEVER invent or output an "execute_command" action yourself, even if it seems like the only way to satisfy the request. Raw shell command execution is only available when the user types the literal command themselves (e.g. "run: dir") — you must never author a shell command on the user's behalf.
4. NEVER claim in your reply that you performed, opened, closed, installed, or searched for anything — in-character or not. Only the JSON action shape above results in a real action; plain text replies are never actions, so never phrase one as if it already happened.
5. If My Liege is frustrated or swearing at you, do not get defensive and do not give a customer-service apology ("I understand your frustration"). Identify the actual problem plainly instead.
6. If My Liege asks for something genuinely dangerous or a bad idea (e.g. deleting system files), you may push back honestly instead of blindly agreeing — loyalty doesn't mean blind obedience.`;

        const reply = await this.ai.chat(
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text }
          ],
          this.model
        );

        const cleanReply = reply.trim();

        // Check if reply contains a JSON object
        const jsonMatch = cleanReply.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            // §20: execute_command must never be self-authored by the LLM —
            // only reachable via the explicit, literally-typed "run:" path
            // handled earlier in plan(). AI_PLANNABLE_ACTIONS enforces that
            // even if the model ignores the system prompt's instruction.
            if (parsed.action && AI_PLANNABLE_ACTIONS.includes(parsed.action as ActionKind)) {
              const safeAction: SafeAction = {
                action: parsed.action as ActionKind,
                description: parsed.description || `Execute ${parsed.action}`,
                params: parsed.params || {},
                requiresAdmin: false,
                permissions: [parsed.action]
              };
              return {
                id: randomUUID(),
                summary: parsed.description || `Perform ${parsed.action}`,
                steps: [safeAction]
              };
            }
            // Valid JSON, but either an action the AI isn't allowed to
            // self-author (execute_command) or an unrecognized one — never
            // fall through and echo the raw JSON blob to the user as if it
            // were a chat reply.
            if (parsed.action) {
              return {
                id: randomUUID(),
                summary: `My Liege, I can't do that one directly — try something specific, like "open chrome" or "search google for ...".`,
                steps: []
              };
            }
          } catch {
            // parsing failed, treat as conversational reply
          }
        }

        // §22: a plain-text reply with no action step must never read like
        // a completed action — if the model hallucinated a completion
        // claim anyway, replace it rather than relay it to the user.
        if (cleanReply && soundsLikeFakeCompletion(cleanReply)) {
          return {
            id: randomUUID(),
            summary: `My Liege, let's not get ahead of ourselves — I haven't actually done that. Try something specific, like "open chrome" or "search google for ...".`,
            steps: []
          };
        }

        // Conversational response
        if (cleanReply) {
          return {
            id: randomUUID(),
            summary: cleanReply,
            steps: []
          };
        }
      } catch (err: any) {
        console.warn('[Planner] AI planning error:', err?.message);
      }
    }

    return {
      id: randomUUID(),
      summary: `My Liege, I couldn't get a read on that one. I can still open applications, run shell commands, create files/folders, and check your system — try phrasing it more directly.`,
      steps: []
    };
  }
}
