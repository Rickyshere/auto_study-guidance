export type ProviderType = 'harness' | 'cloud';
export type UiVisualMode = 'academic_pure' | 'liquid_glass';
export type ScenarioType = 'A_beginner' | 'B_consolidate' | 'C_sprint';
export type ProjectType = 'courseware' | 'exam_paper';
export type ExamDirectionType = 'original_to_bank' | 'similar_paper' | 'both';

export type StageName =
  | 'vision_ocr'
  | 'requirement_negotiation'
  | 'notes_and_cheatsheet'
  | 'quiz_generation'
  | 'mindmap_generation'
  | 'global_quality_audit';

export type RoutingMode = 'single' | 'smart_stage';
export type DifficultyLevel = 'beginner' | 'intermediate' | 'advanced' | 'exam_sprint';
export type NotesStyle = 'guided_learning' | 'concise_outline' | 'deep_dive' | 'in_class_recap';
export type QuizMode = 'in_class' | 'sync_layered' | 'exam_paper' | 'custom';

export type OcrEngineType =
  | 'auto_recommend'
  | 'mineru_pipeline'
  | 'somark_free_api'
  | 'paddleocr'
  | 'mineru_full'
  | 'oxr_full'
  | 'rapidocr'
  | 'vision_vlm';

export type VramTier = 'le_8gb' | 'gt_8_lt_48gb' | 'ge_48gb';

export interface CloudConfig {
  provider_label: string;
  api_format: 'openai_compatible' | 'anthropic';
  base_url: string;
  api_key: string;
  model: string;
  vision_model: string;
}

export interface HarnessConfig {
  preferred_cli: 'dsh' | 'claude' | 'codex' | 'gemini' | 'custom';
  custom_command_template: string;
  timeout_seconds: number;
  max_retries: number;
}

export interface FreeAiAuthConfig {
  authorized_use_local_ai: boolean;
  authorized_at?: string | null;
  preferred_proxy_mode: 'magpie_dsh' | 'direct_cli';
  selected_free_model: string;
  magpie_gateway_url: string;
  magpie_gateway_key: string;
}

export interface OcrConfig {
  active_engine: OcrEngineType;
  detect_vram_on_startup: boolean;
  vram_override_gb?: number | null;
  somark_api_base_url: string;
  somark_api_key: string;
  mineru_service_url: string;
  oxr_service_url: string;
}

export interface ProviderSelection {
  provider: ProviderType;
  model_override?: string | null;
}

export interface RouterSettings {
  routing_mode: RoutingMode;
  active_provider: ProviderType;
  ui_visual_mode: UiVisualMode;
  enable_fallback: boolean;
  enable_quality_audit: boolean;
  cloud_config: CloudConfig;
  harness_config: HarnessConfig;
  free_ai_auth: FreeAiAuthConfig;
  ocr_config: OcrConfig;
  stage_mapping: Record<StageName, ProviderSelection>;
}

export interface HarnessStatusItem {
  name: string;
  available: boolean;
  executable_path?: string | null;
  description: string;
  install_supported: boolean;
  install_command_hint: string;
}

export interface FreeAiAppItem {
  app_id: 'qoder_cn' | 'workbuddy' | 'trae_cn' | 'magpie' | 'dsh';
  name: string;
  installed: boolean;
  running: boolean;
  executable_path?: string | null;
  config_path?: string | null;
  proxy_available: boolean;
  available_models: string[];
  description: string;
}

export interface GpuVramInfo {
  gpu_name: string;
  detected_vram_gb: number;
  effective_vram_gb: number;
  vram_tier: VramTier;
  recommended_ocr_engine: OcrEngineType;
  recommendation_reason: string;
}

