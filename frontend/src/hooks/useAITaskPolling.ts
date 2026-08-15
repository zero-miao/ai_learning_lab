import { useEffect, useRef } from 'react';
import { getAITask } from '../api';
import type { AITask, AITaskStatus } from '../api';

type PollableTask = {
  id: number;
  status: AITaskStatus;
};

interface Options<T extends PollableTask> {
  enabled?: boolean;
  intervalMs?: number;
  onUpdate: (tasks: Array<T | AITask>) => void;
  onSettled?: (tasks: AITask[]) => void | Promise<void>;
  onError?: () => void;
}

const activeStatuses: AITaskStatus[] = ['pending', 'running'];

export function useAITaskPolling<T extends PollableTask>(
  tasks: T[],
  {
    enabled = true,
    intervalMs = 1500,
    onUpdate,
    onSettled,
    onError,
  }: Options<T>,
) {
  const callbacks = useRef({ onUpdate, onSettled, onError });
  callbacks.current = { onUpdate, onSettled, onError };

  const activeIds = tasks
    .filter((task) => activeStatuses.includes(task.status))
    .map((task) => task.id)
    .sort((left, right) => left - right);
  const activeKey = activeIds.join(',');
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  useEffect(() => {
    if (!enabled || !activeKey) return;
    const pollingIds = activeKey.split(',').map(Number);
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const refreshed = await Promise.all(
          pollingIds.map(async (id) => (await getAITask(id)).data),
        );
        const byId = new Map(refreshed.map((task) => [task.id, task]));
        callbacks.current.onUpdate(
          tasksRef.current.map((task) => byId.get(task.id) ?? task),
        );
        const settled = refreshed.filter(
          (task) => !activeStatuses.includes(task.status),
        );
        if (settled.length) await callbacks.current.onSettled?.(settled);
      } catch {
        callbacks.current.onError?.();
      } finally {
        polling = false;
      }
    };
    const timer = window.setInterval(() => void poll(), intervalMs);
    return () => window.clearInterval(timer);
  }, [activeKey, enabled, intervalMs]);
}
