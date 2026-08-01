from django.db import models


class Topic(models.Model):
    STATUS_CHOICES = [
        ("draft", "草稿"),
        ("learning", "学习中"),
        ("exam_ready", "待考试"),
        ("reviewing", "复习中"),
        ("archived", "已归档"),
    ]

    MASTERY_CHOICES = [
        ("unknown", "未知"),
        ("weak", "薄弱"),
        ("pass", "掌握"),
        ("strong", "熟练"),
    ]

    title = models.CharField(max_length=255, verbose_name="标题")
    goal = models.TextField(blank=True, verbose_name="学习目标")
    scope = models.TextField(blank=True, verbose_name="学习范围")
    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default="draft", verbose_name="状态"
    )
    mastery_level = models.CharField(
        max_length=20,
        choices=MASTERY_CHOICES,
        default="unknown",
        verbose_name="掌握程度",
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")

    class Meta:
        verbose_name = "学习主题"
        verbose_name_plural = "学习主题"
        ordering = ["-updated_at"]

    def __str__(self):
        return self.title


class Material(models.Model):
    TYPE_CHOICES = [
        ("url", "网页链接"),
        ("text", "纯文本"),
    ]

    IMPORT_STATUS_CHOICES = [
        ("pending", "处理中"),
        ("success", "成功"),
        ("failed", "失败"),
    ]

    topic = models.ForeignKey(
        Topic,
        related_name="materials",
        on_delete=models.CASCADE,
        verbose_name="所属主题",
    )
    type = models.CharField(max_length=10, choices=TYPE_CHOICES, verbose_name="类型")
    source_url = models.URLField(
        max_length=500, blank=True, null=True, verbose_name="来源URL"
    )
    title = models.CharField(max_length=255, verbose_name="标题")
    raw_text = models.TextField(blank=True, verbose_name="原始文本")
    clean_text = models.TextField(blank=True, verbose_name="清洗后文本")
    import_status = models.CharField(
        max_length=10,
        choices=IMPORT_STATUS_CHOICES,
        default="pending",
        verbose_name="导入状态",
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")

    class Meta:
        verbose_name = "学习材料"
        verbose_name_plural = "学习材料"

    def __str__(self):
        return self.title


class MaterialChunk(models.Model):
    material = models.ForeignKey(
        Material,
        related_name="chunks",
        on_delete=models.CASCADE,
        verbose_name="所属材料",
    )
    chunk_index = models.IntegerField(verbose_name="片段索引")
    content = models.TextField(verbose_name="片段内容")
    start_offset = models.IntegerField(verbose_name="起始偏移")
    end_offset = models.IntegerField(verbose_name="结束偏移")

    class Meta:
        verbose_name = "材料片段"
        verbose_name_plural = "材料片段"
        ordering = ["chunk_index"]


class Question(models.Model):
    topic = models.ForeignKey(
        Topic,
        related_name="questions",
        on_delete=models.CASCADE,
        verbose_name="所属主题",
    )
    material = models.ForeignKey(
        Material,
        related_name="questions",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        verbose_name="关联材料",
    )
    chunk = models.ForeignKey(
        MaterialChunk,
        related_name="questions",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        verbose_name="关联片段",
    )
    selected_text = models.TextField(blank=True, verbose_name="选中文本")
    question_text = models.TextField(verbose_name="问题内容")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="提问时间")

    class Meta:
        verbose_name = "用户问题"
        verbose_name_plural = "用户问题"


class AIResponse(models.Model):
    TASK_TYPE_CHOICES = [
        ("briefing", "阅读前导"),
        ("answer_question", "回答问题"),
        ("draft_note", "笔记草稿"),
        ("generate_exam", "生成考题"),
        ("grade_exam", "阅卷评分"),
    ]

    question = models.ForeignKey(
        Question,
        related_name="ai_responses",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        verbose_name="关联问题",
    )
    material = models.ForeignKey(
        Material,
        related_name="ai_responses",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        verbose_name="关联材料",
    )
    task_type = models.CharField(
        max_length=20, choices=TASK_TYPE_CHOICES, verbose_name="任务类型"
    )
    prompt_version = models.CharField(
        max_length=50, blank=True, verbose_name="Prompt版本"
    )
    content = models.TextField(verbose_name="回答内容")
    model = models.CharField(max_length=50, blank=True, verbose_name="使用模型")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="生成时间")

    class Meta:
        verbose_name = "AI响应"
        verbose_name_plural = "AI响应"


class Exam(models.Model):
    EXAM_TYPE_CHOICES = [
        ("topic", "主题综合测验"),
    ]
    STATUS_CHOICES = [
        ("draft", "待作答"),
        ("submitted", "已提交"),
        ("graded", "已评分"),
        ("failed", "生成或评分失败"),
    ]

    topic = models.ForeignKey(
        Topic,
        related_name="exams",
        on_delete=models.CASCADE,
        verbose_name="所属主题",
    )
    exam_type = models.CharField(
        max_length=20,
        choices=EXAM_TYPE_CHOICES,
        default="topic",
        verbose_name="考试类型",
    )
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="draft",
        verbose_name="状态",
    )
    score = models.PositiveSmallIntegerField(null=True, blank=True, verbose_name="得分")
    feedback = models.TextField(blank=True, verbose_name="总体反馈")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    submitted_at = models.DateTimeField(null=True, blank=True, verbose_name="提交时间")

    class Meta:
        verbose_name = "考试"
        verbose_name_plural = "考试"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.topic.title} - {self.get_exam_type_display()}"


