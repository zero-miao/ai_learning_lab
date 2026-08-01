from concurrent.futures import ThreadPoolExecutor
from threading import Lock

from apscheduler.schedulers.background import BackgroundScheduler

from .task_service import claim_due_task, execute_task, recover_interrupted_tasks

_scheduler = None
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ai-task-worker")
_lock = Lock()
_active_task = False


def start_scheduler():
    global _scheduler
    if _scheduler is not None and _scheduler.running:
        return

    recover_interrupted_tasks()
    _scheduler = BackgroundScheduler()
    _scheduler.add_job(
        dispatch_due_task,
        trigger="interval",
        seconds=1,
        id="ai-task-dispatcher",
        replace_existing=True,
        max_instances=1,
    )
    _scheduler.start()


def dispatch_due_task():
    global _active_task
    with _lock:
        if _active_task:
            return
        task = claim_due_task()
        if task is None:
            return
        _active_task = True
    _executor.submit(_run_and_release, task.id)


def _run_and_release(task_id):
    global _active_task
    try:
        execute_task(task_id)
    finally:
        with _lock:
            _active_task = False
