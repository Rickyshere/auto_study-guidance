from __future__ import annotations

import asyncio
import json
import re
from typing import Any, Callable, Dict, Optional, Tuple

from app.router.cloud_provider import call_cloud_llm
from app.router.harness_provider import HarnessCancelToken, run_cli_harness
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

    def __init__(
        self,
        settings: RouterSettings,
        cancel_token: Optional[HarnessCancelToken] = None,
        status_cb: Optional[Callable[[str, str], Any]] = None,
    ):
        self.settings = settings
        self.cancel_token = cancel_token
        self.status_cb = status_cb
        self.routing_trace: Dict[str, str] = {}

    def check_cancelled(self) -> None:
        if self.cancel_token is not None:
            self.cancel_token.raise_if_cancelled()

    async def _emit_stage_status(self, stage: str, msg: str) -> None:
        if not self.status_cb or not msg:
            return
        res = self.status_cb(stage, msg)
        if asyncio.iscoroutine(res) or hasattr(res, "__await__"):
            await res

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
        self.check_cancelled()
        sel = self.resolve_stage(stage)
        provider: ProviderType = sel.provider

        if provider == "heuristic":
            label = "heuristic (内置智能规则引擎)"
            self.routing_trace[stage] = label
            return None, label

        max_retries = max(0, int(getattr(self.settings.harness_config, "max_retries", 2)))
        try:
            if provider == "cloud":
                model = sel.model_override or self.settings.cloud_config.model
                text = await self._call_with_retry(
                    stage,
                    f"cloud/{model}",
                    max_retries,
                    lambda: call_cloud_llm(
                        system_prompt, user_prompt, self.settings.cloud_config, model_override=model
                    ),
                )
                label = f"cloud/{model}"
                self.routing_trace[stage] = label
                return text, label

            if provider == "local":
                model = sel.model_override or self.settings.local_config.model
                text = await self._call_with_retry(
                    stage,
                    f"local/{model}",
                    max_retries,
                    lambda: call_local_llm(
                        system_prompt, user_prompt, self.settings.local_config, model_override=model
                    ),
                )
                label = f"local-{self.settings.local_config.engine}/{model}"
                self.routing_trace[stage] = label
                return text, label

            if provider == "harness":
                text = await run_cli_harness(
                    system_prompt,
                    user_prompt,
                    self.settings.harness_config,
                    cancel_token=self.cancel_token,
                    status_cb=lambda msg: self._emit_stage_status(stage, msg),
                )
                label = f"harness/{self.settings.harness_config.preferred_cli}-cli"
                self.routing_trace[stage] = label
                return text, label

        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self.check_cancelled()
            if not self.settings.enable_fallback:
                raise
            label = f"{provider} 失败({str(exc)[:60]}) -> heuristic 回退"
            self.routing_trace[stage] = label
            return None, label

        return None, "heuristic"

    async def _call_with_retry(
        self,
        stage: str,
        provider_label: str,
        max_retries: int,
        coro_factory: Callable[[], Any],
    ) -> str:
        total_attempts = 1 + max_retries
        last_exc: Optional[Exception] = None
        for attempt in range(1, total_attempts + 1):
            self.check_cancelled()
            try:
                res = await coro_factory()
                if not res or not str(res).strip():
                    raise RuntimeError(f"{provider_label} 返回空内容")
                return str(res)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                last_exc = exc
                if attempt >= total_attempts:
                    raise
                delay = min(1.5 * attempt, 4.0)
                await self._emit_stage_status(
                    stage,
                    f"{provider_label} 第 {attempt}/{total_attempts} 次失败 ({str(exc)[:60]})，{delay:.1f}s 后重试...",
                )
                await asyncio.sleep(delay)
                self.check_cancelled()
        assert last_exc is not None
        raise last_exc

    async def execute_json(
        self,
        stage: StageName,
        system_prompt: str,
        user_prompt: str,
    ) -> Tuple[Optional[Any], str]:
        max_json_retries = min(1, max(0, int(getattr(self.settings.harness_config, "max_retries", 2))))
        last_label = "heuristic"
        last_exc: Optional[Exception] = None
        for attempt in range(1, 2 + max_json_retries):
            self.check_cancelled()
            raw_text, label = await self.execute_text(stage, system_prompt, user_prompt)
            last_label = label
            if raw_text is None:
                return None, label
            try:
                parsed = extract_json_payload(raw_text)
                return parsed, label
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                last_exc = exc
                if attempt <= max_json_retries:
                    await self._emit_stage_status(stage, f"{label} 输出非合法 JSON，正在自动重试...")
                    await asyncio.sleep(1.0)
                    continue
        if not self.settings.enable_fallback and last_exc is not None:
            raise last_exc
        fallback_label = f"{last_label} JSON解析失败({str(last_exc)[:40]}) -> heuristic 回退"
        self.routing_trace[stage] = fallback_label
        return None, fallback_label
