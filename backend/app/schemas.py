from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field

ProviderType = Literal["harness", "cloud"]
UiVisualMode = Literal["academic_pure", "liquid_glass"]
ScenarioType = Literal["A_beginner", "B_consolidate", "C_sprint"]
ProjectType = Literal["courseware", "exam_paper"]
ExamDirectionType = Literal["original_to_bank", "similar_paper", "both"]
StageName = Literal[
    "vision_ocr",
    "requirement_negotiation",
    "notes_and_cheatsheet",
    "quiz_generation",
    "mindmap_generation",
    "global_quality_audit",
]
RoutingMode = Literal["single", "smart_stage"]
DifficultyLevel = Literal["beginner", "intermediate", "advanced", "exam_sprint"]
NotesStyle = Literal["guided_learning", "concise_outline", "deep_dive", "in_class_recap"]
QuizMode = Literal["in_class", "sync_layered", "exam_paper", "custom"]
OcrEngineType = Literal[
    "auto_recommend",
    "mineru_pipeline",
    "somark_free_api",
    "paddleocr",
    "mineru_full",
    "oxr_full",
    "rapidocr",
    "vision_vlm",
]
VramTier = Literal["le_8gb", "gt_8_lt_48gb", "ge_48gb"]


class CloudConfig(BaseModel):
    provider_label: str = "OpenAI 兼容接口"
    api_format: Literal["openai_compatible", "anthropic"] = "openai_compatible"
    base_url: str = "https://api.openai.com/v1"
    api_key: str = ""
    model: str = "gpt-4o-mini"
    vision_model: str = "gpt-4o-mini"


class HarnessConfig(BaseModel):
    preferred_cli: Literal["dsh", "claude", "codex", "gemini", "custom"] = "dsh"
    custom_command_template: str = ""
    # 停滞超时：子进程连续这么久没有任何新输出才算“卡死”（不是总时长上限，
    # 长时间流式生成只要有新内容就会不断续期）。
    timeout_seconds: int = 180
    # 总时长兜底：防止进程半死不活地无限拖着，默认 30 分钟。
    max_total_seconds: int = 1800
    max_retries: int = 2


class FreeAiAuthConfig(BaseModel):
    authorized_use_local_ai: bool = False
    authorized_at: Optional[str] = None
    preferred_proxy_mode: Literal["magpie_dsh", "direct_cli"] = "magpie_dsh"
    selected_free_model: str = "qoder-cn/fast"
    magpie_gateway_url: str = "http://127.0.0.1:3425/v1"
    magpie_gateway_key: str = "magpie"


class OcrConfig(BaseModel):
    active_engine: OcrEngineType = "auto_recommend"
    detect_vram_on_startup: bool = True
    vram_override_gb: Optional[float] = None
    somark_api_base_url: str = "https://free-oxr.somark.ai/api/v1"
    somark_api_key: str = ""
    mineru_service_url: str = "http://127.0.0.1:8010"
    oxr_service_url: str = "http://127.0.0.1:8020"


class ProviderSelection(BaseModel):
    provider: ProviderType = "harness"
    model_override: Optional[str] = None


class RouterSettings(BaseModel):
    routing_mode: RoutingMode = "single"
    active_provider: ProviderType = "harness"
    ui_visual_mode: UiVisualMode = "academic_pure"
    enable_fallback: bool = False
    enable_quality_audit: bool = True
    cloud_config: CloudConfig = Field(default_factory=CloudConfig)
    harness_config: HarnessConfig = Field(default_factory=HarnessConfig)
    free_ai_auth: FreeAiAuthConfig = Field(default_factory=FreeAiAuthConfig)
    ocr_config: OcrConfig = Field(default_factory=OcrConfig)
    stage_mapping: Dict[StageName, ProviderSelection] = Field(
        default_factory=lambda: {
            "vision_ocr": ProviderSelection(provider="harness"),
            "requirement_negotiation": ProviderSelection(provider="harness"),
            "notes_and_cheatsheet": ProviderSelection(provider="harness"),
            "quiz_generation": ProviderSelection(provider="harness"),
            "mindmap_generation": ProviderSelection(provider="harness"),
            "global_quality_audit": ProviderSelection(provider="harness"),
        }
    )


class HarnessStatusItem(BaseModel):
    name: str
    available: bool
    executable_path: Optional[str] = None
    description: str
    install_supported: bool = True
    install_command_hint: str = ""


class GpuVramInfo(BaseModel):
    gpu_name: str = "未检测到独立 NVIDIA 显卡 (按 ≤8GB 轻量档推荐)"
    detected_vram_gb: float = 0.0
    effective_vram_gb: float = 0.0
    vram_tier: VramTier = "le_8gb"
    recommended_ocr_engine: OcrEngineType = "mineru_pipeline"
    recommendation_reason: str = ""


