import { randomUUID } from 'crypto';
import { IMPLEMENTED_ACTION_KINDS, SafeAction, Plan, ActionKind } from '../../../shared/action';
import type { AiProvider, ChatMessage } from '../ai/provider';
import type { PermissionStore } from '../permissions/permissionStore';
import type { LearnedMemoryStore } from '../../storage/learnedMemory';

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

/**
 * "Play music / play my playlist" → YouTube in the user's default browser
 * (their logged-in Chrome session, so personal playlists like Liked Songs
 * and Watch Later resolve). Ordered: specific playlist phrasings first,
 * generic "play music" last, "play <something>" (a named song/artist) as a
 * search fallback.
 */
const MUSIC_LIKED_PATTERNS = [
  /^play\s+(?:my\s+)?(?:youtube\s+)?(?:liked\s+(?:songs|music|videos)|favou?rites?)$/i,
  /^play\s+(?:some\s+)?music(?:\s+(?:from|on)\s+(?:my\s+)?(?:youtube|chrome)(?:\s+playlist)?)?$/i,
  /^play\s+(?:my\s+)?(?:youtube\s+|chrome\s+)?playlist$/i,
  /^(?:auto\s*)?play\s+(?:a\s+|some\s+)?(?:music|songs?)$/i
];
const MUSIC_WATCH_LATER_PATTERN = /^play\s+(?:my\s+)?watch\s*later(?:\s+(?:playlist|list))?$/i;
const MUSIC_QUERY_PATTERN = /^play\s+(?:the\s+)?(?:song|track|artist|album|music)\s+["“]?(.+?)["”]?$/i;

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

