import { randomUUID } from 'crypto';
import type { Plan } from '../../../shared/action';
import type { TaskStatusUpdate } from '../../../shared/ipc';
import { Executor, RunningTask, TaskAborted } from './executor';
import { ActivityStore } from '../../storage/activityStore';

type StatusCb = (update: TaskStatusUpdate) => void;

/**
 * Tracks in-flight tasks so Pause/Stop/Take-Control (§11) and app-close
 * (§2) can reach a running execution and actually abort it — not just
 * hide the UI while automation keeps running underneath.
 */
export class TaskManager {
  private readonly tasks = new Map<string, RunningTask>();

  constructor(private readonly executor: Executor, private readonly activity: ActivityStore) {}

  start(plan: Plan, onStatus: StatusCb): string {
    const taskId = randomUUID();
    const task: RunningTask = { taskId, controller: new AbortController(), paused: false };
    this.tasks.set(taskId, task);

    this.activity.append(`Task started: ${plan.summary}`, 'info');

    this.executor
      .run(plan, task, onStatus)
      .catch((err) => {
        if (err instanceof TaskAborted) {
          this.activity.append('Task stopped by user.', 'warn');
          onStatus({ taskId, status: 'Stopped.', done: true, error: 'stopped' });
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        this.activity.append(`Task failed: ${message}`, 'error');
        onStatus({ taskId, status: `Failed: ${message}`, done: true, error: message });
      })
      .finally(() => {
        this.tasks.delete(taskId);
      });

    return taskId;
  }

  stop(taskId: string): void {
    this.tasks.get(taskId)?.controller.abort();
  }

  pause(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task) task.paused = true;
  }

  resume(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task) task.paused = false;
  }

  /** Called on app quit / window close — guarantees no automation outlives Raphael (§2). */
  stopAll(): void {
    for (const task of this.tasks.values()) task.controller.abort();
  }
}