class OcrEngineStatusItem(BaseModel):
    engine_id: OcrEngineType
    name: str
    tier_badge: str
    installed: bool = False
    running: bool = False
    supports_one_click_setup: bool = False
    description: str = ""
    repo_or_api_url: str = ""


class FreeAiAppItem(BaseModel):
    app_id: Literal["qoder_cn", "workbuddy", "trae_cn", "magpie", "dsh"]
    name: str
    installed: bool = False
    running: bool = False
    executable_path: Optional[str] = None
    config_path: Optional[str] = None
    proxy_available: bool = False
    available_models: List[str] = Field(default_factory=list)
    description: str = ""


class ProviderStatusResponse(BaseModel):
    settings: RouterSettings
    harnesses: List[HarnessStatusItem]
    free_ai_apps: List[FreeAiAppItem] = Field(default_factory=list)
    magpie_available: bool = False
    magpie_gateway_running: bool = False
    magpie_models: List[str] = Field(default_factory=list)
    dsh_available: bool = False
    rapidocr_available: bool = False
    gpu_vram: GpuVramInfo = Field(default_factory=GpuVramInfo)
    ocr_engines: List[OcrEngineStatusItem] = Field(default_factory=list)


class AssetItem(BaseModel):
    asset_id: str
    filename: str
    url: str
    page_or_slide: int = 1
    caption: str = ""
    ocr_text: str = ""


class ChapterNode(BaseModel):
    chapter_id: str
    title: str
    start_page: int = 1
    end_page: int = 1
    char_count: int = 0
    summary_preview: str = ""
    content_text: str = ""
    assets: List[AssetItem] = Field(default_factory=list)
    key_terms: List[str] = Field(default_factory=list)


class DocumentIR(BaseModel):
    project_id: str
    project_type: ProjectType = "courseware"
    filename: str
    file_type: str
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    total_pages_or_slides: int = 0
    total_chars: int = 0
    ocr_applied: bool = False
    oxr_engine_used: str = ""
    oxr_probe_summary: str = ""
    raw_exam_text: str = ""
    chapters: List[ChapterNode] = Field(default_factory=list)
    all_assets: List[AssetItem] = Field(default_factory=list)


class DeliverableConfig(BaseModel):
    scenario_type: ScenarioType = "A_beginner"
    selected_items: List[str] = Field(
        default_factory=lambda: [
            "detailed_study_guide",
            "sync_homework",
            "unit_test_paper",
            "cheatsheet",
            "mindmap",
        ]
    )
    include_study_guide_notes: bool = True
    notes_style: NotesStyle = "guided_learning"
    include_cheatsheet: bool = True
    cheatsheet_density: Literal["compact", "comprehensive"] = "compact"
    include_quiz: bool = True
    quiz_mode: QuizMode = "sync_layered"
    mcq_count: int = 6
    fill_blank_count: int = 3
    short_answer_count: int = 2
    total_score: int = 100
    suggested_minutes: int = 30
    include_mindmap: bool = True
    mindmap_depth: int = 3


class DeliverableItemOption(BaseModel):
    item_id: str
    label: str
    description: str
    export_formats: List[str] = Field(default_factory=lambda: ["PDF 可打印", "Markdown"])


class PresetTemplate(BaseModel):
    preset_id: str
    scenario_type: ScenarioType = "A_beginner"
    name: str
    badge: str
    description: str
    icon: str
    target_difficulty: DifficultyLevel = "intermediate"
    default_deliverables: DeliverableConfig
    sample_prompt: str
    pedagogical_focus: List[str] = Field(default_factory=list)
    available_items: List[DeliverableItemOption] = Field(default_factory=list)


class StudyBlueprint(BaseModel):
    blueprint_id: str
    blueprint_title: str
    scenario_type: ScenarioType = "A_beginner"
    preset_id: str = "A_beginner"
    preset_name: str = "A · 入门/零基础学习"
    parsed_intent_summary: str
    ai_feedback_message: str
    target_difficulty: DifficultyLevel = "beginner"
    selected_chapter_ids: List[str] = Field(default_factory=list)
    deliverables: DeliverableConfig = Field(default_factory=DeliverableConfig)
    focus_topics: List[str] = Field(default_factory=list)
    custom_instructions: str = ""
    confirmed: bool = False


class NegotiateRequest(BaseModel):
    preset_id: Optional[str] = None
    user_prompt: str = ""
    current_blueprint: Optional[StudyBlueprint] = None


class GenerateRequest(BaseModel):
    blueprint: StudyBlueprint
    stream: bool = False


class QuickGenerateRequest(BaseModel):
    preset_id: str
    selected_chapter_ids: Optional[List[str]] = None
    user_prompt: str = ""
    stream: bool = False


