from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from .ai_gateway import AIGateway
from .models import AITask

RETRY_DELAYS_SECONDS = (5, 15, 45)
INTERACTIVE_TASK_PRIORITY = 100


def enqueue_or_reuse(
    task_type,
    *,
    trigger_type=None,
    trigger_id=None,
    task_data=None,
    priority=0,
    model=None,
):
    filters = {"task_type": task_type, "status__in": ("pending", "running")}
    if trigger_type:
        filters["trigger_type"] = trigger_type
        filters["trigger_id"] = trigger_id
    with transaction.atomic():
        existing = AITask.objects.select_for_update().filter(**filters).first()
        if existing:
            return existing, False

        task = AITask.objects.create(
            task_type=task_type,
            trigger_type=trigger_type,
            trigger_id=trigger_id,
            task_data=task_data or {},
            next_run_at=timezone.now(),
            model=model or AIGateway.get_model_for_task(task_type),
            priority=priority,
        )
        return task, True


def retry_task(task):
    if task.status not in ("failed", "cancelled"):
        raise ValueError("只有失败或已取消的任务可以重试。")

    task.status = "pending"
    task.attempt_count = 0
    task.error_message = ""
    task.result_json = {}
    task.next_run_at = timezone.now()
    task.started_at = None
    task.finished_at = None
    task.save()
    return task


def recover_interrupted_tasks():
    now = timezone.now()
    AITask.objects.filter(status="running", attempt_count__lt=3).update(
        status="pending",
        next_run_at=now,
        started_at=None,
    )
    AITask.objects.filter(status="running", attempt_count__gte=3).update(
        status="failed",
        error_message="服务重启前任务未完成，已达到最大重试次数。",
        finished_at=now,
    )


def claim_due_task():
    with transaction.atomic():
        task = (
            AITask.objects.select_for_update()
            .filter(status="pending", next_run_at__lte=timezone.now())
            .order_by("-priority", "next_run_at", "id")
            .first()
        )
        if task is None:
            return None
        task.status = "running"
        task.attempt_count += 1
        task.started_at = timezone.now()
        task.error_message = ""
        task.save(
            update_fields=[
                "status",
                "attempt_count",
                "started_at",
                "error_message",
                "updated_at",
            ]
        )
        return task


def _handle_failure(task_id, error):
    task = AITask.objects.get(pk=task_id)
    message = str(error) or error.__class__.__name__
    if task.attempt_count >= task.max_attempts:
        task.status = "failed"
        task.error_message = f"任务执行失败：{message}"
        task.finished_at = timezone.now()
    else:
        delay = RETRY_DELAYS_SECONDS[task.attempt_count - 1]
        task.status = "pending"
        task.error_message = (
            f"第 {task.attempt_count} 次执行失败，正在自动重试：{message}"
        )
        task.next_run_at = timezone.now() + timedelta(seconds=delay)
        task.started_at = None
    task.save()
    if task.task_type in {"asr", "edge_tts"} and task.trigger_type == "Material":
        from .models import Material

        material = Material.objects.filter(pk=task.trigger_id).first()
        if material and task.attempt_count >= task.max_attempts:
            prefix = "视频处理失败" if task.task_type == "asr" else "朗读音频生成失败"
            material.status = "failed"
            material.error = f"{prefix}：{message[:300]}"
            material.save(update_fields=["status", "error", "updated_at"])


def execute_task(task_id):
    from .tasks import TaskRegistry

    task = AITask.objects.get(pk=task_id)
    try:
        task_cls = TaskRegistry.get_task_class(task.task_type)
        task_obj = task_cls(
            task_id=task.id,
            task_data=task.task_data,
            trigger_type=task.trigger_type,
            trigger_id=task.trigger_id,
            model=task.model,
        )
        result = task_obj.run()
    except Exception as error:
        _handle_failure(task_id, error)
        return

    AITask.objects.filter(pk=task_id).update(
        status="succeeded",
        result_json=result,
        error_message="",
        finished_at=timezone.now(),
    )