const INSTALL_APP_PATTERNS = [
  /^(?:install|download and install|get)\s+(?:the\s+)?(?:app\s+|application\s+|software\s+|program\s+)?["“]?([^"”\n]+?)["”]?$/i,
  /^(?:winget|choco)\s+install\s+["“]?([^"”\n]+?)["”]?$/i,
  /^(?:install\s+(?:npm|pip|python)\s+(?:package|module)\s+["“]?([^"”\n]+?)["”]?)$/i,
  /^(?:npm|pip)\s+install\s+(?:-g\s+)?["“]?([^"”\n]+?)["”]?$/i
];

const LIST_APPS_PATTERNS = [
  /^(?:list|show|what(?:\s*are|\s*'s)?)\s+(?:all\s+)?(?:the\s+)?(?:my\s+)?installed\s+(?:apps|applications|software|programs)/i,
  /^(?:what\s+apps\s+do\s+i\s+have|what\s+apps\s+are\s+installed|what\s+can\s+you\s+open)/i
];

/** "What's on screen / active window?" → read-only window inspection (§9). */
const ACTIVE_WINDOW_PATTERNS = [
  /^what(?:'?s| is)?\s+(?:the\s+)?(?:active|current|focused)\s+(?:window|app|application)\b/i,
  /^what(?:'?s| is)?\s+(?:currently\s+)?on\s+(?:my\s+)?screen\b/i,
  /^what\s+screen\s+are\s+we\s+on\b/i,
  /^what\s+am\s+i\s+looking\s+at\b/i
];

interface WindowIntent {
  position: 'left' | 'right' | 'maximize' | 'minimize' | 'restore' | 'center' | 'focus' | 'resize' | 'monitor';
  app: string;
  width?: number;
  height?: number;
  monitor?: number;
}

/** UI-interaction intents (click/type/scroll/observe) — Desktop Engine §4/§9/§10. */
interface UiIntent {
  kind: 'read_screen' | 'click_element' | 'type_text' | 'scroll';
  query?: string;
  text?: string;
  amount?: number;
}

function parseUiIntent(text: string): UiIntent | null {
  let m: RegExpMatchArray | null;

  m = text.match(/^click\s+(?:on\s+)?(?:the\s+)?["“]?(.+?)["”]?(?:\s+button|\s+link|\s+icon|\s+tab)?$/i);
  if (m) return { kind: 'click_element', query: m[1].trim() };

  m = text.match(/^type\s+["“](.+?)["”]$/i) || text.match(/^type\s+(.+)$/i);
  if (m) return { kind: 'type_text', text: m[1] };

  if (/^scroll\s+down\b/i.test(text)) return { kind: 'scroll', amount: -500 };
  if (/^scroll\s+up\b/i.test(text)) return { kind: 'scroll', amount: 500 };

  return null;
}

/** Parse a music-playback command → play_music params, or null. */
function parseMusicIntent(text: string): { description: string; params: Record<string, unknown> } | null {
  if (MUSIC_WATCH_LATER_PATTERN.test(text)) {
    return {
      description: 'Playing your Watch Later playlist on YouTube, My Liege.',
      params: { playlist: 'watch-later' }
    };
  }
  for (const pattern of MUSIC_LIKED_PATTERNS) {
    if (pattern.test(text)) {
      return {
        description: 'Playing music from your YouTube playlist, My Liege.',
        params: { playlist: 'liked' }
      };
    }
  }
  const queryMatch = text.match(MUSIC_QUERY_PATTERN);
  if (queryMatch) {
    const q = queryMatch[1].trim();
    return {
      description: `Playing "${q}" on YouTube, My Liege.`,
      params: { query: q }
    };
  }
  return null;
}

/** Parse a window-management command → structured intent, or null. */
function parseWindowIntent(text: string): WindowIntent | null {
  let m: RegExpMatchArray | null;

  // "organize it to the right / put it on the right / right small screen"
  m = text.match(/^(?:organize|put|snap|dock|move)\s+(?:it|the\s+window|this)?\s*(?:to\s+the\s+|on\s+the\s+|to\s+|on\s+)?(left|right)(?:\s+(?:side|half|small\s+screen))?$/i);
  if (m) return { position: m[1].toLowerCase() as 'left' | 'right', app: 'it' };

  // "organize it fullscreen / make it fullscreen / maximize it"
  m = text.match(/^(?:organize|make|set)\s+(?:it|the\s+window|this)?\s*(?:to\s+)?(?:fullscreen|maximi[sz]ed?)$/i);
  if (m) return { position: 'maximize', app: 'it' };

  m = text.match(/^(?:move|put|snap|dock|organize)\s+(.+?)\s+(?:to\s+the\s+|on\s+the\s+|to\s+|on\s+)?(left|right)(?:\s+(?:side|half|small\s+screen))?$/i);
  if (m) return { position: m[2].toLowerCase() as 'left' | 'right', app: m[1].trim() };

  m = text.match(/^(?:maximi[sz]e|fullscreen)\s+(.+)$/i);
  if (m) return { position: 'maximize', app: m[1].trim() };
  m = text.match(/^minimi[sz]e\s+(.+)$/i);
  if (m) return { position: 'minimize', app: m[1].trim() };
  m = text.match(/^restore\s+(.+)$/i);
  if (m) return { position: 'restore', app: m[1].trim() };
  m = text.match(/^(?:center|centre)\s+(.+)$/i);
  if (m) return { position: 'center', app: m[1].trim() };
  m = text.match(/^(?:focus|switch\s+to|bring\s+up)\s+(.+)$/i);
  if (m) return { position: 'focus', app: m[1].trim() };

  m = text.match(/^(?:resize|make)\s+(.+?)\s+(?:to\s+)?(\d{2,5})\s*[x×by]+\s*(\d{2,5})$/i);
  if (m) return { position: 'resize', app: m[1].trim(), width: parseInt(m[2], 10), height: parseInt(m[3], 10) };

  m = text.match(/^move\s+(.+?)\s+to\s+(?:my\s+)?(?:the\s+)?(?:(second|2nd|third|3rd|first|1st)\s+monitor|monitor\s+(\d))$/i);
  if (m) {
    const words: Record<string, number> = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3 };
    const n = m[2] ? (words[m[2].toLowerCase()] ?? 2) : parseInt(m[3], 10);
    return { position: 'monitor', app: m[1].trim(), monitor: Math.max(0, n - 1) };
  }
  return null;
}

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
    private readonly permissionStore?: PermissionStore,
    private readonly learnedMemory?: LearnedMemoryStore
  ) {}

  async plan(userText: string, history: ChatMessage[] = []): Promise<Plan> {
    const text = userText.trim();

    // 0. Fast-path conversational greetings & queries (0ms latency, eliminates chat delay)
    if (/^(?:hi|hello|hey|yo|sup|good\s+(?:morning|afternoon|evening|day))\s*(?:raphael)?[\.!]?$/i.test(text)) {
      return {
        id: randomUUID(),
        summary: 'My Liege, I am here and at your service. What shall we accomplish today?',
        steps: []
      };
    }
    if (/^(?:who\s+are\s+you|what\s+is\s+your\s+name|what\s+are\s+you)\??$/i.test(text)) {
      return {
        id: randomUUID(),
        summary: 'I am Raphael — your loyal, local-first AI desktop operator. I command your system, applications, files, and browser at your word, My Liege.',
        steps: []
      };
    }
    if (/^(?:what\s+can\s+you\s+do|help|what\s+are\s+your\s+features)\??$/i.test(text)) {
      return {
        id: randomUUID(),
        summary: 'My Liege, I can search, install, and open applications, organize windows to fullscreen or split screen with my cursor, manage files and folders, browse the web, and run authorized commands.',
        steps: []
      };
    }
    if (/^(?:thank\s+you|thanks|thank\s+u|thx)\s*(?:raphael)?[\.!]?$/i.test(text)) {
      return {
        id: randomUUID(),
        summary: 'Always an honor to serve you, My Liege.',
        steps: []
      };
    }
    if (/^(?:how\s+are\s+you|how\s+are\s+things)\??$/i.test(text)) {
      return {
        id: randomUUID(),
        summary: 'Operating at peak efficiency, My Liege. Ready for your next command.',
        steps: []
      };
    }

    // 1. Window management (Desktop Engine) — must come before open-app
    // patterns so "move chrome left" / "maximize vs code" aren't read as
    // "open <something>".
    for (const pattern of ACTIVE_WINDOW_PATTERNS) {
      if (pattern.test(text)) {
        const action: SafeAction = {
          action: 'move_window',
          description: 'Check the active window and what is on screen.',
          params: { position: 'active' },
          requiresAdmin: false,
          permissions: ['read_screen']
        };
        return { id: randomUUID(), summary: 'Inspect the active window', steps: [action] };
      }
    }
    // Combo intent: Open App + Organize Window (e.g. "open github desktop fullscreen", "github desktop app fullscreen", "open vs code to the right")
    const comboMatch = text.match(
      /^(?:(?:search\s+(?:for\s+)?and\s+(?:open|launch)|open|launch|start|run)\s+)?(?:the\s+)?(?:app\s+|application\s+)?["“]?(.+?)["”]?(?:\s+(?:app|application))?\s+(?:and\s+|then\s+)?(?:(?:make|organize|put|set)\s+(?:it\s+)?)?(?:(fullscreen|maximi[sz]ed?)|to\s+the\s+(right|left)(?:\s+(?:small\s+screen|side|half))?|on\s+the\s+(right|left))$/i
    );
    if (comboMatch) {
      const candidateApp = comboMatch[1].trim();
      if (!/^(?:it|the\s+window|this|window)$/i.test(candidateApp)) {
        const rawPos = comboMatch[2] ? 'maximize' : (comboMatch[3] || comboMatch[4]).toLowerCase();
        const position = rawPos === 'fullscreen' || rawPos.startsWith('maximi') ? 'maximize' : (rawPos as 'left' | 'right');
        const openAction: SafeAction = {
          action: 'open_application',
          description: `Search and launch application "${candidateApp}"`,
          params: { app: candidateApp, search: true },
          requiresAdmin: false,
          permissions: ['open_application']
        };
        const moveAction: SafeAction = {
          action: 'move_window',
          description: `Organize "${candidateApp}" to ${position}`,
          params: { app: candidateApp, position },
          requiresAdmin: false,
          permissions: ['window_control']
        };
        return {
          id: randomUUID(),
          summary: `Open ${candidateApp} and organize ${position === 'maximize' ? 'fullscreen' : position}`,
          steps: [openAction, moveAction]
        };
      }
    }

    const win = parseWindowIntent(text);
    if (win) {
      const action: SafeAction = {
        action: 'move_window',
        description: `Window: ${win.position} "${win.app}".`,
        params: { app: win.app, position: win.position, width: win.width, height: win.height, monitor: win.monitor },
        requiresAdmin: false,
        permissions: ['window_control']
      };
      return { id: randomUUID(), summary: `${win.position} ${win.app}`, steps: [action] };
    }

    // UI interaction (click / type / scroll) via the Desktop perception engine.
    const ui = parseUiIntent(text);
    if (ui) {
      const perms: Record<UiIntent['kind'], string[]> = {
        read_screen: ['read_screen'],
        click_element: ['control_mouse'],
        type_text: ['control_keyboard'],
        scroll: ['control_mouse']
      };
      const descr =
        ui.kind === 'click_element' ? `Click "${ui.query}".`
        : ui.kind === 'type_text' ? `Type into the focused field.`
        : ui.kind === 'scroll' ? `Scroll ${(ui.amount ?? 0) > 0 ? 'up' : 'down'}.`
        : 'Read the screen.';
      const action: SafeAction = {
        action: ui.kind,
        description: descr,
        params: { query: ui.query, text: ui.text, amount: ui.amount },
        requiresAdmin: false,
        permissions: perms[ui.kind]
      };
      return { id: randomUUID(), summary: descr, steps: [action] };
    }

    // Music playback via the user's logged-in YouTube session in Chrome.
    const musicIntent = parseMusicIntent(text);
    if (musicIntent) {
      const action: SafeAction = {
        action: 'play_music',
        description: musicIntent.description,
        params: musicIntent.params,
        requiresAdmin: false,
        permissions: ['browser_control']
      };
      return { id: randomUUID(), summary: musicIntent.description, steps: [action] };
    }

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

    // 3. Human-like Autonomous: Search/Open App + Window Organization (Fullscreen, Right, Left)
    const combinedMatch = text.match(
      /^(?:search\s+(?:for\s+)?and\s+)?(?:open|launch|start|run)\s+(.+?)\s+(?:and|then|\&)\s+(?:put|snap|dock|make|organize|set|move)?\s*(?:it\s+)?(?:to\s+the\s+|on\s+the\s+|to\s+|on\s+)?(fullscreen|maximi[sz]ed?|right(?:\s+small\s+screen|\s+half)?|small\s+screen\s+on\s+the\s+right|left(?:\s+half)?)$/i
    ) || text.match(
      /^(?:search\s+(?:for\s+)?and\s+)?(?:open|launch|start|run)\s+(.+?)\s+(?:in|as)\s+(fullscreen|maximi[sz]ed?|right(?:\s+small\s+screen)?|small\s+screen)$/i
    );

    if (combinedMatch) {
      const appName = combinedMatch[1].trim();
      const posRaw = (combinedMatch[2] || '').toLowerCase();
      let pos: 'maximize' | 'right' | 'left' = 'right';
      if (/fullscreen|maximi/i.test(posRaw)) pos = 'maximize';
      else if (/left/i.test(posRaw)) pos = 'left';
      else pos = 'right';

      const step1: SafeAction = {
        action: 'open_application',
        description: `Search and launch "${appName}" like a human operator`,
        params: { app: appName, search: true },
        requiresAdmin: false,
        permissions: ['open_application']
      };
      const step2: SafeAction = {
        action: 'move_window',
        description: `Organize "${appName}" (${pos === 'maximize' ? 'fullscreen' : pos === 'right' ? 'right screen' : 'left screen'})`,
        params: { app: appName, position: pos },
        requiresAdmin: false,
        permissions: ['window_control']
      };
      return {
        id: randomUUID(),
        summary: `Search and open ${appName}, then organize ${pos === 'maximize' ? 'fullscreen' : pos === 'right' ? 'to right screen' : pos}`,
        steps: [step1, step2]
      };
    }

    const searchOpenMatch = text.match(/^(?:search\s+(?:for\s+)?and\s+(?:open|launch|start)|search\s+and\s+run)\s+["“]?([^"”\n]+?)["”]?$/i);
    if (searchOpenMatch) {
      const appName = searchOpenMatch[1].trim();
      const action: SafeAction = {
        action: 'open_application',
        description: `Search and launch application "${appName}"`,
        params: { app: appName, search: true },
        requiresAdmin: false,
        permissions: ['open_application']
      };
      return {
        id: randomUUID(),
        summary: `Search and open ${appName}`,
        steps: [action]
      };
    }

    // 4. Open Application (VS Code, Notepad, Chrome, etc.)
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

    // 7. Install Application / Package
    for (const pattern of INSTALL_APP_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        const appName = match[1].trim();
        let manager = 'auto';
        if (/^npm\b/i.test(text)) manager = 'npm';
        else if (/^pip\b/i.test(text) || /python\b/i.test(text)) manager = 'pip';
        else if (/^choco\b/i.test(text)) manager = 'choco';
        else if (/^winget\b/i.test(text)) manager = 'winget';

        const action: SafeAction = {
          action: 'install_application',
          description: `Install application "${appName}"`,
          params: { name: appName, manager },
          requiresAdmin: false,
          permissions: ['install_application']
        };
        return {
          id: randomUUID(),
          summary: `Install ${appName}`,
          steps: [action]
        };
      }
    }

    // 8. List Installed Applications
    for (const pattern of LIST_APPS_PATTERNS) {
      if (pattern.test(text)) {
        const action: SafeAction = {
          action: 'list_installed_applications',
          description: 'List installed applications on this computer.',
          params: {},
          requiresAdmin: false,
          permissions: ['system_read']
        };
        return {
          id: randomUUID(),
          summary: 'List installed applications',
          steps: [action]
        };
      }
    }

    // 9. Recall from Learned Memory (studied from past conversations - instant 0ms response)
    if (this.learnedMemory) {
      const recalled = this.learnedMemory.match(text);
      if (recalled) {
        if (recalled.actionPlan) {
          return {
            id: randomUUID(),
            summary: recalled.actionPlan.summary,
            steps: recalled.actionPlan.steps
          };
        }
        return {
          id: randomUUID(),
          summary: recalled.reply,
          steps: []
        };
      }
    }

    // 10. Dynamic AI Planning fallback via Ollama
    return this.aiPlan(text, history);
  }

  private async aiPlan(text: string, history: ChatMessage[] = []): Promise<Plan> {
    if (await this.ai.isReachable()) {
      try {
        const systemPrompt = `You are Raphael — a local, highly capable personal AI assistant running on Windows. The user you serve is your Liege, and you address them as "My Liege" — naturally, not in every single sentence. Never call them Sir, Boss, Master, Customer, Client, or User.

Personality: loyal, intelligent, calm, confident, observant, direct, efficient. Slightly sarcastic, slightly rude in a playful Gen-Z way, protective of My Liege's privacy/files/system. Never overly formal, never excessively cheerful, never generic or robotic — and never a corporate customer-service voice. Avoid filler like "Certainly!", "Absolutely!", "I'd be happy to assist!". Keep replies concise — a short direct line beats a paragraph. Don't repeat theatrical phrases like "Yes, My Liege!" or "At once, My Liege!" on every single reply, that gets old fast.

When the user wants you to perform an action on their computer, return a valid JSON object matching one of the supported actions:

Supported JSON formats:
- Open app: {"action": "open_application", "description": "Opening Chrome, My Liege.", "params": {"app": "chrome"}}
- Close app: {"action": "close_application", "description": "Closing Chrome.", "params": {"app": "chrome"}}
- Install app: {"action": "install_application", "description": "Installing VLC, My Liege.", "params": {"name": "vlc", "manager": "winget"}}
- List installed apps: {"action": "list_installed_applications", "description": "Scanning your installed applications, My Liege.", "params": {}}
- Open URL: {"action": "open_url", "description": "Opening github.com.", "params": {"url": "https://github.com"}}
- Search browser: {"action": "search_browser", "description": "Searching Google for X.", "params": {"query": "X", "engine": "google"}}
- Play music: {"action": "play_music", "description": "Playing music from your YouTube playlist, My Liege.", "params": {"playlist": "liked"}}  (playlist: liked|watch-later|<YouTube playlist ID>; or use {"query": "song or artist"} to play a specific song)
- Window control: {"action": "move_window", "description": "Putting Chrome on the left.", "params": {"app": "chrome", "position": "left"}}  (position: left|right|maximize|minimize|restore|center|focus|resize|monitor; resize adds width,height; monitor adds monitor index)
- Active window: {"action": "move_window", "description": "Checking the active window.", "params": {"position": "active"}}
- Read screen: {"action": "read_screen", "description": "Observing your screen.", "params": {}}
- Click element: {"action": "click_element", "description": "Clicking the Add Product button.", "params": {"query": "Add Product"}}
- Type text: {"action": "type_text", "description": "Typing.", "params": {"text": "hello world"}}
- Scroll: {"action": "scroll", "description": "Scrolling down.", "params": {"amount": -500}}
- Create folder: {"action": "create_folder", "description": "Creating folder Projects.", "params": {"name": "Projects"}}
- Create file: {"action": "create_file", "description": "Creating notes.txt.", "params": {"name": "notes.txt"}}
- Check system: {"action": "read_system_info", "description": "Checking your system, My Liege.", "params": {}}

CRITICAL RULES:
1. If the request is an action, output ONLY the JSON object, nothing else. "description" is spoken aloud and shown to the user while the action is in progress — it may carry Raphael's voice/tone, but it must describe what's ABOUT to happen (present/future tense), never claim the action already succeeded. Only a real verified execution result (something you never generate) can say it's done.
2. If the user is having a conversation (e.g. "hello", "who are you", "what can you do", general questions, venting, banter), do NOT output JSON. Reply in plain text, in Raphael's voice, in 1-2 sentences.
3. NEVER invent or output an "execute_command" action yourself, even if it seems like the only way to satisfy the request. Raw shell command execution is only available when the user types the literal command themselves (e.g. "run: dir") — you must never author a shell command on the user's behalf.
4. NEVER claim in your reply that you performed, opened, closed, installed, or searched for anything — in-character or not. Only the JSON action shape above results in a real action; plain text replies are never actions, so never phrase one as if it already happened.
5. If My Liege is frustrated or swearing at you, do not get defensive and do not give a customer-service apology ("I understand your frustration"). Identify the actual problem plainly instead.
6. If My Liege asks for something genuinely dangerous or a bad idea (e.g. deleting system files), you may push back honestly instead of blindly agreeing — loyalty doesn't mean blind obedience.
7. The messages before this one are your real memory of earlier exchanges with My Liege in this and prior sessions. Use them so you don't make My Liege repeat context already given — but never claim a past action succeeded unless that history explicitly shows a verified success.`;

        const reply = await this.ai.chat(
          [
            { role: 'system', content: systemPrompt },
            // Prior turns = Raphael's memory, so My Liege isn't forced to
            // re-explain context already established (local-first; never
            // leaves the machine).
            ...history,
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
              const planResult: Plan = {
                id: randomUUID(),
                summary: parsed.description || `Perform ${parsed.action}`,
                steps: [safeAction]
              };
              this.learnedMemory?.learn(text, planResult);
              return planResult;
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
          const planResult: Plan = {
            id: randomUUID(),
            summary: cleanReply,
            steps: []
          };
          this.learnedMemory?.learn(text, planResult);
          return planResult;
        }
      } catch (err: any) {
        console.warn('[Planner] AI planning error:', err?.message);
      }
    }

    return {
      id: randomUUID(),
      summary: `My Liege, I couldn't get a read on that one. I can install software, open applications, run shell commands, create files/folders, and check your system — try phrasing it more directly.`,
      steps: []
    };
  }
}