class QuizQuestion(BaseModel):
    id: str
    type: Literal["mcq", "fill_blank", "short_answer"]
    difficulty: Literal["easy", "medium", "hard"] = "medium"
    tier: Literal["基础达标", "能力提升", "拓展探究"] = "基础达标"
    score: int = 5
    question: str
    options: List[str] = Field(default_factory=list)
    answer: str
    explanation: str
    source_chapter: str = ""
    source_page: str = ""
    knowledge_tags: List[str] = Field(default_factory=list)
    applied_strategies: List[str] = Field(default_factory=list)
    reverse_design: str = ""
    blind_review_summary: str = ""


class ExamToneAndPersona(BaseModel):
    stem_style: str = ""
    phrasing_habits: List[str] = Field(default_factory=list)
    option_length_style: str = ""


class ExamAgentStyleProfile(BaseModel):
    subject_and_level: str = ""
    overall_difficulty: str = ""
    tone_and_persona: ExamToneAndPersona = Field(default_factory=ExamToneAndPersona)
    formatting_rules: str = ""
    user_override_directives: List[str] = Field(default_factory=list)


class ExamDistractorRecipeItem(BaseModel):
    item: str = ""
    trap_type: str = ""
    detail: str = ""


class ExamQuestionBlueprintItem(BaseModel):
    question_id: int
    target_question_type: str = "单选题"
    target_difficulty: str = "中档"
    knowledge_points: List[str] = Field(default_factory=list)
    original_skeleton: str = ""
    distractor_recipe: List[ExamDistractorRecipeItem] = Field(default_factory=list)
    assigned_strategies: List[str] = Field(default_factory=list)
    generation_directive: str = ""


class ExamGeneratedQuestionItem(BaseModel):
    question_id: int
    question_type: str = "单选题"
    knowledge_tags: List[str] = Field(default_factory=list)
    applied_strategies: List[str] = Field(default_factory=list)
    reverse_design: str = ""
    correct_answer: str = ""
    detailed_analysis: str = ""
    stem: str = ""
    options: Optional[Dict[str, str]] = None


class ExamBlindReviewResult(BaseModel):
    question_id: int
    attempt: int = 1
    reasoning_process: str = ""
    my_answer: str = ""
    expected_answer: str = ""
    is_valid: bool = True
    passed: bool = True
    defect_report: Optional[str] = None


class ExamPipelineMetadata(BaseModel):
    direction: ExamDirectionType = "similar_paper"
    user_requirements: str = ""
    oxr_engine_used: str = ""
    oxr_probe_summary: str = ""
    soul_files_uploaded: List[str] = Field(default_factory=list)
    style_profile: Optional[ExamAgentStyleProfile] = None
    question_blueprints: List[ExamQuestionBlueprintItem] = Field(default_factory=list)
    generated_items: List[ExamGeneratedQuestionItem] = Field(default_factory=list)
    blind_reviews: List[ExamBlindReviewResult] = Field(default_factory=list)


class ExamGenerateRequest(BaseModel):
    direction: ExamDirectionType = "similar_paper"
    user_requirements: str = ""
    raw_exam_text_override: Optional[str] = None
    stream: bool = True


class QuizPaper(BaseModel):
    paper_id: str = "main"
    deliverable_type: str = "quiz"
    title: str
    mode: QuizMode
    total_score: int
    suggested_minutes: int
    instructions: str = ""
    questions: List[QuizQuestion] = Field(default_factory=list)


class KnowledgeFlashcard(BaseModel):
    id: str
    category: str = "核心概念"
    front: str
    answer: str
    explanation: str = ""
    source: str = ""


class StudyPackage(BaseModel):
    project_id: str
    blueprint_used: StudyBlueprint
    generated_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    routing_trace: Dict[str, str] = Field(default_factory=dict)
    quality_audit_report: str = ""
    study_notes_markdown: str = ""
    cheatsheet_markdown: str = ""
    quiz_paper: QuizPaper
    extra_quiz_papers: List[QuizPaper] = Field(default_factory=list)
    flashcards: List[KnowledgeFlashcard] = Field(default_factory=list)
    mindmap_mermaid: str = ""
    exam_pipeline_metadata: Optional[ExamPipelineMetadata] = None


class VariantQuestionRequest(BaseModel):
    source_question: QuizQuestion
    selected_chapter_ids: List[str] = Field(default_factory=list)


class ProjectSummary(BaseModel):
    project_id: str
    project_type: ProjectType = "courseware"
    filename: str
    file_type: str
    created_at: str
    total_pages_or_slides: int
    chapter_count: int
    has_blueprint: bool = False
    has_package: bool = False


class ProjectDetailResponse(BaseModel):
    document_ir: DocumentIR
    blueprint: Optional[StudyBlueprint] = None
    study_package: Optional[StudyPackage] = None
