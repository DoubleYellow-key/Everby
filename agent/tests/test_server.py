import io
import json
import sys
import unittest
from unittest.mock import patch

from souldesk_agent.server import AgentServer


class AgentServerTests(unittest.TestCase):
    def test_writes_stream_delta_containing_an_unpaired_surrogate(self):
        output = io.BytesIO()
        stdout = io.TextIOWrapper(output, encoding="utf-8", write_through=True)

        with patch.object(sys, "stdout", stdout):
            AgentServer()._write({"id": "request-1", "type": "delta", "delta": "\udcaa"})

        event = json.loads(output.getvalue().decode("utf-8"))
        self.assertEqual(event["delta"], "\udcaa")


if __name__ == "__main__":
    unittest.main()
