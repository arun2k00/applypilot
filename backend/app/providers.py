import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from urllib.parse import quote, urlsplit

import httpx2 as httpx
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.orm import Session

from .models import ProviderConfig, ProviderRoute, ProviderUsage

VENDOR_ENDPOINTS = {
    "openai": "https://api.openai.com/v1",
    "anthropic": "https://api.anthropic.com/v1",
    "gemini": "https://generativelanguage.googleapis.com/v1beta",
}
TASKS = (
    "default",
    "resume_parsing",
    "profile_extraction",
    "job_analysis",
    "job_matching",
    "company_research",
    "resume_customization",
    "cover_letter",
    "screening",
    "interview",
)
KEY_LOCK = Lock()


class ProviderFailure(Exception):
    pass


@dataclass(frozen=True)
class Completion:
    text: str
    input_tokens: int | None
    output_tokens: int | None


def validated_endpoint(kind: str, value: str) -> str:
    if kind in VENDOR_ENDPOINTS:
        return VENDOR_ENDPOINTS[kind]
    endpoint = value.rstrip("/") or ("http://127.0.0.1:11434" if kind == "ollama" else "")
    try:
        url = urlsplit(endpoint)
        port = url.port
    except ValueError:
        raise ProviderFailure("Enter a valid endpoint URL.") from None
    if (
        url.scheme not in {"http", "https"}
        or not url.hostname
        or url.username is not None
        or url.password is not None
        or url.query
        or url.fragment
        or port == 0
        or any(char.isspace() for char in endpoint)
        or "\\" in endpoint
    ):
        raise ProviderFailure("Use an endpoint URL without credentials, query, or fragment.")
    allowlist = {
        entry.strip().rstrip("/")
        for entry in os.getenv("APPLYPILOT_ALLOWED_PROVIDER_ENDPOINTS", "").split(",")
    }
    if url.hostname not in {"127.0.0.1", "::1"} and endpoint not in allowlist:
        raise ProviderFailure("Add this endpoint to APPLYPILOT_ALLOWED_PROVIDER_ENDPOINTS first.")
    return endpoint


def cipher(data_dir: Path, *, create: bool = False) -> Fernet:
    supplied = os.getenv("APPLYPILOT_CREDENTIAL_KEY")
    try:
        if supplied:
            return Fernet(supplied.encode())
        with KEY_LOCK:
            data_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
            key = data_dir / "provider.key"
            if create and not key.exists():
                fd = os.open(key, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, "wb") as stream:
                    stream.write(Fernet.generate_key())
            return Fernet(key.read_bytes())
    except (OSError, ValueError):
        raise ProviderFailure("Local credential storage is unavailable.") from None


def credential(provider: ProviderConfig, data_dir: Path) -> str:
    try:
        return cipher(data_dir).decrypt(provider.credential).decode() if provider.credential else ""
    except (InvalidToken, UnicodeError):
        raise ProviderFailure(
            "The saved credential could not be decrypted. Re-enter the key."
        ) from None


def transport(url: str, headers: dict, payload: dict | None = None) -> dict:
    deadline = time.monotonic() + 22
    try:
        with httpx.Client(timeout=12, follow_redirects=False, trust_env=False) as client:
            for attempt in range(2):
                method = "GET" if payload is None else "POST"
                with client.stream(method, url, headers=headers, json=payload) as response:
                    if response.status_code == 429 and attempt == 0:
                        retry = response.headers.get("retry-after", "")
                        if retry.isdecimal() and len(retry) <= 2 and int(retry) <= 2:
                            time.sleep(int(retry))
                            continue
                    if response.status_code in {401, 403}:
                        raise ProviderFailure("The provider rejected the credential.")
                    if not response.is_success:
                        raise ProviderFailure(f"The provider returned HTTP {response.status_code}.")
                    content = bytearray()
                    for chunk in response.iter_bytes():
                        if time.monotonic() >= deadline:
                            raise ProviderFailure("The provider response timed out.")
                        content.extend(chunk)
                        if len(content) > 1_000_000:
                            raise ProviderFailure("The provider response exceeded the local limit.")
                    result = json.loads(content)
                    if not isinstance(result, dict):
                        raise ProviderFailure("The provider returned an unsupported response.")
                    return result
    except (httpx.HTTPError, ValueError, UnicodeError):
        raise ProviderFailure(
            "The provider could not be reached or returned invalid JSON."
        ) from None
    raise ProviderFailure("The provider is rate limited.")


