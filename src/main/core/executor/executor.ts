import { IMPLEMENTED_ACTION_KINDS, SafeAction, Plan } from '../../../shared/action';
import type { TaskStatusUpdate } from '../../../shared/ipc';
import { PermissionGate } from '../permissions/permissionGate';
import { ActivityStore } from '../../storage/activityStore';
import { detectEnvironment } from '../environment/detector';
import { createFolder, verifyFolderExists } from '../../automation/filesystem/createFolder';

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

    onStatus({ taskId: task.taskId, status: 'Completed.', done: true });
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
