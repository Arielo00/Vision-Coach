from __future__ import annotations

import json
import urllib.error
import urllib.request
from abc import ABC, abstractmethod


class LLMProvider(ABC):
    name: str

    @abstractmethod
    def list_models(self) -> list[dict]:
        raise NotImplementedError

    @abstractmethod
    def generate_structured(self, model: str, system: str, prompt: str, schema: dict) -> dict:
        raise NotImplementedError


class OllamaProvider(LLMProvider):
    name = "ollama"

    def __init__(self, base_url: str, timeout_seconds: float = 180.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds

    def _request(self, path: str, payload: dict | None = None, timeout: float | None = None) -> dict:
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST" if payload is not None else "GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout or self.timeout_seconds) as response:
                return json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError) as exc:
            raise RuntimeError(f"Ollama no disponible: {exc}") from exc

    def list_models(self) -> list[dict]:
        return self._request("/api/tags", timeout=3.0).get("models", [])

    def generate_structured(self, model: str, system: str, prompt: str, schema: dict) -> dict:
        result = self._request(
            "/api/chat",
            {
                "model": model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
                "stream": False,
                "format": schema,
                "think": False,
                "keep_alive": "5m",
                "options": {"temperature": 0},
            },
        )
        content = result.get("message", {}).get("content", "")
        try:
            return json.loads(content)
        except json.JSONDecodeError as exc:
            raise RuntimeError("Ollama no devolvió JSON válido") from exc


class GoogleGenAIProvider(LLMProvider):
    name = "google"

    def __init__(self, api_key: str | None) -> None:
        self.api_key = api_key

    def list_models(self) -> list[dict]:
        return [
            {"name": "gemma-4-26b-a4b-it", "kind": "chat", "remote": True},
            {"name": "gemma-4-31b-it", "kind": "chat", "remote": True},
        ]

    def generate_structured(self, model: str, system: str, prompt: str, schema: dict) -> dict:
        if not self.api_key:
            raise RuntimeError("Google GenAI no está configurado")
        try:
            from google import genai
            from google.genai import types

            with genai.Client(api_key=self.api_key) as client:
                response = client.models.generate_content(
                    model=model,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=system,
                        temperature=0,
                        response_mime_type="application/json",
                        response_json_schema=schema,
                        thinking_config=types.ThinkingConfig(thinking_level="minimal"),
                    ),
                )
            return json.loads(response.text or "")
        except Exception as exc:
            raise RuntimeError(f"Google GenAI no pudo generar coaching: {type(exc).__name__}") from exc
