export type ProviderType = 'cloud' | 'local' | 'harness' | 'heuristic';
export type StageName =
  | 'vision_ocr'
  | 'requirement_negotiation'
  | 'notes_and_cheatsheet'
  | 'quiz_generation'
  | 'mindmap_generation';

export type RoutingMode = 'single' | 'smart_stage';
export type DifficultyLevel = 'beginner' | 'intermediate' | 'advanced' | 'exam_sprint';
export type NotesStyle = 'guided_learning' | 'concise_outline' | 'deep_dive' | 'in_class_recap';
export type QuizMode = 'in_class' | 'sync_layered' | 'exam_paper' | 'custom';

export interface CloudConfig {
  provider_label: string;
  api_format: 'openai_compatible' | 'anthropic';
  base_url: string;
  api_key: string;
  model: string;
  vision_model: string;
}

export interface LocalConfig {
  engine: 'ollama' | 'lmstudio';
  ollama_url: string;
  lmstudio_url: string;
  model: string;
  vision_model: string;
}

export interface HarnessConfig {
  preferred_cli: 'claude' | 'codex' | 'gemini' | 'custom';
  custom_command_template: string;
  timeout_seconds: number;
}

export interface ProviderSelection {
  provider: ProviderType;
  model_override?: string | null;
}

export interface RouterSettings {
  routing_mode: RoutingMode;
  active_provider: ProviderType;
  enable_fallback: boolean;
  cloud_config: CloudConfig;
  local_config: LocalConfig;
  harness_config: HarnessConfig;
  stage_mapping: Record<StageName, ProviderSelection>;
}

export interface HarnessStatusItem {
  name: string;
  available: boolean;
  executable_path?: string | null;
  description: string;
}

export interface ProviderStatusResponse {
  settings: RouterSettings;
  harnesses: HarnessStatusItem[];
  ollama_available: boolean;
  ollama_models: string[];
  lmstudio_available: boolean;
  lmstudio_models: string[];
  rapidocr_available: boolean;
}

export interface AssetItem {
  asset_id: string;
  filename: string;
  url: string;
  page_or_slide: number;
  caption: string;
  ocr_text: string;
}

export interface ChapterNode {
  chapter_id: string;
  title: string;
  start_page: number;
  end_page: number;
  char_count: number;
  summary_preview: string;
  content_text: string;
  assets: AssetItem[];
  key_terms: string[];
}

export interface DocumentIR {
  project_id: string;
  filename: string;
  file_type: string;
  created_at: string;
  total_pages_or_slides: number;
  total_chars: number;
  ocr_applied: boolean;
  chapters: ChapterNode[];
  all_assets: AssetItem[];
}

export interface DeliverableConfig {
  include_study_guide_notes: boolean;
  notes_style: NotesStyle;
  include_cheatsheet: boolean;
  cheatsheet_density: 'compact' | 'comprehensive';
  include_quiz: boolean;
  quiz_mode: QuizMode;
  mcq_count: number;
  fill_blank_count: number;
  short_answer_count: number;
  total_score: number;
  suggested_minutes: number;
  include_mindmap: boolean;
  mindmap_depth: number;
}

export interface PresetTemplate {
  preset_id: string;
  name: string;
  badge: string;
  description: string;
  icon: string;
  target_difficulty: DifficultyLevel;
  default_deliverables: DeliverableConfig;
  sample_prompt: string;
  pedagogical_focus: string[];
}

export interface StudyBlueprint {
  blueprint_id: string;
  blueprint_title: string;
  preset_id: string;
  preset_name: string;
  parsed_intent_summary: string;
  ai_feedback_message: string;
  target_difficulty: DifficultyLevel;
  selected_chapter_ids: string[];
  deliverables: DeliverableConfig;
  focus_topics: string[];
  custom_instructions: string;
  confirmed: boolean;
}

export interface QuizQuestion {
  id: string;
  type: 'mcq' | 'fill_blank' | 'short_answer';
  difficulty: 'easy' | 'medium' | 'hard';
  tier: '基础达标' | '能力提升' | '拓展探究';
  score: number;
  question: string;
  options: string[];
  answer: string;
  explanation: string;
  source_chapter: string;
  source_page: string;
}

export interface QuizPaper {
  title: string;
  mode: QuizMode;
  total_score: number;
  suggested_minutes: number;
  instructions: string;
  questions: QuizQuestion[];
}

export interface StudyPackage {
  project_id: string;
  blueprint_used: StudyBlueprint;
  generated_at: string;
  routing_trace: Record<string, string>;
  study_notes_markdown: string;
  cheatsheet_markdown: string;
  quiz_paper: QuizPaper;
  mindmap_mermaid: string;
}

export interface ProjectSummary {
  project_id: string;
  filename: string;
  file_type: string;
  created_at: string;
  total_pages_or_slides: number;
  chapter_count: number;
  has_blueprint: boolean;
  has_package: boolean;
}

export interface ProjectDetailResponse {
  document_ir: DocumentIR;
  blueprint: StudyBlueprint | null;
  study_package: StudyPackage | null;
}
