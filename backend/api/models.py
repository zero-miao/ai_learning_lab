from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


class SystemConfiguration(models.Model):
    PROVIDER_CHOICES = [
        ("ollama", "Ollama"),
        ("openai", "OpenAI 兼容服务"),
    ]
    SITE_THEME_CHOICES = [
        ("paper", "纯白"),
        ("sepia", "暖黄"),
        ("green", "护眼绿"),
        ("gray", "柔灰"),
        ("dark", "深黑"),
        ("midnight", "夜蓝"),
        ("charcoal", "炭灰"),
        ("coffee", "暖黑"),
    ]
    READER_FONT_CHOICES = [
        ("system", "系统字体"),
        ("song", "宋体"),
        ("kai", "楷体"),
        ("serif", "衬线字体"),
    ]

    singleton_id = models.PositiveSmallIntegerField(
        primary_key=True, default=1, editable=False
    )
    llm_provider_type = models.CharField(
        max_length=20, choices=PROVIDER_CHOICES, default="ollama"
    )
    llm_base_url = models.URLField(default="http://localhost:11434/v1")
    llm_api_key = models.CharField(max_length=500, blank=True, default="ollama")
    llm_model = models.CharField(max_length=100, default="qwen3.6:35b-a3b")
    llm_model_management_assistant = models.CharField(
        max_length=100, default="qwen3:30b-a3b"
    )
    llm_model_topic_chat = models.CharField(max_length=100, default="qwen3:30b-a3b")
    llm_model_supplement_query = models.CharField(
        max_length=100, default="qwen3:30b-a3b"
    )
    llm_model_supplement_evaluate = models.CharField(
        max_length=100, default="qwen3.6:35b-a3b"
    )
    llm_model_briefing = models.CharField(max_length=100, default="qwen3:30b-a3b")
    llm_model_clean_text = models.CharField(max_length=100, default="qwen3.6:35b-a3b")
    llm_model_answer_question = models.CharField(
        max_length=100, default="qwen3.6:35b-a3b"
    )
    llm_model_concept_draft = models.CharField(
        max_length=100, default="qwen3.6:35b-a3b"
    )
    llm_model_generate_exam = models.CharField(
        max_length=100, default="qwen3.6:35b-a3b"
    )
    llm_model_grade_exam = models.CharField(max_length=100, default="qwen3.6:35b-a3b")
    llm_model_review_prompt = models.CharField(max_length=100, default="qwen3:30b-a3b")
    llm_model_grade_review = models.CharField(max_length=100, default="qwen3.6:35b-a3b")
    ollama_keep_alive = models.CharField(max_length=30, blank=True, default="2m")
    asr_model = models.CharField(max_length=100, default="small")
    tts_voices = models.TextField(
        default=("zh-CN-XiaoxiaoNeural|晓晓,zh-CN-YunxiNeural|云希")
    )
    searxng_base_url = models.URLField(default="http://127.0.0.1:8080")
    crawl4ai_base_url = models.URLField(default="http://127.0.0.1:11235")
    supplement_relevance_threshold = models.FloatField(
        default=0.8,
        validators=[MinValueValidator(0), MaxValueValidator(1)],
    )
    default_site_theme = models.CharField(
        max_length=20, choices=SITE_THEME_CHOICES, default="paper"
    )
    default_reader_font = models.CharField(
        max_length=20, choices=READER_FONT_CHOICES, default="system"
    )
    api_timeout_ms = models.PositiveIntegerField(
        default=10000, validators=[MinValueValidator(1000)]
    )
    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def load(cls):
        from .system_config import default_configuration_values

        configuration, _ = cls.objects.get_or_create(
            singleton_id=1,
            defaults=default_configuration_values(),
        )
        return configuration

    def save(self, *args, **kwargs):
        self.singleton_id = 1
        super().save(*args, **kwargs)

    class Meta:
        verbose_name = "系统配置"
        verbose_name_plural = "系统配置"

    def __str__(self):
        return "系统配置"


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
    session = models.ForeignKey(
        "Session",
        related_name="discussion_topics",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="讨论会话",
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")

    class Meta:
        verbose_name = "学习主题"
        verbose_name_plural = "学习主题"
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["-updated_at"], name="topic_updated_idx"),
        ]

    def __str__(self):
        return self.title


