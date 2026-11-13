from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field

ProviderType = Literal["cloud", "local", "harness", "heuristic"]
StageName = Literal[
    "vision_ocr",
    "requirement_negotiation",
    "notes_and_cheatsheet",
    "quiz_generation",
    "mindmap_generation",
]
RoutingMode = Literal["single", "smart_stage"]
DifficultyLevel = Literal["beginner", "intermediate", "advanced", "exam_sprint"]
NotesStyle = Literal["guided_learning", "concise_outline", "deep_dive", "in_class_recap"]
QuizMode = Literal["in_class", "sync_layered", "exam_paper", "custom"]


class CloudConfig(BaseModel):
    provider_label: str = "OpenAI 兼容接口"
    api_format: Literal["openai_compatible", "anthropic"] = "openai_compatible"
    base_url: str = "https://api.openai.com/v1"
    api_key: str = ""
    model: str = "gpt-4o-mini"
    vision_model: str = "gpt-4o-mini"


class LocalConfig(BaseModel):
    engine: Literal["ollama", "lmstudio"] = "ollama"
    ollama_url: str = "http://127.0.0.1:11434"
    lmstudio_url: str = "http://127.0.0.1:1234"
    model: str = "qwen2.5:7b"
    vision_model: str = "llava"


class HarnessConfig(BaseModel):
    preferred_cli: Literal["claude", "codex", "gemini", "custom"] = "claude"
    custom_command_template: str = ""
    timeout_seconds: int = 180


class ProviderSelection(BaseModel):
    provider: ProviderType = "heuristic"
    model_override: Optional[str] = None


class RouterSettings(BaseModel):
    routing_mode: RoutingMode = "single"
    active_provider: ProviderType = "heuristic"
    enable_fallback: bool = True
    cloud_config: CloudConfig = Field(default_factory=CloudConfig)
    local_config: LocalConfig = Field(default_factory=LocalConfig)
    harness_config: HarnessConfig = Field(default_factory=HarnessConfig)
    stage_mapping: Dict[StageName, ProviderSelection] = Field(
        default_factory=lambda: {
            "vision_ocr": ProviderSelection(provider="heuristic"),
            "requirement_negotiation": ProviderSelection(provider="harness"),
            "notes_and_cheatsheet": ProviderSelection(provider="harness"),
            "quiz_generation": ProviderSelection(provider="harness"),
            "mindmap_generation": ProviderSelection(provider="harness"),
        }
    )


class HarnessStatusItem(BaseModel):
    name: str
    available: bool
    executable_path: Optional[str] = None
    description: str


class ProviderStatusResponse(BaseModel):
    settings: RouterSettings
    harnesses: List[HarnessStatusItem]
    ollama_available: bool = False
    ollama_models: List[str] = Field(default_factory=list)
    lmstudio_available: bool = False
    lmstudio_models: List[str] = Field(default_factory=list)
    rapidocr_available: bool = False


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
    filename: str
    file_type: str
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    total_pages_or_slides: int = 0
    total_chars: int = 0
    ocr_applied: bool = False
    chapters: List[ChapterNode] = Field(default_factory=list)
    all_assets: List[AssetItem] = Field(default_factory=list)


class DeliverableConfig(BaseModel):
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


class PresetTemplate(BaseModel):
    preset_id: str
    name: str
    badge: str
    description: str
    icon: str
    target_difficulty: DifficultyLevel = "intermediate"
    default_deliverables: DeliverableConfig
    sample_prompt: str
    pedagogical_focus: List[str] = Field(default_factory=list)


class StudyBlueprint(BaseModel):
    blueprint_id: str
    blueprint_title: str
    preset_id: str = "self_study_guide"
    preset_name: str = "自学案"
    parsed_intent_summary: str
    ai_feedback_message: str
    target_difficulty: DifficultyLevel = "intermediate"
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


class QuizPaper(BaseModel):
    title: str
    mode: QuizMode
    total_score: int
    suggested_minutes: int
    instructions: str = ""
    questions: List[QuizQuestion] = Field(default_factory=list)


class StudyPackage(BaseModel):
    project_id: str
    blueprint_used: StudyBlueprint
    generated_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    routing_trace: Dict[str, str] = Field(default_factory=dict)
    study_notes_markdown: str = ""
    cheatsheet_markdown: str = ""
    quiz_paper: QuizPaper
    mindmap_mermaid: str = ""


class ProjectSummary(BaseModel):
    project_id: str
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
