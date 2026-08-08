import axios from 'axios';

const configuredTimeout = Number(import.meta.env.VITE_API_TIMEOUT_MS);

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api/',
  timeout:
    Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? configuredTimeout
      : 10000,
});

export const setApiTimeout = (timeout: number) => {
  if (Number.isFinite(timeout) && timeout >= 1000) {
    api.defaults.timeout = timeout;
  }
};

export type MaterialStatus =
  | 'pending'
  | 'importing'
  | 'cleaning'
  | 'summarizing'
  | 'generating_audio'
  | 'ready'
  | 'failed';
export type AITaskStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface PaginationParams {
  page?: number;
  page_size?: number;
}

export interface MaterialChunk {
  id: number;
  chunk_index: number;
  content: string;
  start_offset: number;
  end_offset: number;
  start_time: number | null;
  end_time: number | null;
}

export interface MaterialSummary {
  id: number;
  title: string;
  created_by: 'manual' | 'ai_recommended';
  created_at: string;
  updated_at: string;
  error: string;
  media_type: 'text' | 'web_page' | 'video' | 'audio';
  media_uri: string;
  tts_assets: Array<{
    voice: string;
    label: string;
    status: 'ready' | 'failed';
    url: string;
    error: string;
  }>;
  status: MaterialStatus;
  status_display: string;
  topic_links: Array<{
    topic: number;
    topic_title: string;
    category: 'exam_material' | 'recommended_reading';
    import_by: 'manual' | 'ai_recommended';
    import_at: string;
    relevance_score: number | null;
  }>;
  raw_text_length: number;
  clean_text_length: number;
  digest_length: number;
  chunk_count: number;
}

export interface Material
  extends Omit<
    MaterialSummary,
    'raw_text_length' | 'clean_text_length' | 'digest_length' | 'chunk_count'
  > {
  media_url: string;
  raw_text: string;
  clean_text: string;
  media_meta: Record<string, unknown>;
  digest: string;
  chunks: MaterialChunk[];
}

export interface TopicMaterial {
  id: number;
  topic: number;
  material: Material;
  material_id: number;
  import_by: 'manual' | 'ai_recommended';
  import_at: string;
  import_reason: string;
  category: 'exam_material' | 'recommended_reading';
  relevance_score: number | null;
  removed_at: string | null;
}

export interface MaterialTextLocator {
  id: number;
  material: number;
  material_title: string;
  chunk: number | null;
  topic: number;
  topic_title: string;
  source_text: string;
  start_offset: number;
  end_offset: number;
  time_start_offset: number | null;
  time_end_offset: number | null;
  entity_type: 'concept' | 'highlight' | 'question';
  entity_id: number;
  created_at: string;
}

export interface Concept {
  id: number;
  topic: number;
  title: string;
  definition: string;
  principle: string;
  pitfalls: string;
  applications: string;
  status: 'draft' | 'confirmed';
  status_display: string;
  locators: MaterialTextLocator[];
  created_at: string;
  updated_at: string;
}

export interface Highlight {
  id: number;
  user_note: string;
  created_at: string;
  updated_at: string;
  locators: MaterialTextLocator[];
}

export interface Question {
  id: number;
  session: number;
  question_text: string;
  conclusion: string;
  status: 'open' | 'closed';
  status_display: string;
  created_at: string;
  locators: MaterialTextLocator[];
}

