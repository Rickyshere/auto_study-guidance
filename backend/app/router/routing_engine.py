from __future__ import annotations

import json
import re
from typing import Any, Dict, Optional, Tuple

from app.router.cloud_provider import call_cloud_llm
from app.router.harness_provider import run_cli_harness
from app.router.local_provider import call_local_llm
from app.schemas import ProviderSelection, ProviderType, RouterSettings, StageName


def extract_json_payload(raw_text: str) -> Any:
    text = raw_text.strip()
    # Try fenced code blocks first
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.IGNORECASE)
    if fence:
        candidate = fence.group(1).strip()
        try:
            return json.loads(candidate)
        except Exception:
            text = candidate

    # Try direct JSON
    try:
        return json.loads(text)
    except Exception:
        pass

    # Try locating outermost { ... } or [ ... ]
    obj_start = text.find("{")
    obj_end = text.rfind("}")
    arr_start = text.find("[")
    arr_end = text.rfind("]")

    candidates = []
    if obj_start != -1 and obj_end > obj_start:
        candidates.append(text[obj_start : obj_end + 1])
    if arr_start != -1 and arr_end > arr_start:
        candidates.append(text[arr_start : arr_end + 1])

    for cand in sorted(candidates, key=len, reverse=True):
        try:
            return json.loads(cand)
        except Exception:
            continue
    raise ValueError("无法从模型输出中解析合法 JSON")


class ModelRouter:
    """Routes each pipeline stage to Cloud API, Local LLM, CLI Harness, or Heuristic fallback."""

    def __init__(self, settings: RouterSettings):
        self.settings = settings
        self.routing_trace: Dict[str, str] = {}

    def is_non_heuristic_active(self) -> bool:
        """Return True only when a non-heuristic engine (cloud / local / harness) is active."""
        if self.settings.routing_mode == "single":
            return self.settings.active_provider != "heuristic"
        for st in (
            "requirement_negotiation",
            "notes_and_cheatsheet",
            "quiz_generation",
            "mindmap_generation",
            "global_quality_audit",
        ):
            sel = self.settings.stage_mapping.get(st)
            if sel and sel.provider != "heuristic":
                return True
        return False

    def resolve_quality_audit_provider(self) -> Optional[ProviderSelection]:
        """Resolve provider for global quality audit. Active ONLY when non-heuristic engine is used."""
        if not getattr(self.settings, "enable_quality_audit", True):
            return None
        if not self.is_non_heuristic_active():
            return None
        if self.settings.routing_mode == "single":
            return ProviderSelection(provider=self.settings.active_provider)
        sel = self.settings.stage_mapping.get("global_quality_audit")
        if sel and sel.provider != "heuristic":
            return sel
        for st in (
            "notes_and_cheatsheet",
            "quiz_generation",
            "requirement_negotiation",
            "mindmap_generation",
        ):
            cand = self.settings.stage_mapping.get(st)
            if cand and cand.provider != "heuristic":
                return cand
        return None

    def resolve_stage(self, stage: StageName) -> ProviderSelection:
        if stage == "global_quality_audit":
            return self.resolve_quality_audit_provider() or ProviderSelection(provider="heuristic")
        if self.settings.routing_mode == "smart_stage":
            return self.settings.stage_mapping.get(
                stage, ProviderSelection(provider=self.settings.active_provider)
            )
        return ProviderSelection(provider=self.settings.active_provider)

    async def execute_text(
        self,
        stage: StageName,
        system_prompt: str,
        user_prompt: str,
    ) -> Tuple[Optional[str], str]:
        """
        Execute a stage via configured provider.
        Returns (response_text_or_None_if_heuristic, provider_trace_label).
        """
        sel = self.resolve_stage(stage)
        provider: ProviderType = sel.provider

        if provider == "heuristic":
            label = "heuristic (内置智能规则引擎)"
            self.routing_trace[stage] = label
            return None, label

        try:
            if provider == "cloud":
                model = sel.model_override or self.settings.cloud_config.model
                text = await call_cloud_llm(
                    system_prompt, user_prompt, self.settings.cloud_config, model_override=model
                )
                label = f"cloud/{model}"
                self.routing_trace[stage] = label
                return text, label

            if provider == "local":
                model = sel.model_override or self.settings.local_config.model
                text = await call_local_llm(
                    system_prompt, user_prompt, self.settings.local_config, model_override=model
                )
                label = f"local-{self.settings.local_config.engine}/{model}"
                self.routing_trace[stage] = label
                return text, label

            if provider == "harness":
                text = await run_cli_harness(
                    system_prompt, user_prompt, self.settings.harness_config
                )
                label = f"harness/{self.settings.harness_config.preferred_cli}-cli"
                self.routing_trace[stage] = label
                return text, label

        except Exception as exc:
            if not self.settings.enable_fallback:
                raise
            label = f"{provider} 失败({str(exc)[:60]}) -> heuristic 回退"
            self.routing_trace[stage] = label
            return None, label

        return None, "heuristic"

    async def execute_json(
        self,
        stage: StageName,
        system_prompt: str,
        user_prompt: str,
    ) -> Tuple[Optional[Any], str]:
        raw_text, label = await self.execute_text(stage, system_prompt, user_prompt)
        if raw_text is None:
            return None, label
        try:
            parsed = extract_json_payload(raw_text)
            return parsed, label
        except Exception as exc:
            if not self.settings.enable_fallback:
                raise
            fallback_label = f"{label} JSON解析失败({str(exc)[:40]}) -> heuristic 回退"
            self.routing_trace[stage] = fallback_label
            return None, fallback_label
