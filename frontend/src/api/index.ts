import axios from 'axios';

const api = axios.create({
  baseURL: 'http://127.0.0.1:8000/api/',
  timeout: 10000,
});

export interface Material {
  id: number;
  topic: number;
  type: 'url' | 'text';
  type_display: string;
  source_type: 'manual' | 'ai_recommended';
  source_type_display: string;
  source_url: string;
  title: string;
  raw_text: string;
  clean_text: string;
  import_status: 'pending' | 'success' | 'failed';
  import_status_display: string;
  created_at: string;
  chunks: any[];
  ai_responses: AIResponse[];
}

export interface AIResponse {
  id: number;
  task_type: string;
  task_type_display: string;
  content: string;
  model: string;
  created_at: string;
}

export interface Topic {
  id: number;
  title: string;
  type: 'learning' | 'discussion';
  type_display: string;
  goal: string;
  scope: string;
  status: 'draft' | 'learning' | 'exam_ready' | 'reviewing' | 'archived';
  status_display: string;
  mastery_level: 'unknown' | 'weak' | 'pass' | 'strong';
  mastery_level_display: string;
  created_at: string;
  updated_at: string;
  materials: Material[];
  notes: Note[];
  has_current_note: boolean;
}

export interface Note {
  id: number;
  topic: number;
  title: string;
  content: string;
  material_fingerprint: string;
  source_task: number | null;
  created_at: string;
  updated_at: string;
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
  review_due_at: string | null;
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
  due_at: string;
  completed_at: string | null;
  result: 'pending' | 'completed';
  result_display: string;
  next_due_at: string | null;
  review_prompt: string;
  review_prompt_generated_at: string | null;
}

export type AITaskStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface AITask {
  id: number;
  task_type: 'briefing' | 'answer_question' | 'generate_exam' | 'grade_exam' | 'note_draft' | 'review_prompt';
  task_type_display: string;
  status: AITaskStatus;
  status_display: string;
  topic: number | null;
  material: number | null;
  question: number | null;
  exam: number | null;
  review: number | null;
  result_json: Record<string, unknown>;
  error_message: string;
  attempt_count: number;
  max_attempts: number;
  next_run_at: string;
  started_at: string | null;
  finished_at: string | null;
  model: string;
  prompt_version: string;
  created_at: string;
  updated_at: string;
}

export interface Question {
  id: number;
  topic: number;
  material: number | null;
  chunk: number | null;
  selected_text: string;
  question_text: string;
  created_at: string;
  ai_responses: AIResponse[];
}

export interface TaskResponse {
  task: AITask;
}

export const getTopics = () => api.get<Topic[]>('topics/');
export const getTopic = (id: number) => api.get<Topic>(`topics/${id}/`);
export const createTopic = (data: Partial<Topic>) => api.post<Topic>('topics/', data);
export const updateTopic = (id: number, data: Partial<Topic>) => api.patch<Topic>(`topics/${id}/`, data);
export const deleteTopic = (id: number) => api.delete(`topics/${id}/`);
export const createMaterial = (data: Partial<Material>) => api.post<Material>('materials/', data);
export const deleteMaterial = (id: number) => api.delete(`materials/${id}/`);
export const createNoteDraft = (topicId: number, instructions = '') =>
  api.post<TaskResponse>(`topics/${topicId}/note-drafts/`, { instructions });
export const createNote = (data: Partial<Note>) => api.post<Note>('notes/', data);
export const updateNote = (id: number, data: Partial<Note>) =>
  api.patch<Note>(`notes/${id}/`, data);
export const deleteNote = (id: number) => api.delete(`notes/${id}/`);
export const checkHealth = () => api.get('health/');
export const getQuestion = (id: number) => api.get<Question>(`questions/${id}/`);
export const createQuestion = (data: Partial<Question>) => api.post<{ question: Question; task: AITask }>('questions/', data);
export const getExam = (id: number) => api.get<Exam>(`exams/${id}/`);
export const createExam = (topic: number) => api.post<TaskResponse>('exams/', { topic });
export const submitExam = (id: number, answers: Array<{ id: number; answer_text: string }>) =>
  api.post<TaskResponse>(`exams/${id}/submit/`, { answers });
export const getReviews = (params?: { result?: ReviewRecord['result'] }) =>
  api.get<ReviewRecord[]>('reviews/', { params });
export const completeReview = (id: number) =>
  api.post<ReviewRecord>(`reviews/${id}/complete/`);
export const createReviewPrompt = (id: number) =>
  api.post<TaskResponse>(`reviews/${id}/prompt/`);
export const getAITask = (id: number) => api.get<AITask>(`ai-tasks/${id}/`);
export const listAITasks = (params: Record<string, number>) => api.get<AITask[]>('ai-tasks/', { params });
export const retryAITask = (id: number) => api.post<AITask>(`ai-tasks/${id}/retry/`);

export default api;