export interface OcrEngineStatusItem {
  engine_id: OcrEngineType;
  name: string;
  tier_badge: string;
  installed: boolean;
  running: boolean;
  supports_one_click_setup: boolean;
  description: string;
  repo_or_api_url: string;
  /** 是否是当前「已保存」选中的引擎 */
  active?: boolean;
  /** 是否是解析 auto_recommend 之后真正会用的引擎 */
  effective?: boolean;
  /** 现在这一刻是否真的能产出文字 */
  available?: boolean;
  /** 人话状态：已安装 · 服务运行中 / 未安装 / 云端 API · 免部署 … */
  status_text?: string;
  status_kind?: '' | 'running' | 'idle' | 'missing' | 'builtin' | 'cloud' | 'cloud_error';
  uninstall_supported?: boolean;
}

export interface OcrRuntimeSummary {
  active_engine: OcrEngineType;
  active_label: string;
  effective_engine: OcrEngineType;
  effective_label: string;
  effective_ready: boolean;
  effective_status_text: string;
  effective_status_kind?: string;
  effective_reason: string;
  recommended_engine: OcrEngineType;
  recommended_label: string;
  fallbacks: string[];
  warning: string;
}

export interface ProviderStatusResponse {
  settings: RouterSettings;
  harnesses: HarnessStatusItem[];
  free_ai_apps: FreeAiAppItem[];
  magpie_available: boolean;
  magpie_gateway_running: boolean;
  magpie_models: string[];
  dsh_available: boolean;
  rapidocr_available: boolean;
  gpu_vram: GpuVramInfo;
  ocr_engines: OcrEngineStatusItem[];
  ocr_summary?: OcrRuntimeSummary;
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
  project_type?: ProjectType;
  filename: string;
  /** 用户自定义的工作区名称；为空时回退到 filename */
  workspace_title?: string;
  file_type: string;
  created_at: string;
  total_pages_or_slides: number;
  total_chars: number;
  ocr_applied: boolean;
  oxr_engine_used?: string;
  oxr_probe_summary?: string;
  raw_exam_text?: string;
  chapters: ChapterNode[];
  all_assets: AssetItem[];
  /** OCR/解析结果是否已被用户人工核对确认（未确认时不允许进入生成） */
  ocr_confirmed?: boolean;
  ocr_confirmed_at?: string;
  /** 逐页 OCR 体检：扫描页总数 / 成功页数 / 失败页号 */
  ocr_pages_total?: number;
  ocr_pages_ok?: number;
  ocr_failed_pages?: number[];
}