class Material(models.Model):
    MEDIA_TYPE_CHOICES = [
        ("text", "纯文本"),
        ("web_page", "网页"),
        ("video", "视频"),
        ("audio", "音频"),
    ]
    STATUS_CHOICES = [
        ("pending", "待处理"),
        ("importing", "导入中"),
        ("cleaning", "清洗中"),
        ("summarizing", "摘要中"),
        ("generating_audio", "生成朗读音频"),
        ("ready", "已就绪"),
        ("failed", "失败"),
    ]
    CREATED_BY_CHOICES = [
        ("manual", "人工添加"),
        ("ai_recommended", "AI 推荐"),
    ]
    title = models.CharField(max_length=255, verbose_name="标题")
    media_type = models.CharField(
        max_length=20,
        choices=MEDIA_TYPE_CHOICES,
        default="text",
        db_index=True,
        verbose_name="媒体类型",
    )
    media_uri = models.CharField(max_length=1000, blank=True, verbose_name="媒体引用")
    media_meta = models.JSONField(default=dict, blank=True, verbose_name="媒体元信息")
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="pending",
        db_index=True,
        verbose_name="V2处理状态",
    )
    error = models.TextField(blank=True, verbose_name="V2处理错误")
    created_by = models.CharField(
        max_length=20,
        choices=CREATED_BY_CHOICES,
        default="manual",
        verbose_name="首次创建来源",
    )
    digest = models.TextField(blank=True, verbose_name="材料摘要")
    raw_text = models.TextField(blank=True, verbose_name="原始内容")
    clean_text = models.TextField(blank=True, verbose_name="处理后内容")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")

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
    start_time = models.FloatField(
        null=True, blank=True, verbose_name="媒体起始时间（秒）"
    )
    end_time = models.FloatField(
        null=True, blank=True, verbose_name="媒体结束时间（秒）"
    )

    class Meta:
        verbose_name = "材料片段"
        verbose_name_plural = "材料片段"
        ordering = ["chunk_index"]


class TopicMaterial(models.Model):
    IMPORT_BY_CHOICES = [
        ("manual", "人工添加"),
        ("ai_recommended", "AI 推荐"),
    ]
    CATEGORY_CHOICES = [
        ("exam_material", "考试材料"),
        ("recommended_reading", "推荐阅读"),
    ]

    topic = models.ForeignKey(
        Topic,
        related_name="topic_materials",
        on_delete=models.CASCADE,
        verbose_name="所属主题",
    )
    material = models.ForeignKey(
        Material,
        related_name="topic_materials",
        on_delete=models.CASCADE,
        verbose_name="关联材料",
    )
    import_by = models.CharField(
        max_length=20,
        choices=IMPORT_BY_CHOICES,
        default="manual",
        verbose_name="关联方式",
    )
    import_at = models.DateTimeField(auto_now_add=True, verbose_name="关联时间")
    import_reason = models.TextField(blank=True, verbose_name="导入理由")
    category = models.CharField(
        max_length=30,
        choices=CATEGORY_CHOICES,
        default="recommended_reading",
        verbose_name="材料分类",
    )
    relevance_score = models.FloatField(
        null=True, blank=True, verbose_name="主题相关度"
    )
    removed_at = models.DateTimeField(
        null=True, blank=True, verbose_name="从当前主题移除时间"
    )

    class Meta:
        verbose_name = "主题材料关联"
        verbose_name_plural = "主题材料关联"
        indexes = [
            models.Index(
                fields=["topic", "material"],
                name="topicmat_active_topic_idx",
                condition=models.Q(removed_at__isnull=True),
            ),
            models.Index(
                fields=["material", "topic"],
                name="topicmat_active_mat_idx",
                condition=models.Q(removed_at__isnull=True),
            ),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["topic", "material"], name="unique_topic_material"
            )
        ]


