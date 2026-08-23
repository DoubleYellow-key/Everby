import json
import threading
import unittest

from souldesk_agent.model import CompatibleModel


class FakeResponse:
    def __init__(self, payload=b"", lines=None):
        self.payload = payload
        self.lines = lines or []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def __iter__(self):
        return iter(self.lines)

    def read(self):
        return self.payload


class CompatibleModelTests(unittest.TestCase):
    config = {"baseUrl": "http://127.0.0.1:9999/v1", "apiKey": "test", "model": "fake"}

    def test_streams_openai_compatible_deltas(self):
        lines = [
            b'data: {"choices":[{"delta":{"content":"hello"}}]}\n',
            b'data: {"choices":[{"delta":{"content":" world"}}]}\n',
            b'data: [DONE]\n',
        ]
        deltas = []
        model = CompatibleModel(lambda *_args, **_kwargs: FakeResponse(lines=lines))
        reply = model.stream_chat(self.config, [{"role": "user", "content": "hi"}], deltas.append, threading.Event())
        self.assertEqual(reply, "hello world")
        self.assertEqual(deltas, ["hello", " world"])

    def test_invalid_decision_falls_back_to_idle(self):
        wire = {"choices": [{"message": {"content": json.dumps({"actionIntent": "delete-files"})}}]}
        model = CompatibleModel(lambda *_args, **_kwargs: FakeResponse(json.dumps(wire).encode()))
        self.assertEqual(model.plan(self.config, "test")["actionIntent"], "idle")

    def test_rejects_non_http_model_urls(self):
        model = CompatibleModel()
        with self.assertRaises(ValueError):
            model.stream_chat({**self.config, "baseUrl": "file:///tmp"}, [], lambda _delta: None, threading.Event())


if __name__ == "__main__":
    unittest.main()
