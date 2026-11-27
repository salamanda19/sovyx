"""Tests for POST /api/chat/stream SSE endpoint."""

from __future__ import annotations

import asyncio
import contextlib
import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from starlette.testclient import TestClient

from sovyx.cognitive.act import ActionResult
from sovyx.dashboard.routes.chat import _persist_stream_turns
from sovyx.dashboard.server import create_app
from sovyx.observability.tasks import mark_consumed, spawn

_TOKEN = "test-token-stream"


@pytest.fixture()
def app():
    application = create_app(token=_TOKEN)
    registry = MagicMock()
    registry.is_registered.return_value = True
    registry.resolve = AsyncMock()
    application.state.registry = registry
    application.state.mind_config = MagicMock()
    application.state.mind_config.configure_mock(name="test")
    application.state.mind_yaml_path = None
    application.state.ws_manager = MagicMock()
    application.state.ws_manager.broadcast = AsyncMock()
    return application


@pytest.fixture()
def client(app) -> TestClient:
    return TestClient(app, headers={"Authorization": f"Bearer {_TOKEN}"})


def _wire_stream_registry(
    app: Any,
    *,
    response_text: str = "Hello from stream",
    delay_s: float = 0.0,
) -> AsyncMock:
    """Wire PersonResolver / ConversationTracker / CognitiveLoop / Bridge."""
    from sovyx.bridge.identity import PersonResolver
    from sovyx.bridge.manager import BridgeManager
    from sovyx.bridge.sessions import ConversationTracker
    from sovyx.cognitive.loop import CognitiveLoop

    mock_person = AsyncMock()
    mock_person.resolve = AsyncMock(return_value="person-1")

    mock_tracker = AsyncMock()
    mock_tracker.get_or_create = AsyncMock(return_value=("conv-stream-1", []))
    mock_tracker.add_turn = AsyncMock()

    async def _stream(
        _req: object,
        *,
        on_text_chunk: Any = None,
        on_phase: Any = None,
    ) -> ActionResult:
        if on_phase is not None:
            await on_phase("think", "streaming")
        if delay_s > 0:
            await asyncio.sleep(delay_s)
        if on_text_chunk is not None:
            await on_text_chunk(response_text)
        return ActionResult(
            response_text=response_text,
            target_channel="dashboard",
            metadata={"model": "test-model", "provider": "test"},
        )

    mock_loop = AsyncMock()
    mock_loop.process_request_streaming = AsyncMock(side_effect=_stream)

    mock_bridge = MagicMock()
    mock_bridge.mind_id = "test-mind"

    async def _resolve(interface: type) -> object:
        mapping: dict[type, object] = {
            PersonResolver: mock_person,
            ConversationTracker: mock_tracker,
            CognitiveLoop: mock_loop,
            BridgeManager: mock_bridge,
        }
        svc = mapping.get(interface)
        if svc is None:
            msg = f"unregistered: {interface}"
            raise RuntimeError(msg)
        return svc

    app.state.registry.resolve = AsyncMock(side_effect=_resolve)
    return mock_tracker


def _parse_sse(body: str) -> list[tuple[str, dict[str, object]]]:
    events: list[tuple[str, dict[str, object]]] = []
    event_type = ""
    for line in body.splitlines():
        if line.startswith("event: "):
            event_type = line[7:].strip()
        elif line.startswith("data: ") and event_type:
            events.append((event_type, json.loads(line[6:])))
            event_type = ""
    return events


class TestStreamValidation:
    """POST /api/chat/stream input validation."""

    def test_missing_message_returns_sse_error(self, client: TestClient) -> None:
        resp = client.post(
            "/api/chat/stream",
            json={},
            headers={"Authorization": f"Bearer {_TOKEN}"},
        )
        assert resp.status_code == 200  # noqa: PLR2004
        assert "text/event-stream" in resp.headers["content-type"]
        assert "error" in resp.text

    def test_empty_message_returns_sse_error(self, client: TestClient) -> None:
        resp = client.post(
            "/api/chat/stream",
            json={"message": ""},
            headers={"Authorization": f"Bearer {_TOKEN}"},
        )
        assert resp.status_code == 200  # noqa: PLR2004
        assert "error" in resp.text

    def test_no_registry_returns_sse_error(self) -> None:
        application = create_app(token=_TOKEN)
        application.state.registry = None
        c = TestClient(application, headers={"Authorization": f"Bearer {_TOKEN}"})
        resp = c.post("/api/chat/stream", json={"message": "hello"})
        assert "error" in resp.text

    def test_no_auth_401(self) -> None:
        application = create_app(token=_TOKEN)
        c = TestClient(application)
        resp = c.post("/api/chat/stream", json={"message": "hello"})
        assert resp.status_code == 401  # noqa: PLR2004