class Session(models.Model):
    system_prompt = models.TextField(blank=True, verbose_name="系统提示词")
    model = models.CharField(max_length=100, blank=True, verbose_name="使用模型")
    session_scene = models.CharField(
        max_length=100, blank=True, verbose_name="会话场景"
    )
    context_material = models.ForeignKey(
        Material,
        related_name="sessions",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="上下文材料",
    )
    context_msg = models.TextField(blank=True, verbose_name="压缩上下文")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")

    class Meta:
        verbose_name = "会话"
        verbose_name_plural = "会话"
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["-updated_at"], name="session_updated_idx"),
        ]


class SessionMessage(models.Model):
    MSG_FROM_CHOICES = [
        ("user", "用户"),
        ("ai", "AI"),
    ]

    session = models.ForeignKey(
        Session,
        related_name="messages",
        on_delete=models.CASCADE,
        verbose_name="所属会话",
    )
    msg_from = models.CharField(
        max_length=10, choices=MSG_FROM_CHOICES, verbose_name="消息来源"
    )
    msg_content = models.TextField(verbose_name="消息内容")
    msg_at = models.DateTimeField(auto_now_add=True, verbose_name="消息时间")

    class Meta:
        verbose_name = "会话消息"
        verbose_name_plural = "会话消息"
        ordering = ["msg_at", "id"]


class MaterialRecommendation(models.Model):
    STATUS_CHOICES = [
        ("pending", "待采纳"),
        ("adopted", "已采纳"),
        ("dismissed", "已忽略"),
    ]

    topic = models.ForeignKey(
        Topic,
        related_name="material_recommendations",
        on_delete=models.CASCADE,
        verbose_name="所属主题",
    )
    message = models.ForeignKey(
        SessionMessage,
        related_name="material_recommendations",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="关联回复",
    )
    source_task = models.ForeignKey(
        "AITask",
        related_name="material_recommendations",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="来源任务",
    )
    material = models.ForeignKey(
        Material,
        related_name="recommendations",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="采纳材料",
    )
    title = models.CharField(max_length=255, verbose_name="标题")
    url = models.URLField(max_length=1000, verbose_name="来源链接")
    content_snapshot = models.TextField(blank=True, verbose_name="正文快照")
    content_md5 = models.CharField(max_length=32, blank=True, db_index=True)
    category = models.CharField(
        max_length=30,
        choices=TopicMaterial.CATEGORY_CHOICES,
        default="recommended_reading",
        verbose_name="材料分类",
    )
    relevance_score = models.FloatField(verbose_name="主题相关度")
    reason = models.TextField(blank=True, verbose_name="推荐理由")
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="pending",
        db_index=True,
        verbose_name="采纳状态",
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="推荐时间")
    decided_at = models.DateTimeField(null=True, blank=True, verbose_name="处理时间")

    class Meta:
        verbose_name = "材料推荐"
        verbose_name_plural = "材料推荐"
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["topic", "url"], name="unique_topic_recommendation_url"
            )
        ]


class MaterialTextLocator(models.Model):
    ENTITY_TYPE_CHOICES = [
        ("concept", "概念"),
        ("highlight", "高亮"),
        ("question", "问题"),
    ]

    material = models.ForeignKey(
        Material,
        related_name="text_locators",
        on_delete=models.CASCADE,
        verbose_name="关联材料",
    )
    chunk = models.ForeignKey(
        MaterialChunk,
        related_name="text_locators",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="关联片段",
    )
    topic = models.ForeignKey(
        Topic,
        related_name="text_locators",
        on_delete=models.CASCADE,
        verbose_name="创建主题",
    )
    source_text = models.TextField(verbose_name="来源文本")
    start_offset = models.PositiveIntegerField(verbose_name="文本起始偏移")
    end_offset = models.PositiveIntegerField(verbose_name="文本结束偏移")
    time_start_offset = models.FloatField(
        null=True, blank=True, verbose_name="媒体起始时间（秒）"
    )
    time_end_offset = models.FloatField(
        null=True, blank=True, verbose_name="媒体结束时间（秒）"
    )
    entity_type = models.CharField(
        max_length=20, choices=ENTITY_TYPE_CHOICES, verbose_name="实体类型"
    )
    entity_id = models.PositiveBigIntegerField(verbose_name="实体ID")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")

    class Meta:
        verbose_name = "材料文本定位器"
        verbose_name_plural = "材料文本定位器"
        indexes = [
            models.Index(
                fields=["entity_type", "entity_id"],
                name="locator_entity_idx",
            ),
            models.Index(
                fields=["material", "time_start_offset"],
                name="locator_timeline_idx",
            ),
        ]


