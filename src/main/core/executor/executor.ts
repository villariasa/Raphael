import { IMPLEMENTED_ACTION_KINDS, SafeAction, Plan } from '../../../shared/action';
import type { TaskStatusUpdate } from '../../../shared/ipc';
import { PermissionGate } from '../permissions/permissionGate';
import { ActivityStore } from '../../storage/activityStore';
import { detectEnvironment } from '../environment/detector';
import { createFolder, verifyFolderExists } from '../../automation/filesystem/createFolder';
import { createFile, verifyFileExists } from '../../automation/filesystem/createFile';
import { openApplication } from '../../automation/apps/openApp';
import { closeApplication, openUrlInBrowser, buildSearchUrl } from '../../automation/apps/appLauncher';
import { executeCommand } from '../../automation/shell/executeCommand';

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
    private readonly activity: ActivityStore
  ) {}

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
