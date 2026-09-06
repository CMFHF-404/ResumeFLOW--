import subprocess
import sys
import unittest
from pathlib import Path
from run_offline_tests import install_offline_guard


class OfflineTestRunnerTests(unittest.TestCase):
    def test_network_is_blocked_without_breaking_asyncio_or_mock_transports(self):
        install_offline_guard()
        probe = r'''
import asyncio
import socket
import httpx
blocked = 0
for operation in (
    lambda: socket.getaddrinfo('offline.invalid', 443),
    lambda: socket.socket().connect(('192.0.2.1', 443)),
    lambda: socket.socket().connect(('127.0.0.1', 5432)),
):
    try:
        operation()
    except RuntimeError:
        blocked += 1
assert blocked == 3

async def main():
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={'mock': True}))
    async with httpx.AsyncClient(transport=transport) as client:
        response = await client.get('https://offline.invalid/test')
        assert response.json() == {'mock': True}

asyncio.run(main())
print('offline guard verified')
'''
        result = subprocess.run(
            [sys.executable, "-B", "-c", probe],
            cwd=Path(__file__).parent,
            capture_output=True,
            text=True,
            timeout=15,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("offline guard verified", result.stdout)

    def test_unguarded_process_launches_are_rejected(self):
        install_offline_guard()
        for args in ([sys.executable, "-I", "-c", "pass"], ["unavailable-executable"]):
            with self.subTest(args=args), self.assertRaisesRegex(PermissionError, "subprocess"):
                subprocess.run(args, timeout=5)
        for event in ("os.startfile", "os.startfile/2"):
            with self.subTest(event=event), self.assertRaisesRegex(PermissionError, "subprocess"):
                sys.audit(event, "offline.invalid", "open")

    def test_child_receives_guard_even_with_a_replaced_environment(self):
        install_offline_guard()
        result = subprocess.run(
            [sys.executable, "-c", "import sys; sys.audit('socket.getaddrinfo', 'offline.invalid', 443, 0, 0, 0)"],
            env={},
            cwd=Path(__file__).parent,
            capture_output=True,
            text=True,
            timeout=15,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Network connections are disabled", result.stderr)
