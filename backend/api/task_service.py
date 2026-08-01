import os
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from .ai_gateway import PROMPT_VERSION, AIGateway
from .models import AIResponse, AITask, Exam, ExamQuestion, ReviewRecord

RETRY_DELAYS_SECONDS = (5, 15, 45)


def enqueue_or_reuse(
    task_type, *, topic=None, material=None, question=None, exam=None, input_json=None
):
    filters = {"task_type": task_type, "status__in": ("pending", "running")}
    if material is not None:
        filters["material"] = material
    if topic is not None:
        filters["topic"] = topic
    if question is not None:
        filters["question"] = question
    if exam is not None:
        filters["exam"] = exam

    with transaction.atomic():
        existing = AITask.objects.select_for_update().filter(**filters).first()
        if existing:
            return existing, False

        task = AITask.objects.create(
            task_type=task_type,
            topic=topic,
            material=material,
            question=question,
            exam=exam,
            input_json=input_json or {},
            next_run_at=timezone.now(),
            model=os.getenv("LLM_MODEL", ""),
            prompt_version=PROMPT_VERSION,
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
            .order_by("next_run_at", "id")
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


def execute_task(task_id):
    task = AITask.objects.select_related(
        "topic", "material", "question", "exam__topic"
    ).get(pk=task_id)
    try:
        result = _run_task(task)
    except Exception as error:
        _handle_failure(task_id, error)
        return

    AITask.objects.filter(pk=task_id).update(
        status="succeeded",
        result_json=result,
        error_message="",
        finished_at=timezone.now(),
    )


def _run_task(task):
    if task.task_type == "briefing":
        return _generate_briefing(task)
    if task.task_type == "answer_question":
        return _answer_question(task)
    if task.task_type == "note_draft":
        return _generate_note_draft(task)
    if task.task_type == "generate_exam":
        return _generate_exam(task)
    if task.task_type == "grade_exam":
        return _grade_exam(task)
    raise ValueError(f"不支持的 AI 任务类型：{task.task_type}")


def _generate_briefing(task):
    material = task.material
    if material is None or not material.clean_text:
        raise ValueError("材料正文不存在，无法生成阅读前导。")
    content = AIGateway.generate_briefing(material.clean_text[:2000])
    response = AIResponse.objects.create(
        material=material,
        task_type="briefing",
        prompt_version=PROMPT_VERSION,
        content=content,
        model=task.model,
    )
    return {"ai_response_id": response.id, "material_id": material.id}


def _answer_question(task):
    question = task.question
    if question is None:
        raise ValueError("学习问题不存在。")
    context = task.input_json.get("context", "")
    if not context:
        raise ValueError("问题缺少材料上下文。")
    content = AIGateway.ask_question(context, question.question_text)
    response = AIResponse.objects.create(
        question=question,
        task_type="answer_question",
        prompt_version=PROMPT_VERSION,
        content=content,
        model=task.model,
    )
    return {"ai_response_id": response.id, "question_id": question.id}


def _generate_note_draft(task):
    topic = task.topic
    if topic is None:
        raise ValueError("学习主题不存在。")
    context = task.input_json.get("context", "")
    if not context:
        raise ValueError("学习主题没有可用于生成笔记的材料。")

    content = AIGateway.generate_note_draft(
        topic.title,
        topic.goal,
        context,
        str(task.input_json.get("instructions", "")),
    )
    if not content.strip():
        raise ValueError("AI 未生成笔记草稿。")
    return {
        "topic_id": topic.id,
        "title": f"{topic.title} 学习笔记",
        "content": content,
        "material_fingerprint": task.input_json.get("material_fingerprint", ""),
    }


def _generate_exam(task):
    topic = task.topic
    if topic is None:
        raise ValueError("学习主题不存在。")
    context = task.input_json.get("context", "")
    if not context:
        raise ValueError("学习主题没有可用于出题的材料。")

    generated_questions = AIGateway.generate_exam(topic.title, topic.goal, context)
    with transaction.atomic():
        exam = Exam.objects.create(topic=topic)
        for generated in generated_questions[:5]:
            question_text = str(generated.get("question_text", "")).strip()
            if not question_text:
                raise ValueError("AI 生成的题目缺少题干。")
            rubric = generated.get("rubric", {})
            ExamQuestion.objects.create(
                exam=exam,
                question_type="transfer",
                scenario=str(generated.get("scenario", "")).strip(),
                question_text=question_text,
                rubric_json=rubric if isinstance(rubric, dict) else {},
            )
        topic.status = "exam_ready"
        topic.save(update_fields=["status", "updated_at"])
    return {"exam_id": exam.id, "topic_id": topic.id}


def _grade_exam(task):
    exam = task.exam
    if exam is None:
        raise ValueError("考试不存在。")
    questions = list(exam.questions.all())
    payload = [
        {
            "id": question.id,
            "scenario": question.scenario,
            "question_text": question.question_text,
            "rubric": question.rubric_json,
            "answer_text": question.answer_text,
        }
        for question in questions
    ]
    grading = AIGateway.grade_exam(exam.topic.title, payload)
    grades_by_id = {
        item.get("id"): item
        for item in grading["questions"]
        if isinstance(item, dict)
        and item.get("id") in {question.id for question in questions}
    }
    if len(grades_by_id) != len(questions):
        raise ValueError("AI 阅卷未返回全部题目的结果。")

    with transaction.atomic():
        scores = []
        for question in questions:
            result = grades_by_id[question.id]
            score = int(result.get("score"))
            if not 0 <= score <= 100:
                raise ValueError("AI 返回了无效分数。")
            question.score = score
            question.feedback = str(result.get("feedback", "")).strip()
            question.save(update_fields=["score", "feedback"])
            scores.append(score)

        exam.score = round(sum(scores) / len(scores))
        exam.feedback = str(grading.get("overall_feedback", "")).strip()
        exam.status = "graded"
        exam.submitted_at = timezone.now()
        exam.save(update_fields=["score", "feedback", "status", "submitted_at"])

        mastery_level, review_after_days = _assessment_result(exam.score)
        topic = exam.topic
        topic.mastery_level = mastery_level
        topic.status = "reviewing"
        topic.save(update_fields=["mastery_level", "status", "updated_at"])
        ReviewRecord.objects.filter(topic=topic, exam=exam).delete()
        ReviewRecord.objects.create(
            topic=topic,
            exam=exam,
            due_at=timezone.now() + timedelta(days=review_after_days),
        )
    return {"exam_id": exam.id, "score": exam.score}


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


def _assessment_result(score):
    if score >= 85:
        return "strong", 7
    if score >= 60:
        return "pass", 3
    return "weak", 1
