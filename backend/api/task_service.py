from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from .ai_gateway import PROMPT_VERSION, AIGateway
from .models import (
    AIResponse,
    AITask,
    DiscussionMessage,
    Exam,
    ExamQuestion,
    ReviewRecord,
)

RETRY_DELAYS_SECONDS = (5, 15, 45)


def enqueue_or_reuse(
    task_type,
    *,
    topic=None,
    material=None,
    question=None,
    concept=None,
    discussion_message=None,
    exam=None,
    review=None,
    input_json=None,
):
    filters = {"task_type": task_type, "status__in": ("pending", "running")}
    if material is not None:
        filters["material"] = material
    if topic is not None:
        filters["topic"] = topic
    if question is not None:
        filters["question"] = question
    if concept is not None:
        filters["concept"] = concept
    if discussion_message is not None:
        filters["discussion_message"] = discussion_message
    if exam is not None:
        filters["exam"] = exam
    if review is not None:
        filters["review"] = review

    with transaction.atomic():
        existing = AITask.objects.select_for_update().filter(**filters).first()
        if existing:
            return existing, False

        task = AITask.objects.create(
            task_type=task_type,
            topic=topic,
            material=material,
            question=question,
            concept=concept,
            discussion_message=discussion_message,
            exam=exam,
            review=review,
            input_json=input_json or {},
            next_run_at=timezone.now(),
            model=AIGateway.get_model_for_task(task_type),
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
        "topic",
        "material",
        "question",
        "concept__topic",
        "discussion_message__topic",
        "exam__topic",
        "review__topic",
        "review__exam",
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
    if task.task_type == "concept_draft":
        return _generate_concept_draft(task)
    if task.task_type == "discussion_opening":
        return _generate_discussion_opening(task)
    if task.task_type == "discussion_assessment":
        return _generate_discussion_assessment(task)
    if task.task_type == "discussion_reply":
        return _generate_discussion_reply(task)
    if task.task_type == "learning_path":
        return _generate_learning_path(task)
    if task.task_type == "generate_exam":
        return _generate_exam(task)
    if task.task_type == "grade_exam":
        return _grade_exam(task)
    if task.task_type == "review_prompt":
        return _generate_review_prompt(task)
    if task.task_type == "grade_review":
        return _grade_review(task)
    raise ValueError(f"不支持的 AI 任务类型：{task.task_type}")


def _generate_briefing(task):
    material = task.material
    if material is None or not material.clean_text:
        raise ValueError("材料正文不存在，无法生成阅读前导。")
    content = AIGateway.generate_briefing(material.clean_text[:2000], task.model)
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
    content = AIGateway.ask_question(
        context, question.question_text, question.selected_text, task.model
    )
    response = AIResponse.objects.create(
        question=question,
        task_type="answer_question",
        prompt_version=PROMPT_VERSION,
        content=content,
        model=task.model,
    )
    return {"ai_response_id": response.id, "question_id": question.id}


def _generate_concept_draft(task):
    concept = task.concept
    if concept is None:
        raise ValueError("概念不存在。")
    source_text = str(task.input_json.get("source_text", "")).strip()
    context = str(task.input_json.get("context", "")).strip()
    if not source_text or not context:
        raise ValueError("概念草稿缺少来源文本或材料上下文。")

    draft = AIGateway.generate_concept_draft(
        concept.title, source_text, context, task.model
    )
    concept.definition = draft["definition"]
    concept.principle = draft["principle"]
    concept.pitfalls = draft["pitfalls"]
    concept.applications = draft["applications"]
    concept.status = "draft"
    concept.source_task = task
    concept.save(
        update_fields=[
            "definition",
            "principle",
            "pitfalls",
            "applications",
            "status",
            "source_task",
            "updated_at",
        ]
    )
    return {"concept_id": concept.id, **draft}


def _create_discussion_message(task, content, message_type):
    topic = task.topic
    if topic is None:
        raise ValueError("讨论话题不存在。")
    message = DiscussionMessage.objects.create(
        topic=topic,
        role="assistant",
        message_type=message_type,
        content=content.strip(),
        source_task=task,
    )
    return {"discussion_message_id": message.id, "topic_id": topic.id}


def _generate_discussion_opening(task):
    topic = task.topic
    if topic is None:
        raise ValueError("讨论话题不存在。")
    content = AIGateway.generate_discussion_opening(topic.title, topic.goal, task.model)
    return _create_discussion_message(task, content, "opening")


def _generate_discussion_assessment(task):
    topic = task.topic
    if topic is None:
        raise ValueError("讨论话题不存在。")
    material_context = str(task.input_json.get("material_context", "")).strip()
    if not material_context:
        raise ValueError("快速评估缺少可用材料。")
    content = AIGateway.assess_discussion_material(
        topic.title, topic.goal, material_context, task.model
    )
    topic.discussion_rationale = content
    topic.save(update_fields=["discussion_rationale", "updated_at"])
    return _create_discussion_message(task, content, "assessment")


def _generate_discussion_reply(task):
    topic = task.topic
    user_message = task.discussion_message
    if topic is None or user_message is None:
        raise ValueError("讨论消息不存在。")
    content = AIGateway.reply_to_discussion(
        topic.title,
        topic.goal,
        str(task.input_json.get("material_context", "")).strip(),
        str(task.input_json.get("history", "")).strip(),
        user_message.content,
        task.model,
    )
    return _create_discussion_message(task, content, "discussion")


def _generate_learning_path(task):
    topic = task.topic
    if topic is None:
        raise ValueError("讨论话题不存在。")
    content = AIGateway.generate_learning_path(
        topic.title,
        topic.goal,
        str(task.input_json.get("material_context", "")).strip(),
        str(task.input_json.get("history", "")).strip(),
        task.model,
    )
    return _create_discussion_message(task, content, "learning_path")


def _generate_exam(task):
    topic = task.topic
    if topic is None:
        raise ValueError("学习主题不存在。")
    context = task.input_json.get("context", "")
    if not context:
        raise ValueError("学习主题没有可用于出题的材料。")

    generated_questions = AIGateway.generate_exam(
        topic.title, topic.goal, context, task.model
    )
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
    grading = AIGateway.grade_exam(exam.topic.title, payload, task.model)
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


def _generate_review_prompt(task):
    review = task.review
    if review is None:
        raise ValueError("复习记录不存在。")
    topic = review.topic
    context = str(task.input_json.get("context", "")).strip()
    if not context:
        raise ValueError("复习记录缺少可用的学习上下文。")

    exam_feedback = review.exam.feedback if review.exam else ""
    content = AIGateway.generate_review_prompt(
        topic.title, topic.goal, context, exam_feedback, task.model
    ).strip()
    if not content:
        raise ValueError("AI 未生成复习提示。")

    generated_at = timezone.now()
    updated = ReviewRecord.objects.filter(pk=review.id, result="pending").update(
        review_prompt=content,
        review_prompt_generated_at=generated_at,
    )
    if not updated:
        raise ValueError("复习记录已完成，无法写入新的复习提示。")
    return {"review_id": review.id, "content": content}


def _review_interval_days(score):
    if score >= 85:
        return 14
    if score >= 60:
        return 7
    return 2


def _grade_review(task):
    review = task.review
    if review is None:
        raise ValueError("复习记录不存在。")
    context = str(task.input_json.get("context", "")).strip()
    response_text = str(task.input_json.get("response_text", "")).strip()
    if not context or not response_text:
        raise ValueError("复盘反馈缺少学习上下文或用户回答。")

    grading = AIGateway.grade_review(
        review.topic.title, context, response_text, task.model
    )
    completed_at = timezone.now()
    with transaction.atomic():
        review = ReviewRecord.objects.select_for_update().get(pk=review.id)
        if review.result == "completed":
            raise ValueError("该复习记录已经完成。")
        interval_days = _review_interval_days(grading["score"])
        next_due_at = completed_at + timedelta(days=interval_days)
        review.response_text = response_text
        review.feedback = grading["feedback"]
        review.score = grading["score"]
        review.result = "completed"
        review.completed_at = completed_at
        review.graded_at = completed_at
        review.next_due_at = next_due_at
        review.save(
            update_fields=[
                "response_text",
                "feedback",
                "score",
                "result",
                "completed_at",
                "graded_at",
                "next_due_at",
            ]
        )
        next_review, created = ReviewRecord.objects.get_or_create(
            previous_review=review,
            defaults={
                "topic": review.topic,
                "exam": review.exam,
                "due_at": next_due_at,
            },
        )
        if not created and next_review.due_at != next_due_at:
            next_review.due_at = next_due_at
            next_review.save(update_fields=["due_at"])
    return {
        "review_id": review.id,
        "score": grading["score"],
        "next_review_id": next_review.id,
        "next_due_at": next_due_at.isoformat(),
    }


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
