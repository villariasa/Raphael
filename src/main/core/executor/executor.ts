import { IMPLEMENTED_ACTION_KINDS, SafeAction, Plan } from '../../../shared/action';
import type { TaskStatusUpdate, DesktopCapabilities } from '../../../shared/ipc';
import { PermissionGate } from '../permissions/permissionGate';
import { ActivityStore } from '../../storage/activityStore';
import { detectEnvironment } from '../environment/detector';
import { createFolder, verifyFolderExists } from '../../automation/filesystem/createFolder';
import { createFile, verifyFileExists } from '../../automation/filesystem/createFile';
import { openApplication } from '../../automation/apps/openApp';
import { closeApplication, openUrlInBrowser, buildSearchUrl } from '../../automation/apps/appLauncher';
import { executeCommand } from '../../automation/shell/executeCommand';
import { controlWindow, getActiveWindow } from '../desktop/windowManager';
import type { WindowOp, CursorController } from '../desktop/types';
import type { DesktopEngine } from '../desktop/desktopEngine';

export class TaskAborted extends Error {
  constructor() {
    super('Task aborted by user.');
  }
}

export interface RunningTask {
  taskId: string;
  controller: AbortController;
  paused: boolean;
}

type StatusCb = (update: TaskStatusUpdate) => void;

/**
 * The execution layer (§3, §18). This is the ONLY code in Raphael allowed
 * to touch the real OS. It only ever runs SafeAction objects that have
 * already passed schema validation and the permission gate. Unimplemented
 * action kinds are rejected explicitly — never silently skipped or faked.
 */
export class Executor {
  constructor(
    private readonly gate: PermissionGate,
    private readonly activity: ActivityStore,
    private readonly desktop?: DesktopEngine,
    private readonly cursor?: CursorController,
    private readonly getCapabilities?: () => DesktopCapabilities
  ) {}

  /** §13: a disabled desktop capability is a hard block, not a cosmetic toggle. */
  private requireCapability(cap: keyof DesktopCapabilities, label: string): void {
    const caps = this.getCapabilities?.();
    if (caps && !caps[cap]) {
      throw new Error(`My Liege, ${label} is turned off in your settings. Enable it to let me do that.`);
    }
  }

  async run(plan: Plan, task: RunningTask, onStatus: StatusCb): Promise<void> {
    if (plan.steps.length === 0) {
      onStatus({ taskId: task.taskId, status: plan.summary, done: true });
      return;
    }

    for (let i = 0; i < plan.steps.length; i++) {
      await this.waitWhilePaused(task);
      this.throwIfAborted(task);

      const step = plan.steps[i];
      onStatus({
        taskId: task.taskId,
        status: `Step ${i + 1}/${plan.steps.length}: ${step.description}`,
        stepIndex: i,
        totalSteps: plan.steps.length,
        done: false
      });

      if (!IMPLEMENTED_ACTION_KINDS.includes(step.action)) {
        const msg = `"${step.action}" is not implemented yet in this version of Raphael.`;
        this.activity.append(msg, 'warn');
        onStatus({ taskId: task.taskId, status: msg, done: true, error: msg });
        return;
      }

      onStatus({ taskId: task.taskId, status: 'Waiting for your permission...', stepIndex: i, totalSteps: plan.steps.length, done: false });
      const { approved, reason } = await this.gate.authorize(step);
      if (!approved) {
        const msg = `Permission denied: ${reason}`;
        this.activity.append(msg, 'warn');
        onStatus({ taskId: task.taskId, status: msg, done: true, error: msg });
        return;
      }
      this.activity.append(`Permission granted (${reason}) for: ${step.description}`, 'info');

      this.throwIfAborted(task);
      await this.executeStep(step, task, onStatus, i, plan.steps.length);
    }

    onStatus({ taskId: task.taskId, status: 'Handled, My Liege.', done: true });
  }

