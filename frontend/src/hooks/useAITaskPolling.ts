import { useEffect, useRef, useState } from 'react';
import { getAITask } from '../api';
import type { AITask } from '../api';

interface Options {
  onSucceeded?: (task: AITask) => void;
  onFailed?: (task: AITask) => void;
}

export function useAITaskPolling(taskId: number | null, options: Options = {}) {
  const [task, setTask] = useState<AITask | null>(null);
  const callbacks = useRef(options);
  callbacks.current = options;

  useEffect(() => {
    if (!taskId) {
      setTask(null);
      return;
    }

    let active = true;
    let terminal = false;
    const poll = async () => {
      try {
        const response = await getAITask(taskId);
        if (!active) return;
        const nextTask = response.data;
        setTask(nextTask);
        if (nextTask.status === 'succeeded') {
          terminal = true;
          callbacks.current.onSucceeded?.(nextTask);
        } else if (nextTask.status === 'failed' || nextTask.status === 'cancelled') {
          terminal = true;
          callbacks.current.onFailed?.(nextTask);
        }
      } catch (error) {
        console.error('Failed to poll AI task:', error);
      }
    };

    void poll();
    const intervalId = window.setInterval(() => {
      if (!terminal) {
        void poll();
      }
    }, 2000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [taskId]);

  return task;
}
