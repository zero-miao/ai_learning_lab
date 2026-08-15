from concurrent.futures import ThreadPoolExecutor
from threading import Lock

from apscheduler.schedulers.background import BackgroundScheduler

from .task_service import claim_due_task, execute_task, recover_interrupted_tasks

_scheduler = None
_executors = {
    "default": ThreadPoolExecutor(
        max_workers=1,
        thread_name_prefix="ai-task-worker",
    ),
    "tts": ThreadPoolExecutor(
        max_workers=1,
        thread_name_prefix="tts-task-worker",
    ),
}
_lock = Lock()
_active_lanes = {"default": False, "tts": False}
_lane_claim_options = {
    "default": {"exclude_task_types": ("edge_tts",)},
    "tts": {"task_types": ("edge_tts",)},
}


def start_scheduler():
    global _scheduler
    if _scheduler is not None and _scheduler.running:
        return _scheduler

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
    return _scheduler


def dispatch_due_task():
    with _lock:
        claimed = []
        for lane, claim_options in _lane_claim_options.items():
            if _active_lanes[lane]:
                continue
            task = claim_due_task(**claim_options)
            if task is None:
                continue
            _active_lanes[lane] = True
            claimed.append((lane, task.id))
    for lane, task_id in claimed:
        _executors[lane].submit(_run_and_release, lane, task_id)


def _run_and_release(lane, task_id):
    try:
        execute_task(task_id)
    finally:
        with _lock:
            _active_lanes[lane] = False