export interface ConceptRelation {
  id: number;
  from_topic: number | null;
  to_topic: number | null;
  from_concept: number;
  from_concept_title: string;
  to_concept: number;
  to_concept_title: string;
  relation_type: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface SessionMessage {
  id: number;
  session: number;
  msg_from: 'user' | 'ai';
  msg_content: string;
  msg_at: string;
}

export interface MaterialRecommendation {
  id: number;
  topic: number;
  message: number | null;
  source_task: number | null;
  material: number | null;
  title: string;
  url: string;
  category: 'exam_material' | 'recommended_reading';
  category_display: string;
  relevance_score: number;
  reason: string;
  status: 'pending' | 'adopted' | 'dismissed';
  status_display: string;
  created_at: string;
  decided_at: string | null;
}

export interface Session {
  id: number;
  system_prompt: string;
  model: string;
  session_scene: string;
  context_material: number | null;
  context_msg: string;
  created_at: string;
  updated_at: string;
  messages: SessionMessage[];
}

export interface TopicSummary {
  id: number;
  title: string;
  goal: string;
  status: 'draft' | 'learning' | 'exam_ready' | 'reviewing' | 'archived';
  status_display: string;
  mastery_level: 'unknown' | 'weak' | 'pass' | 'strong';
  mastery_level_display: string;
  created_at: string;
  updated_at: string;
  material_count: number;
}

export interface Topic extends Omit<TopicSummary, 'material_count'> {
  scope: string;
  session: number | null;
  topic_materials: TopicMaterial[];
  concepts: Concept[];
  questions: Question[];
  concept_relations: ConceptRelation[];
  highlights: Highlight[];
  learning_output: {
    concept_count: number;
    question_count: number;
    map_node_count: number;
  };
}

export interface MaterialAnnotations {
  concepts: Concept[];
  questions: Question[];
  highlights: Highlight[];
}

export interface AITaskSummary {
  id: number;
  task_type: string;
  task_type_display: string;
  status: AITaskStatus;
  status_display: string;
  priority: number;
  trigger_type: string;
  trigger_id: number | null;
  error_message: string;
  attempt_count: number;
  max_attempts: number;
  next_run_at: string;
  started_at: string | null;
  finished_at: string | null;
  model: string;
  created_at: string;
  updated_at: string;
}

export interface AITask extends AITaskSummary {
  task_data: Record<string, any>;
  full_context: string;
  result_json: Record<string, any>;
}

export interface ExamQuestion {
  id: number;
  question_type: string;
  scenario: string;
  question_text: string;
  rubric_json: Record<string, unknown>;
  answer_text: string;
  feedback: string;
  score: number | null;
}

export interface Exam {
  id: number;
  topic: number;
  exam_type: 'topic';
  exam_type_display: string;
  status: 'draft' | 'submitted' | 'graded' | 'failed';
  status_display: string;
  score: number | null;
  feedback: string;
  created_at: string;
  submitted_at: string | null;
  questions: ExamQuestion[];
}

export interface ReviewRecord {
  id: number;
  topic: number;
  topic_title: string;
  topic_mastery_level: Topic['mastery_level'];
  topic_mastery_level_display: string;
  exam: number | null;
  exam_score: number | null;
  previous_review: number | null;
  due_at: string;
  completed_at: string | null;
  result: 'pending' | 'completed';
  result_display: string;
  next_due_at: string | null;
  review_prompt: string;
  review_prompt_generated_at: string | null;
  response_text: string;
  feedback: string;
  score: number | null;
  graded_at: string | null;
}

export interface SystemConfiguration {
  llm_provider_type: 'ollama' | 'openai';
  llm_base_url: string;
  llm_api_key: string;
  llm_model: string;
  llm_model_topic_chat: string;
  llm_model_supplement_query: string;
  llm_model_supplement_evaluate: string;
  llm_model_briefing: string;
  llm_model_clean_text: string;
  llm_model_answer_question: string;
  llm_model_concept_draft: string;
  llm_model_generate_exam: string;
  llm_model_grade_exam: string;
  llm_model_review_prompt: string;
  llm_model_grade_review: string;
  ollama_keep_alive: string;
  asr_model: string;
  tts_voices: string;
  searxng_base_url: string;
  crawl4ai_base_url: string;
  supplement_relevance_threshold: number;
  default_site_theme:
    | 'paper'
    | 'sepia'
    | 'green'
    | 'gray'
    | 'dark'
    | 'midnight'
    | 'charcoal'
    | 'coffee';
  default_reader_font: 'system' | 'song' | 'kai' | 'serif';
  api_timeout_ms: number;
  updated_at: string;
}

export type FeedbackCategory =
  | 'usability'
  | 'bug'
  | 'content'
  | 'suggestion'
  | 'other';

export interface UserFeedback {
  id: number;
  category: FeedbackCategory;
  category_display: string;
  description: string;
  page_url: string;
  page_title: string;
  user_agent: string;
  context: Record<string, unknown>;
  status: 'new' | 'reviewing' | 'resolved';
  status_display: string;
  resolution_note: string;
  created_at: string;
  updated_at: string;
}

export const getSystemConfiguration = () =>
  api.get<SystemConfiguration>('system-configuration/');
export const discoverProviderModels = (
  data: Pick<
    SystemConfiguration,
    'llm_provider_type' | 'llm_base_url' | 'llm_api_key'
  >,
) => api.post<{ models: string[] }>('system-configuration/models/', data);
export const updateSystemConfiguration = (
  data: Omit<SystemConfiguration, 'updated_at'>,
) =>
  api.put<SystemConfiguration>('system-configuration/', data);

export const getSession = (id: number) => api.get<Session>(`sessions/${id}/`);
export const createSessionMessage = (sessionId: number, content: string) =>
  api.post<{ message: SessionMessage; task: AITask }>(
    `sessions/${sessionId}/messages/`,
    { content },
  );

export const getTopics = (params?: PaginationParams & { q?: string }) =>
  api.get<PaginatedResponse<TopicSummary>>('topics/', { params });
export const getTopic = (id: number) => api.get<Topic>(`topics/${id}/`);
export const createTopic = (data: Pick<Topic, 'title'> & Partial<Pick<Topic, 'goal' | 'scope'>>) =>
  api.post<Topic>('topics/', data);
export const updateTopic = (
  id: number,
  data: Partial<Pick<Topic, 'title' | 'goal' | 'scope' | 'status' | 'mastery_level'>>,
) =>
  api.patch<Topic>(`topics/${id}/`, data);
export const deleteTopic = (id: number) => api.delete(`topics/${id}/`);
export const createMaterial = (data: {
  topic: number;
  title: string;
  media_type: 'text' | 'web_page';
  media_uri?: string;
  raw_text?: string;
  existing_material_id?: number;
}) => api.post<Material>('materials/', data);
export const getMaterials = (params?: Record<string, string | number>) =>
  api.get<PaginatedResponse<MaterialSummary>>('materials/', { params });
export const getMaterial = (id: number) => api.get<Material>(`materials/${id}/`);
export const getMaterialAnnotations = (id: number, topic?: number) =>
  api.get<MaterialAnnotations>(`materials/${id}/annotations/`, {
    params: topic ? { topic } : undefined,
  });
export const reImportMaterial = (id: number) =>
  api.post<{ material: Material; task: AITask | null }>(`materials/${id}/re_import/`);
export const deleteMaterial = (id: number) => api.delete(`materials/${id}/`);
export const uploadVideo = (data: FormData) =>
  api.post<{ material: Material; task: AITask }>('materials/upload-video/', data, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
export const triggerSupplement = (
  topicId: number,
  triggerSourceType: 'Topic' | 'Concept' | 'Question' | 'Highlight' = 'Topic',
  triggerSourceId?: number,
) =>
  api.post<{ task: AITask; created: boolean }>(`topics/${topicId}/supplement/`, {
    trigger_source_type: triggerSourceType,
    trigger_source_id: triggerSourceId,
  });
export const updateTopicMaterial = (
  id: number,
  data: Pick<TopicMaterial, 'category'>,
) => api.patch<TopicMaterial>(`topic-materials/${id}/`, data);
export const linkMaterialToTopic = (material: number, topic: number) =>
  api.post<TopicMaterial>('topic-materials/', { material, topic });
export const removeTopicMaterial = (id: number) =>
  api.delete(`topic-materials/${id}/`);
export const getDiscussion = (topicId: number) =>
  api.get<{
    messages: SessionMessage[];
    recommendations: MaterialRecommendation[];
    active_tasks: AITask[];
  }>(
    `topics/${topicId}/discussion/`,
  );
export const createDiscussionMessage = (topicId: number, content: string) =>
  api.post<{ message: SessionMessage; task: AITask }>(
    `topics/${topicId}/discussion/`,
    { content },
  );
export const adoptMaterialRecommendation = (id: number) =>
  api.post<{
    recommendation: MaterialRecommendation;
    topic_material: TopicMaterial;
    task: AITask | null;
  }>(`material-recommendations/${id}/adopt/`);
export const dismissMaterialRecommendation = (id: number) =>
  api.post<MaterialRecommendation>(`material-recommendations/${id}/dismiss/`);
export const createQuestion = (data: {
  topic: number;
  material: number;
  start_offset: number;
  end_offset: number;
  question_text: string;
}) => api.post<{ question: Question; task: AITask }>('questions/', data);
export const deleteQuestion = (id: number) => api.delete(`questions/${id}/`);
export const createConcept = (
  topicId: number,
  data: { title: string; material: number; start_offset: number; end_offset: number },
) => api.post<{ concept: Concept; task: AITask }>(`topics/${topicId}/concepts/`, data);
export const updateConcept = (id: number, data: Partial<Concept>) =>
  api.patch<Concept>(`concepts/${id}/`, data);
export const deleteConcept = (id: number) => api.delete(`concepts/${id}/`);
export const createConceptRelation = (
  data: Pick<ConceptRelation, 'from_concept' | 'to_concept' | 'relation_type' | 'description'>,
) => api.post<ConceptRelation>('concept-relations/', data);
export const updateConceptRelation = (
  id: number,
  data: Partial<ConceptRelation>,
) => api.patch<ConceptRelation>(`concept-relations/${id}/`, data);
export const deleteConceptRelation = (id: number) =>
  api.delete(`concept-relations/${id}/`);
export const createHighlight = (
  topicId: number,
  data: { material: number; start_offset: number; end_offset: number; user_note?: string },
) => api.post<Highlight>(`topics/${topicId}/highlights/`, data);
export const deleteHighlight = (id: number) => api.delete(`highlights/${id}/`);
export const updateHighlight = (id: number, data: Pick<Highlight, 'user_note'>) =>
  api.patch<Highlight>(`highlights/${id}/`, data);
export const getExams = (params?: PaginationParams & { topic?: number }) =>
  api.get<PaginatedResponse<Exam>>('exams/', { params });
export const getExam = (id: number) => api.get<Exam>(`exams/${id}/`);
export const createExam = (topic: number) =>
  api.post<{ task: AITask }>('exams/', { topic });
export const saveExamAnswers = (
  id: number,
  answers: Array<{ id: number; answer_text: string }>,
) => api.post<Exam>(`exams/${id}/save/`, { answers });
export const submitExam = (
  id: number,
  answers: Array<{ id: number; answer_text: string }>,
) => api.post<{ task: AITask }>(`exams/${id}/submit/`, { answers });
export const getReviews = (
  params?: PaginationParams & { result?: ReviewRecord['result'] },
) => api.get<PaginatedResponse<ReviewRecord>>('reviews/', { params });
export const createReviewPrompt = (id: number) =>
  api.post<{ task: AITask }>(`reviews/${id}/prompt/`);
export const submitReview = (id: number, responseText: string) =>
  api.post<{ task: AITask }>(`reviews/${id}/submit/`, {
    response_text: responseText,
  });
export const getAITask = (id: number) => api.get<AITask>(`ai-tasks/${id}/`);
export const listAITasks = (params?: Record<string, string | number>) =>
  api.get<PaginatedResponse<AITaskSummary>>('ai-tasks/', { params });
export const retryAITask = (id: number) =>
  api.post<AITask>(`ai-tasks/${id}/retry/`);
export const createUserFeedback = (
  data: Pick<UserFeedback, 'category' | 'description' | 'page_url' | 'page_title' | 'user_agent' | 'context'>,
) => api.post<UserFeedback>('feedback/', data);

export default api;