  private async executeStep(
    step: SafeAction,
    task: RunningTask,
    onStatus: StatusCb,
    index: number,
    total: number
  ): Promise<void> {
    const progress = (status: string) =>
      onStatus({ taskId: task.taskId, status, stepIndex: index, totalSteps: total, done: false });

    switch (step.action) {
      case 'read_system_info': {
        progress('Detecting your Windows environment...');
        const profile = await detectEnvironment();
        this.activity.append(`Detected ${profile.os} (${profile.architecture}), shell: ${profile.shell}.`, 'success');
        return;
      }
      case 'create_folder': {
        const name = String(step.params.name ?? '').trim();
        progress(`Creating folder "${name}"...`);
        const result = createFolder(name);
        progress('Verifying folder was created...');
        const verified = verifyFolderExists(result.targetPath);
        if (!verified) {
          const msg = `Verification failed: ${result.targetPath} does not exist after creation.`;
          this.activity.append(msg, 'error');
          throw new Error(msg);
        }
        this.activity.append(
          result.alreadyExisted
            ? `Folder already existed: ${result.targetPath}`
            : `Folder created and verified: ${result.targetPath}`,
          'success'
        );
        return;
      }
      case 'open_application': {
        const appName = String(step.params.app ?? step.params.name ?? step.params.application ?? '').trim();
        const targetPath = step.params.path ? String(step.params.path).trim() : undefined;
        progress(`Opening "${appName}"...`);
        progress(`Verifying "${appName}" actually started...`);
        const res = await openApplication(appName, targetPath);
        // §17/§21/§22: a launch command not throwing is not success — only
        // a verified running process is. Unverified launches are reported
        // as real failures, never silently upgraded to "completed".
        if (!res.success) {
          this.activity.append(res.detail, 'error');
          throw new Error(res.detail);
        }
        this.activity.append(res.detail, 'success');
        return;
      }
      case 'close_application': {
        const appName = String(step.params.app ?? step.params.name ?? step.params.application ?? '').trim();
        progress(`Closing "${appName}"...`);
        const res = await closeApplication(appName);
        if (!res.success) {
          this.activity.append(res.detail, 'error');
          throw new Error(res.detail);
        }
        this.activity.append(res.detail, 'success');
        return;
      }
      case 'open_url': {
        const url = String(step.params.url ?? '').trim();
        const normalizedUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
        progress(`Opening ${normalizedUrl}...`);
        progress('Verifying a browser actually opened...');
        const res = await openUrlInBrowser(normalizedUrl);
        if (!res.success) {
          this.activity.append(res.detail, 'error');
          throw new Error(res.detail);
        }
        this.activity.append(res.detail, 'success');
        return;
      }
      case 'search_browser': {
        const query = String(step.params.query ?? '').trim();
        const engine = (step.params.engine as 'google' | 'bing' | 'duckduckgo') ?? 'google';
        const url = buildSearchUrl(query, engine);
        progress(`Searching for "${query}"...`);
        progress('Verifying a browser actually opened...');
        const res = await openUrlInBrowser(url);
        if (!res.success) {
          this.activity.append(res.detail, 'error');
          throw new Error(res.detail);
        }
        this.activity.append(res.detail, 'success');
        return;
      }
      case 'execute_command': {
        const command = String(step.params.command ?? '').trim();
        const cwd = step.params.cwd ? String(step.params.cwd).trim() : undefined;
        progress(`Executing command: ${command}`);
        const res = await executeCommand(command, cwd);
        if (res.exitCode !== 0) {
          const errDetail = res.stderr || `Command exited with code ${res.exitCode}`;
          this.activity.append(`Command error: ${errDetail}`, 'warn');
        }
        if (res.stdout) {
          this.activity.append(`Output: ${res.stdout.slice(0, 300)}`, 'info');
        }
        this.activity.append(`Executed: ${command}`, 'success');
        return;
      }
      case 'move_window': {
        const app = String(step.params.app ?? step.params.application ?? step.params.name ?? '').trim();
        const position = String(step.params.position ?? '').trim();
        // Read-only "what's the active window / what screen are we on?" (§9).
        if (position === 'active') {
          this.requireCapability('readScreen', 'screen reading');
          progress('Checking the active window...');
          const res = await getActiveWindow();
          if (!res.success) {
            this.activity.append(res.detail, 'warn');
            throw new Error(res.detail);
          }
          this.activity.append(res.detail, 'success');
          return;
        }
        this.requireCapability('windowControl', 'window control');
        progress(`Positioning "${app}" (${position})...`);
        progress('Verifying the window landed where expected...');
        // Win32-backed, verified by reading the window bounds back (§5/§8/§18).
        const res = await controlWindow(app, position as WindowOp, {
          width: Number(step.params.width) || undefined,
          height: Number(step.params.height) || undefined,
          monitor: Number(step.params.monitor) || undefined
        });
        if (!res.success) {
          this.activity.append(res.detail, 'error');
          throw new Error(res.detail);
        }
        this.activity.append(res.detail, 'success');
        return;
      }
      case 'read_screen': {
        this.requireCapability('readScreen', 'screen reading');
        progress('Observing your screen...');
        if (!this.desktop) throw new Error('Desktop perception is not available.');
        const state = await this.desktop.observe();
        if (!state) throw new Error('My Liege, I couldn\'t read the screen (perception not ready).');
        const summary = `${state.activeApplication}${state.windowTitle ? ` — "${state.windowTitle}"` : ''}, ${state.visibleElements.length} UI elements detected.`;
        this.activity.append(`On screen: ${summary}`, 'success');
        return;
      }
      case 'click_element': {
        const query = String(step.params.query ?? step.params.target ?? '').trim();
        if (!this.desktop) throw new Error('Desktop control is not available.');
        this.requireCapability('controlMouse', 'mouse control');
        try {
          this.cursor?.show('targeting');
          progress(`Locating "${query}"...`);
          // §10/§15: locate the real element, move the visible cursor, click, verify.
          const el = await this.desktop.findElement(query);
          if (!el) throw new Error(`My Liege, I couldn't find "${query}" on screen — I paused rather than clicking blindly.`);
          this.cursor?.setState('clicking');
          progress(`Clicking "${query}"...`);
          const res = await this.desktop.click({ x: el.center.x, y: el.center.y });
          if (!res.ok) throw new Error(`My Liege, the click on "${query}" failed: ${res.reason ?? 'unknown'}`);
          this.cursor?.setState('success');
          this.activity.append(`Clicked "${el.element}" at (${res.x}, ${res.y}).`, 'success');
        } catch (e) {
          this.cursor?.setState('error');
          throw e;
        } finally {
          setTimeout(() => this.cursor?.hide(), 500);
        }
        return;
      }
      case 'type_text': {
        const text = String(step.params.text ?? '').trim();
        if (!this.desktop) throw new Error('Desktop control is not available.');
        if (!text) throw new Error('Nothing to type.');
        this.requireCapability('controlKeyboard', 'keyboard control');
        this.cursor?.show('executing');
        progress('Typing...');
        const res = await this.desktop.type(text);
        setTimeout(() => this.cursor?.hide(), 400);
        if (!res.ok) throw new Error(`My Liege, typing failed: ${res.reason ?? 'unknown'}`);
        this.activity.append(`Typed ${text.length} characters.`, 'success');
        return;
      }
      case 'scroll': {
        const amount = Number(step.params.amount ?? (String(step.params.direction) === 'up' ? 500 : -500));
        if (!this.desktop) throw new Error('Desktop control is not available.');
        this.requireCapability('controlMouse', 'mouse control');
        this.cursor?.show('executing');
        progress('Scrolling...');
        const res = await this.desktop.scroll(amount);
        setTimeout(() => this.cursor?.hide(), 400);
        if (!res.ok) throw new Error(`My Liege, scrolling failed: ${res.reason ?? 'unknown'}`);
        this.activity.append(`Scrolled ${amount > 0 ? 'up' : 'down'}.`, 'success');
        return;
      }
      case 'create_file': {
        const name = String(step.params.name ?? step.params.path ?? '').trim();
        const content = String(step.params.content ?? '');
        progress(`Creating file "${name}"...`);
        const result = createFile(name, content);
        progress('Verifying file was created...');
        const verified = verifyFileExists(result.targetPath);
        if (!verified) {
          const msg = `Verification failed: ${result.targetPath} does not exist after creation.`;
          this.activity.append(msg, 'error');
          throw new Error(msg);
        }
        this.activity.append(`File created: ${result.targetPath}`, 'success');
        return;
      }
      default:
        throw new Error(`Unreachable: action "${step.action}" passed the implemented-kind check but has no handler.`);
    }
  }

  private throwIfAborted(task: RunningTask): void {
    if (task.controller.signal.aborted) throw new TaskAborted();
  }

  private async waitWhilePaused(task: RunningTask): Promise<void> {
    while (task.paused && !task.controller.signal.aborted) {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
}