class Question(models.Model):
    session = models.ForeignKey(
        Session,
        related_name="questions",
        on_delete=models.CASCADE,
        verbose_name="所属会话",
    )
    question_text = models.TextField(verbose_name="问题内容")
    conclusion = models.TextField(blank=True, verbose_name="问答结论")
    status = models.CharField(
        max_length=20,
        choices=[("open", "开放"), ("closed", "已关闭")],
        default="open",
        verbose_name="V2状态",
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="提问时间")

    class Meta:
        verbose_name = "用户问题"
        verbose_name_plural = "用户问题"


class Concept(models.Model):
    STATUS_CHOICES = [
        ("draft", "草稿"),
        ("confirmed", "已确认"),
    ]

    topic = models.ForeignKey(
        Topic,
        related_name="concepts",
        on_delete=models.CASCADE,
        verbose_name="所属主题",
    )
    title = models.CharField(max_length=255, verbose_name="概念名称")
    definition = models.TextField(blank=True, verbose_name="定义")
    principle = models.TextField(blank=True, verbose_name="原理")
    pitfalls = models.TextField(blank=True, verbose_name="易错点")
    applications = models.TextField(blank=True, verbose_name="适用场景")
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="draft",
        db_index=True,
        verbose_name="状态",
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")

    class Meta:
        verbose_name = "概念卡片"
        verbose_name_plural = "概念卡片"
        ordering = ["-updated_at"]
        indexes = [
            models.Index(
                fields=["topic", "-updated_at"],
                name="concept_topic_updated_idx",
            ),
        ]

    def __str__(self):
        return self.title


class ConceptRelation(models.Model):
    from_topic = models.ForeignKey(
        Topic,
        related_name="outgoing_concept_relations",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="起始概念所属主题",
    )
    to_topic = models.ForeignKey(
        Topic,
        related_name="incoming_concept_relations",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="目标概念所属主题",
    )
    from_concept = models.ForeignKey(
        Concept,
        related_name="outgoing_relations",
        on_delete=models.CASCADE,
        verbose_name="起始概念",
    )
    to_concept = models.ForeignKey(
        Concept,
        related_name="incoming_relations",
        on_delete=models.CASCADE,
        verbose_name="目标概念",
    )
    relation_type = models.CharField(
        max_length=100,
        default="关联",
        verbose_name="关系类型",
    )
    description = models.TextField(blank=True, verbose_name="关系说明")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")

    class Meta:
        verbose_name = "概念关系"
        verbose_name_plural = "概念关系"
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["from_concept", "to_concept"],
                name="unique_concept_relation_direction",
            )
        ]

    def __str__(self):
        return (
            f"{self.from_concept.title} -[{self.relation_type}]-> "
            f"{self.to_concept.title}"
        )


