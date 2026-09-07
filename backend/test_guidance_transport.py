import asyncio
import json
import unittest
from unittest.mock import patch

import httpx
from app.domain.ai import llm_transport as transport


class GuidanceConnectionTests(unittest.IsolatedAsyncioTestCase):
    def clients(self):
        real_client = httpx.AsyncClient
        created, requests = [], []
        async def handler(request):
            requests.append(json.loads(request.content))
            response = {'candidates': [{'content': {'parts': [{'text': '{"ok":true}'}]},
                'finishReason': 'STOP'}], 'usageMetadata': {'promptTokenCount': 1,
                'candidatesTokenCount': 1, 'totalTokenCount': 2}}
            return httpx.Response(200, headers={'content-type': 'text/event-stream'},
                                 content=('data: ' + json.dumps(response) + '\n\n').encode())
        def factory(*args, **kwargs):
            client = real_client(*args, **kwargs, transport=httpx.MockTransport(handler))
            created.append(client)
            return client
        return factory, created, requests

    async def call(self, prompt):
        return await transport._stream_gemini_json_response_once(system_prompt=prompt,
            user_parts=[{'text': 'source'}], error_message='unavailable', request_label='scope_test')

    async def test_two_independent_requests_share_only_one_owned_http_pool(self):
        factory, created, requests = self.clients()
        with patch.object(transport.httpx, 'AsyncClient', factory), \
             patch.object(transport, '_build_gemini_stream_url', return_value='https://example.invalid/stream'), \
             patch.object(transport, '_build_gemini_headers', return_value={}):
            async with transport.guidance_connection_session():
                self.assertEqual(await self.call('generate'), {'ok': True})
                self.assertEqual(await self.call('audit'), {'ok': True})
        self.assertEqual(len(created), 1)
        self.assertTrue(created[0].is_closed)
        self.assertEqual(len(requests), 2)
        self.assertNotEqual(requests[0], requests[1])

    async def test_separate_operations_never_share_a_client_and_cancel_closes_it(self):
        factory, created, _ = self.clients()
        with patch.object(transport.httpx, 'AsyncClient', factory):
            with self.assertRaises(asyncio.CancelledError):
                async with transport.guidance_connection_session():
                    raise asyncio.CancelledError()
            async with transport.guidance_connection_session():
                pass
        self.assertEqual(len(created), 2)
        self.assertTrue(all(client.is_closed for client in created))
        self.assertIsNone(transport._guidance_http_client.get())

    async def test_calls_outside_a_guidance_operation_keep_their_original_lifetime(self):
        factory, created, requests = self.clients()
        with patch.object(transport.httpx, 'AsyncClient', factory), \
             patch.object(transport, '_build_gemini_stream_url', return_value='https://example.invalid/stream'), \
             patch.object(transport, '_build_gemini_headers', return_value={}):
            await self.call('one')
            await self.call('two')
        self.assertEqual(len(created), 2)
        self.assertTrue(all(client.is_closed for client in created))
        self.assertEqual(len(requests), 2)