def complete(
    provider: ProviderConfig,
    api_key: str,
    system: str,
    data: str,
    *,
    structured: bool = False,
    budget: int = 700,
) -> Completion:
    if len(system) + len(data) > 24_000:
        raise ProviderFailure("The request exceeds the configured input limit.")
    kind, model = provider.kind, provider.model
    endpoint = validated_endpoint(kind, provider.endpoint)
    json_mode = structured and provider.json_mode
    if structured:
        system += " Respond with one JSON object."
    messages = [{"role": "system", "content": system}, {"role": "user", "content": data}]
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    try:
        if kind == "anthropic":
            result = transport(
                endpoint + "/messages",
                {
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                },
                {"model": model, "system": system, "messages": messages[1:], "max_tokens": budget},
            )
            text = "".join(block["text"] for block in result["content"] if block["type"] == "text")
            usage = result.get("usage", {})
            counts = usage.get("input_tokens"), usage.get("output_tokens")
        elif kind == "gemini":
            options = {"maxOutputTokens": budget}
            if json_mode:
                options["responseMimeType"] = "application/json"
            result = transport(
                endpoint
                + "/models/"
                + quote(model.removeprefix("models/"), safe="")
                + ":generateContent",
                {"x-goog-api-key": api_key},
                {
                    "systemInstruction": {"parts": [{"text": system}]},
                    "contents": [{"role": "user", "parts": [{"text": data}]}],
                    "generationConfig": options,
                },
            )
            parts = result["candidates"][0]["content"]["parts"]
            text = "".join(part.get("text", "") for part in parts if not part.get("thought"))
            usage = result.get("usageMetadata", {})
            counts = usage.get("promptTokenCount"), usage.get("candidatesTokenCount")
        elif kind == "ollama":
            options = {
                "model": model,
                "messages": messages,
                "stream": False,
                "options": {"num_predict": budget},
            }
            if json_mode:
                options["format"] = "json"
            result = transport(endpoint + "/api/chat", headers, options)
            text = result["message"]["content"]
            counts = result.get("prompt_eval_count"), result.get("eval_count")
        else:
            options = {"model": model, "messages": messages, "stream": False}
            options["max_completion_tokens" if kind == "openai" else "max_tokens"] = budget
            if kind == "openai":
                options["store"] = False
            if json_mode:
                options["response_format"] = {"type": "json_object"}
            result = transport(endpoint + "/chat/completions", headers, options)
            text = result["choices"][0]["message"]["content"]
            usage = result.get("usage", {})
            counts = usage.get("prompt_tokens"), usage.get("completion_tokens")
        if not isinstance(text, str) or not text.strip():
            raise ProviderFailure("The provider returned an empty response.")
        if structured and not isinstance(json.loads(text), dict):
            raise ProviderFailure("The provider returned invalid structured output.")
    except (KeyError, IndexError, TypeError, AttributeError, ValueError):
        raise ProviderFailure("The provider returned an unsupported response.") from None
    tokens = tuple(value if type(value) is int and 0 <= value < 2**31 else None for value in counts)
    return Completion(text, *tokens)


def record_call(
    database: Session,
    provider: ProviderConfig,
    task: str,
    system: str,
    data: str,
    data_dir: Path,
    *,
    structured: bool = False,
    budget: int = 700,
) -> Completion:
    usage = ProviderUsage(provider=provider.label, task=task, model=provider.model, status="failed")
    try:
        result = complete(
            provider,
            credential(provider, data_dir),
            system,
            data,
            structured=structured,
            budget=budget,
        )
        usage.status = "ok"
        usage.input_tokens, usage.output_tokens = result.input_tokens, result.output_tokens
        if None not in (
            result.input_tokens,
            result.output_tokens,
            provider.input_rate,
            provider.output_rate,
        ):
            usage.estimated_usd = (
                result.input_tokens * provider.input_rate
                + result.output_tokens * provider.output_rate
            ) / 1_000_000
        return result
    finally:
        database.add(usage)
        database.commit()


def run_task(database: Session, data_dir: Path, task: str, system: str, data: str) -> dict:
    route = database.get(ProviderRoute, task) or database.get(ProviderRoute, "default")
    for provider_id in route.providers if route else []:
        provider = database.get(ProviderConfig, provider_id)
        if provider and provider.enabled and provider.allow_candidate_data:
            try:
                result = record_call(
                    database, provider, task, system, data, data_dir, structured=True
                )
                return json.loads(result.text)
            except ProviderFailure:
                continue
    raise ProviderFailure("No permitted provider returned a usable response.")