class Highlight(models.Model):
    user_note = models.TextField(blank=True, verbose_name="用户备注")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")

    class Meta:
        verbose_name = "高亮"
        verbose_name_plural = "高亮"
        ordering = ["created_at"]


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
        indexes = [
            models.Index(
                fields=["topic", "-created_at"],
                name="exam_topic_created_idx",
            ),
        ]

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
    previous_review = models.ForeignKey(
        "self",
        related_name="follow_up_reviews",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="上一轮复习",
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
    response_text = models.TextField(blank=True, verbose_name="复盘回答")
    feedback = models.TextField(blank=True, verbose_name="复盘反馈")
    score = models.PositiveSmallIntegerField(
        null=True, blank=True, verbose_name="复盘得分"
    )
    graded_at = models.DateTimeField(null=True, blank=True, verbose_name="反馈生成时间")

    class Meta:
        verbose_name = "复习记录"
        verbose_name_plural = "复习记录"
        ordering = ["due_at"]
        indexes = [
            models.Index(
                fields=["result", "due_at"],
                name="review_result_due_idx",
            ),
        ]


class AITask(models.Model):
    # 任务类型由 backend/api/tasks.py 中的 TaskRegistry 自动注册和维护
    task_type = models.CharField(max_length=50, db_index=True, verbose_name="任务类型")
    STATUS_CHOICES = [
        ("pending", "等待执行"),
        ("running", "执行中"),
        ("succeeded", "已完成"),
        ("failed", "失败"),
        ("cancelled", "已取消"),
    ]
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="pending",
        db_index=True,
        verbose_name="任务状态",
    )
    priority = models.IntegerField(default=0, db_index=True, verbose_name="优先级")
    trigger_type = models.CharField(
        max_length=50, blank=True, db_index=True, verbose_name="触发方类型"
    )
    trigger_id = models.PositiveBigIntegerField(
        null=True, blank=True, db_index=True, verbose_name="触发方ID"
    )
    task_data = models.JSONField(default=dict, blank=True, verbose_name="任务数据")
    full_context = models.TextField(blank=True, verbose_name="LLM完整上下文")
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
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")

    class Meta:
        verbose_name = "AI任务"
        verbose_name_plural = "AI任务"
        ordering = ["-created_at"]
        indexes = [
            models.Index(
                fields=[
                    "trigger_type",
                    "trigger_id",
                    "task_type",
                    "-created_at",
                    "status",
                ],
                name="task_trigger_lookup_idx",
            ),
            models.Index(
                fields=["status", "-priority", "next_run_at", "id"],
                name="task_status_due_idx",
            ),
            models.Index(
                fields=["status", "task_type", "-created_at"],
                name="task_status_type_idx",
            ),
        ]

    def __str__(self):
        from .tasks import TaskRegistry

        choices = dict(TaskRegistry.get_choices())
        task_type_display = choices.get(self.task_type, self.task_type)
        return f"{task_type_display} #{self.pk} ({self.get_status_display()})"


class UserFeedback(models.Model):
    CATEGORY_CHOICES = [
        ("usability", "不好用"),
        ("bug", "功能异常"),
        ("content", "内容问题"),
        ("suggestion", "功能建议"),
        ("other", "其他"),
    ]
    STATUS_CHOICES = [
        ("new", "待处理"),
        ("reviewing", "处理中"),
        ("resolved", "已解决"),
    ]

    category = models.CharField(
        max_length=20,
        choices=CATEGORY_CHOICES,
        default="usability",
        db_index=True,
        verbose_name="反馈类型",
    )
    description = models.TextField(verbose_name="反馈内容")
    page_url = models.CharField(max_length=2000, blank=True, verbose_name="页面地址")
    page_title = models.CharField(max_length=255, blank=True, verbose_name="页面标题")
    user_agent = models.TextField(blank=True, verbose_name="浏览器信息")
    context = models.JSONField(default=dict, blank=True, verbose_name="页面上下文")
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="new",
        db_index=True,
        verbose_name="处理状态",
    )
    resolution_note = models.TextField(blank=True, verbose_name="处理记录")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")

    class Meta:
        verbose_name = "使用反馈"
        verbose_name_plural = "使用反馈"
        ordering = ["-created_at"]
        indexes = [
            models.Index(
                fields=["status", "-created_at"],
                name="feedback_status_created_idx",
            ),
            models.Index(
                fields=["category", "-created_at"],
                name="feedback_category_created_idx",
            ),
        ]

    def __str__(self):
        return f"{self.get_category_display()} #{self.pk}"