class ExamQuestion(models.Model):
    exam = models.ForeignKey(
        Exam,
        related_name="questions",
        on_delete=models.CASCADE,
        verbose_name="所属考试",
    )
    question_type = models.CharField(
        max_length=50, default="transfer", verbose_name="题目类型"
    )
    scenario = models.TextField(blank=True, verbose_name="迁移场景")
    question_text = models.TextField(verbose_name="题目内容")
    rubric_json = models.JSONField(default=dict, blank=True, verbose_name="评分标准")
    answer_text = models.TextField(blank=True, verbose_name="用户作答")
    feedback = models.TextField(blank=True, verbose_name="评分反馈")
    score = models.PositiveSmallIntegerField(null=True, blank=True, verbose_name="得分")

    class Meta:
        verbose_name = "考试题目"
        verbose_name_plural = "考试题目"
        ordering = ["id"]


class ReviewRecord(models.Model):
    RESULT_CHOICES = [
        ("pending", "待复习"),
        ("completed", "已完成"),
    ]

    topic = models.ForeignKey(
        Topic,
        related_name="review_records",
        on_delete=models.CASCADE,
        verbose_name="所属主题",
    )
    exam = models.ForeignKey(
        Exam,
        related_name="review_records",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="关联考试",
    )
    due_at = models.DateTimeField(db_index=True, verbose_name="应复习时间")
    completed_at = models.DateTimeField(null=True, blank=True, verbose_name="完成时间")
    result = models.CharField(
        max_length=20,
        choices=RESULT_CHOICES,
        default="pending",
        verbose_name="结果",
    )
    next_due_at = models.DateTimeField(
        null=True, blank=True, verbose_name="下次复习时间"
    )
    review_prompt = models.TextField(blank=True, verbose_name="复习提示")
    review_prompt_generated_at = models.DateTimeField(
        null=True, blank=True, verbose_name="复习提示生成时间"
    )

    class Meta:
        verbose_name = "复习记录"
        verbose_name_plural = "复习记录"
        ordering = ["due_at"]


class Note(models.Model):
    topic = models.ForeignKey(
        Topic,
        related_name="notes",
        on_delete=models.CASCADE,
        verbose_name="所属主题",
    )
    title = models.CharField(max_length=255, verbose_name="标题")
    content = models.TextField(verbose_name="笔记内容")
    material_fingerprint = models.CharField(
        max_length=64, blank=True, db_index=True, verbose_name="材料指纹"
    )
    source_task = models.ForeignKey(
        "AITask",
        related_name="confirmed_notes",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="来源任务",
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")

    class Meta:
        verbose_name = "结构化笔记"
        verbose_name_plural = "结构化笔记"
        ordering = ["-updated_at"]

    def __str__(self):
        return self.title


class AITask(models.Model):
    TASK_TYPE_CHOICES = [
        ("briefing", "阅读前导"),
        ("answer_question", "回答问题"),
        ("generate_exam", "生成考题"),
        ("grade_exam", "阅卷评分"),
        ("note_draft", "笔记草稿"),
        ("review_prompt", "复习提示"),
    ]
    STATUS_CHOICES = [
        ("pending", "等待执行"),
        ("running", "执行中"),
        ("succeeded", "已完成"),
        ("failed", "失败"),
        ("cancelled", "已取消"),
    ]

    task_type = models.CharField(
        max_length=30, choices=TASK_TYPE_CHOICES, verbose_name="任务类型"
    )
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="pending",
        db_index=True,
        verbose_name="任务状态",
    )
    topic = models.ForeignKey(
        Topic,
        related_name="ai_tasks",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        verbose_name="关联主题",
    )
    material = models.ForeignKey(
        Material,
        related_name="ai_tasks",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        verbose_name="关联材料",
    )
    question = models.ForeignKey(
        Question,
        related_name="ai_tasks",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        verbose_name="关联问题",
    )
    exam = models.ForeignKey(
        Exam,
        related_name="ai_tasks",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        verbose_name="关联考试",
    )
    review = models.ForeignKey(
        ReviewRecord,
        related_name="ai_tasks",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        verbose_name="关联复习记录",
    )
    input_json = models.JSONField(default=dict, blank=True, verbose_name="任务输入")
    result_json = models.JSONField(default=dict, blank=True, verbose_name="任务结果")
    error_message = models.TextField(blank=True, verbose_name="错误信息")
    attempt_count = models.PositiveSmallIntegerField(
        default=0, verbose_name="已尝试次数"
    )
    max_attempts = models.PositiveSmallIntegerField(
        default=3, verbose_name="最大尝试次数"
    )
    next_run_at = models.DateTimeField(db_index=True, verbose_name="下次执行时间")
    started_at = models.DateTimeField(null=True, blank=True, verbose_name="开始时间")
    finished_at = models.DateTimeField(null=True, blank=True, verbose_name="完成时间")
    model = models.CharField(max_length=100, blank=True, verbose_name="使用模型")
    prompt_version = models.CharField(
        max_length=50, blank=True, verbose_name="Prompt版本"
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")

    class Meta:
        verbose_name = "AI任务"
        verbose_name_plural = "AI任务"
        ordering = ["-created_at"]

    def __str__(self):
        return (
            f"{self.get_task_type_display()} #{self.pk} ({self.get_status_display()})"
        )