class TestStreamEndpoint:
    """POST /api/chat/stream returns SSE events."""

    def test_content_type_is_event_stream(self, client: TestClient) -> None:
        resp = client.post(
            "/api/chat/stream",
            json={"message": "hello"},
        )
        assert "text/event-stream" in resp.headers.get("content-type", "")

    def test_invalid_json_returns_error(self, client: TestClient) -> None:
        resp = client.post(
            "/api/chat/stream",
            content=b"not json",
            headers={
                "Authorization": f"Bearer {_TOKEN}",
                "Content-Type": "application/json",
            },
        )
        assert "error" in resp.text

    def test_emits_conversation_then_done_and_persists(
        self,
        app: Any,
        client: TestClient,
    ) -> None:
        tracker = _wire_stream_registry(app, response_text="streamed answer")
        resp = client.post("/api/chat/stream", json={"message": "hello"})
        assert resp.status_code == 200  # noqa: PLR2004
        events = _parse_sse(resp.text)
        types = [t for t, _ in events]
        assert "conversation" in types
        assert "done" in types
        assert types.index("conversation") < types.index("done")
        conv_evt = next(d for t, d in events if t == "conversation")
        assert conv_evt["conversation_id"] == "conv-stream-1"
        done_evt = next(d for t, d in events if t == "done")
        assert done_evt["response"] == "streamed answer"
        assert done_evt["conversation_id"] == "conv-stream-1"
        assert tracker.add_turn.await_count == 2  # noqa: PLR2004
        first = tracker.add_turn.await_args_list[0]
        assert first.args[1] == "user"
        assert first.args[2] == "hello"
        second = tracker.add_turn.await_args_list[1]
        assert second.args[1] == "assistant"
        assert second.args[2] == "streamed answer"


class TestPersistSurvivesDisconnect:
    """Turns persist inside the spawn task, not the SSE generator."""

    @pytest.mark.asyncio()
    async def test_persist_helper_writes_user_and_assistant(self) -> None:
        tracker = AsyncMock()
        result = ActionResult(
            response_text="Kyoto forecast",
            target_channel="dashboard",
        )
        text, tags = await _persist_stream_turns(
            tracker,
            "conv-1",  # type: ignore[arg-type]
            "weather?",
            result,
        )
        assert text == "Kyoto forecast"
        assert tags[-1] == "brain"
        assert tracker.add_turn.await_count == 2  # noqa: PLR2004

    @pytest.mark.asyncio()
    async def test_spawned_persist_survives_consumer_cancel(self) -> None:
        """Consumer cancel (client disconnect) must not skip add_turn."""
        tracker = AsyncMock()
        result = ActionResult(
            response_text="survived disconnect",
            target_channel="dashboard",
        )
        started = asyncio.Event()
        finish = asyncio.Event()
        persisted = asyncio.Event()

        async def run_loop() -> ActionResult:
            started.set()
            await finish.wait()
            await _persist_stream_turns(
                tracker,
                "conv-x",  # type: ignore[arg-type]
                "hi",
                result,
            )
            persisted.set()
            return result

        task = spawn(run_loop(), name="test-chat-stream-persist")
        task.add_done_callback(mark_consumed)

        async def consumer() -> None:
            await started.wait()
            raise asyncio.CancelledError

        cons = asyncio.create_task(consumer())
        await started.wait()
        cons.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await cons

        finish.set()
        await task
        await asyncio.wait_for(persisted.wait(), timeout=2.0)
        assert tracker.add_turn.await_count == 2  # noqa: PLR2004
        roles = [c.args[1] for c in tracker.add_turn.await_args_list]
        assert roles == ["user", "assistant"]


class TestBatchEndpointMetadata:
    """POST /api/chat returns LLM metadata (model, tokens, cost)."""

    def test_response_shape_unchanged(self, client: TestClient) -> None:
        from unittest.mock import patch

        with patch(
            "sovyx.dashboard.chat.handle_chat_message",
            new_callable=AsyncMock,
        ) as mock_handle:
            mock_handle.return_value = {
                "response": "Hello!",
                "conversation_id": "conv-1",
                "mind_id": "test",
                "timestamp": "2026-04-16T00:00:00Z",
                "tags": ["brain"],
            }
            resp = client.post("/api/chat", json={"message": "hi"})

        assert resp.status_code == 200  # noqa: PLR2004
        data = resp.json()
        assert "response" in data
        assert "tags" in data