export interface DeliverableConfig {
  scenario_type: ScenarioType;
  selected_items: string[];
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

export interface DeliverableItemOption {
  item_id: string;
  label: string;
  description: string;
  export_formats: string[];
}

export interface PresetTemplate {
  preset_id: string;
  scenario_type: ScenarioType;
  name: string;
  badge: string;
  description: string;
  icon: string;
  target_difficulty: DifficultyLevel;
  default_deliverables: DeliverableConfig;
  sample_prompt: string;
  pedagogical_focus: string[];
  available_items: DeliverableItemOption[];
}

export interface StudyBlueprint {
  blueprint_id: string;
  blueprint_title: string;
  scenario_type: ScenarioType;
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
  knowledge_tags?: string[];
  applied_strategies?: string[];
  reverse_design?: string;
  blind_review_summary?: string;
}

export interface ExamToneAndPersona {
  stem_style: string;
  phrasing_habits: string[];
  option_length_style: string;
}

export interface ExamAgentStyleProfile {
  subject_and_level: string;
  overall_difficulty: string;
  tone_and_persona: ExamToneAndPersona;
  formatting_rules: string;
  user_override_directives: string[];
}

export interface ExamDistractorRecipeItem {
  item: string;
  trap_type: string;
  detail: string;
}

export interface ExamQuestionBlueprintItem {
  question_id: number;
  target_question_type: string;
  target_difficulty: string;
  knowledge_points: string[];
  original_skeleton: string;
  distractor_recipe: ExamDistractorRecipeItem[];
  assigned_strategies: string[];
  generation_directive: string;
}

export interface ExamGeneratedQuestionItem {
  question_id: number;
  question_type: string;
  knowledge_tags: string[];
  applied_strategies: string[];
  reverse_design: string;
  correct_answer: string;
  detailed_analysis: string;
  stem: string;
  options?: Record<string, string> | null;
}

export interface ExamBlindReviewResult {
  question_id: number;
  attempt: number;
  reasoning_process: string;
  my_answer: string;
  expected_answer: string;
  is_valid: boolean;
  passed: boolean;
  defect_report?: string | null;
}

export interface ExamPipelineMetadata {
  direction: ExamDirectionType;
  user_requirements: string;
  oxr_engine_used: string;
  oxr_probe_summary: string;
  soul_files_uploaded: string[];
  style_profile?: ExamAgentStyleProfile | null;
  question_blueprints: ExamQuestionBlueprintItem[];
  generated_items: ExamGeneratedQuestionItem[];
  blind_reviews: ExamBlindReviewResult[];
}

export interface ExamSoulSpec {
  agent_id: string;
  filename: string;
  name: string;
  summary: string;
  content: string;
}

export interface NoteSectionItem {
  section_id: string;
  title: string;
  level: number;
  char_count: number;
  has_practice: boolean;
}

export interface QuizPaper {
  paper_id: string;
  deliverable_type: string;
  title: string;
  mode: QuizMode;
  total_score: number;
  suggested_minutes: number;
  instructions: string;
  questions: QuizQuestion[];
}

export interface KnowledgeFlashcard {
  id: string;
  category: string;
  front: string;
  answer: string;
  explanation: string;
  source: string;
}

export interface StudyPackage {
  project_id: string;
  blueprint_used: StudyBlueprint;
  generated_at: string;
  routing_trace: Record<string, string>;
  quality_audit_report: string;
  study_notes_markdown: string;
  cheatsheet_markdown: string;
  quiz_paper: QuizPaper;
  extra_quiz_papers: QuizPaper[];
  flashcards?: KnowledgeFlashcard[];
  mindmap_mermaid: string;
  exam_pipeline_metadata?: ExamPipelineMetadata | null;
}

export interface VariantQuestionRequest {
  source_question: QuizQuestion;
  selected_chapter_ids: string[];
}

export interface ProjectSummary {
  project_id: string;
  project_type?: ProjectType;
  filename: string;
  /** 用户自定义的工作区名称；为空时回退到 filename */
  workspace_title?: string;
  file_type: string;
  created_at: string;
  total_pages_or_slides: number;
  chapter_count: number;
  has_blueprint: boolean;
  has_package: boolean;
}

export interface ProjectDetailResponse {
  document_ir: DocumentIR;
  blueprint?: StudyBlueprint | null;
  study_package?: StudyPackage | null;
}

export interface IncomingCommitItem {
  hash: string;
  message: string;
  date?: string;
  author: string;
  subject?: string;
}

export interface UpdateStatusResponse {
  repo_available?: boolean;
  /** false = 离线副本/无 Git 信息，无法热更新，界面需给出明确指引 */
  can_hot_update?: boolean;
  offline_reason?: string;
  install_root?: string;
  /** 前端 dist 过期或 exe 比源码旧：即使已是最新提交，也需要补齐构建 */
  artifacts_stale?: boolean;
  /** 远端改动涉及的补做项：pip / npm / exe */
  pending_deps?: string[];
  supported?: boolean;
  branch?: string;
  current_branch?: string;
  remote_url?: string;
  local_commit?: string;
  current_commit?: string;
  local_message?: string;
  local_date?: string;
  remote_commit?: string;
  remote_message?: string;
  behind_count: number;
  ahead_count?: number;
  has_update: boolean;
  update_available?: boolean;
  incoming_commits: IncomingCommitItem[];
  dirty_count?: number;
  checked_at?: string | null;
  push_notice_at?: string | null;
  fetch_error?: string | null;
  webhook_pending?: boolean;
  last_webhook_at?: string;
  reason?: string;
}
