from datetime import timedelta

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from .ai_gateway import AIGateway
from .models import AITask, Material

RETRY_DELAYS_SECONDS = (5, 15, 45)
INTERACTIVE_TASK_PRIORITY = 100
MATERIAL_TASK_FAILURE_PREFIXES = {
    "process": "材料导入失败",
    "clean_text": "正文清洗失败",
    "briefing": "阅读前导生成失败",
    "asr": "视频处理失败",
    "edge_tts": "朗读音频生成失败",
}
MATERIAL_RETRY_STATUSES = {
    "process": "pending",
    "asr": "pending",
    "clean_text": "cleaning",
    "briefing": "summarizing",
    "edge_tts": "generating_audio",
}


class TaskCancelled(Exception):
    pass


def _mark_material_task_failed(task, message):
    if task.trigger_type != "Material":
        return
    prefix = MATERIAL_TASK_FAILURE_PREFIXES.get(task.task_type)
    if not prefix:
        return

    from .models import Material

    Material.objects.filter(pk=task.trigger_id).update(
        status="failed",
        error=f"{prefix}：{message[:300]}",
        updated_at=timezone.now(),
    )


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
    failed_tasks = list(AITask.objects.filter(status="running", attempt_count__gte=3))
    AITask.objects.filter(pk__in=[task.pk for task in failed_tasks]).update(
        status="failed",
        error_message="服务重启前任务未完成，已达到最大重试次数。",
        finished_at=now,
    )
    for task in failed_tasks:
        _mark_material_task_failed(task, "服务重启前任务未完成，已达到最大重试次数。")


def claim_due_task(*, task_types=None, exclude_task_types=None):
    with transaction.atomic():
        queryset = (
            AITask.objects.select_for_update()
            .filter(status="pending", next_run_at__lte=timezone.now())
            .order_by("-priority", "next_run_at", "id")
        )
        if task_types:
            queryset = queryset.filter(task_type__in=task_types)
        if exclude_task_types:
            queryset = queryset.exclude(task_type__in=exclude_task_types)
        task = queryset.first()
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
    task = AITask.objects.filter(pk=task_id).first()
    if task is None or task.status == "cancelled":
        return
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
    if task.attempt_count >= task.max_attempts:
        _mark_material_task_failed(task, message)
    elif task.trigger_type == "Material":
        retry_status = MATERIAL_RETRY_STATUSES.get(task.task_type)
        if retry_status:
            Material.objects.filter(pk=task.trigger_id).update(status=retry_status)


def execute_task(task_id):
    from .tasks import TaskRegistry

    task = AITask.objects.filter(pk=task_id).first()
    if task is not None and task.status == "pending":
        claimed = AITask.objects.filter(pk=task_id, status="pending").update(
            status="running",
            started_at=timezone.now(),
            finished_at=None,
            attempt_count=F("attempt_count") + 1,
        )
        task = AITask.objects.filter(pk=task_id).first() if claimed else None
    if task is None or task.status != "running":
        return
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
    except TaskCancelled:
        return
    except Exception as error:
        _handle_failure(task_id, error)
        return

    AITask.objects.filter(pk=task_id, status="running").update(
        status="succeeded",
        result_json=result,
        error_message="",
        finished_at=timezone.now(),
    )
