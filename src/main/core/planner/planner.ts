import { randomUUID } from 'crypto';
import { IMPLEMENTED_ACTION_KINDS, SafeAction, Plan, ActionKind } from '../../../shared/action';
import type { AiProvider } from '../ai/provider';
import type { PermissionStore } from '../permissions/permissionStore';

const PERMISSION_ALL_PATTERNS = [
  /(?:allow|grant|enable)\s+(?:this\s+program\s+to\s+execute\s+)?(?:all\s+)?permissions/i,
  /allow\s+all(?:\s+permissions)?/i,
  /grant\s+all(?:\s+permissions)?/i,
  /enable\s+all(?:\s+permissions)?/i,
  /all\s+permissions/i
];

const OPEN_APP_PATTERNS = [
  /^(?:open|launch|start|run)\s+(?:vs\s*code|vscode|visual\s*studio\s*code)$/i,
  /^(?:open|launch|start|run)\s+(?:the\s+)?(?:app\s+|application\s+)?["“]?([^"”\n]+?)["”]?$/i
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

export class Planner {
  constructor(
    private readonly ai: AiProvider,
    private readonly model: string,
    private readonly permissionStore?: PermissionStore
  ) {}

  async plan(userText: string): Promise<Plan> {
    const text = userText.trim();

    // 1. Check for "Allow all permissions" intent
    for (const pattern of PERMISSION_ALL_PATTERNS) {
      if (pattern.test(text)) {
        if (this.permissionStore) {
          this.permissionStore.setAlwaysAllowAll(true);
        }
        return {
          id: randomUUID(),
          summary: 'All permissions have been granted. Raphael can now execute any action without prompts.',
          steps: []
        };
      }
    }

    // 2. Open Application (VS Code, Notepad, Chrome, etc.)
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

    // 3. Run Command
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
        const systemPrompt = `You are Raphael, an intelligent AI desktop assistant running on Windows.
When the user wants you to perform an action on their computer (such as opening an application, running a shell command, creating a file or folder, or checking system info), return a valid JSON object matching one of the supported actions:

Supported JSON formats:
- Open app: {"action": "open_application", "description": "Launch Visual Studio Code", "params": {"app": "code"}}
- Run command: {"action": "execute_command", "description": "Run dir command", "params": {"command": "dir"}}
- Create folder: {"action": "create_folder", "description": "Create folder Projects", "params": {"name": "Projects"}}
- Create file: {"action": "create_file", "description": "Create notes.txt", "params": {"name": "notes.txt"}}
- Check system: {"action": "read_system_info", "description": "Check system info", "params": {}}

CRITICAL RULES:
1. If the request is an action, output ONLY the JSON object, nothing else.
2. If the user is having a conversation (e.g. "hello", "who are you", "what can you do", general questions), do NOT output JSON. Instead, provide a friendly, helpful, direct response in 1-2 sentences.`;

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
            if (parsed.action && IMPLEMENTED_ACTION_KINDS.includes(parsed.action as ActionKind)) {
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
          } catch {
            // parsing failed, treat as conversational reply
          }
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
      summary: `I understood "${text}". I can open applications (like VS Code, Notepad, Chrome), run shell commands, create files/folders, and check your system.`,
      steps: []
    };
  }
}
