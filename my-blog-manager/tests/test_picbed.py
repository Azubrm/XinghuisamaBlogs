import io
import unittest
from unittest.mock import patch

import httpx
from fastapi import UploadFile
from starlette.datastructures import Headers

from cms_core.api import picbed


class PicbedEndpointTests(unittest.TestCase):
    def test_site_api_root_and_endpoint_produce_the_same_urls(self):
        for value in (
            'https://7bu.top',
            ' https://7bu.top/ ',
            'https://7bu.top/api/v1',
            'https://7bu.top/api/v1/',
            'https://7bu.top/api/v1/profile',
            'https://7bu.top/api/v1/upload/',
        ):
            for operation in ('profile', 'upload'):
                with self.subTest(value=value, operation=operation):
                    self.assertEqual(
                        picbed.build_picbed_endpoint(value, operation),
                        f'https://7bu.top/api/v1/{operation}',
                    )

    def test_preserves_self_hosted_subdirectory_and_port(self):
        for value in ('http://localhost:8080/pictures', 'http://localhost:8080/pictures/api/v1/'):
            self.assertEqual(
                picbed.build_picbed_endpoint(value, 'upload'),
                'http://localhost:8080/pictures/api/v1/upload',
            )

    def test_invalid_addresses_are_rejected_without_echoing_credentials(self):
        for value in (
            '7bu.top', 'file:///tmp/image', 'https://',
            'https://7bu.top:not-a-port',
            'https://user:private-value@7bu.top',
            'https://7bu.top/api/v1?token=private-value',
            'https://7bu.top/api/v1#private-value',
        ):
            with self.subTest(value=value):
                with self.assertRaises(ValueError) as error:
                    picbed.build_picbed_endpoint(value, 'profile')
                self.assertNotIn('private-value', str(error.exception))


class PicbedRequestTests(unittest.IsolatedAsyncioTestCase):
    async def test_connection_uses_one_api_prefix_and_bearer_token(self):
        def handle(request):
            self.assertEqual(request.method, 'GET')
            self.assertEqual(str(request.url), 'https://7bu.top/api/v1/profile')
            self.assertEqual(request.headers['authorization'], 'Bearer example-token')
            self.assertEqual(request.headers['accept'], 'application/json')
            return httpx.Response(200, json={'status': True, 'data': {'email': 'example@example.com'}})

        client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
        with patch.object(picbed.httpx, 'AsyncClient', return_value=client):
            result = await picbed.test_picbed_connection({'url': 'https://7bu.top/api/v1', 'token': 'example-token'})
        self.assertTrue(result['success'])

    async def test_upload_uses_normalized_url_and_keeps_multipart_contract(self):
        def handle(request):
            self.assertEqual(request.method, 'POST')
            self.assertEqual(str(request.url), 'https://7bu.top/api/v1/upload')
            self.assertEqual(request.headers['authorization'], 'Bearer example-token')
            self.assertIn('multipart/form-data', request.headers['content-type'])
            self.assertIn(b'name="file"', request.content)
            self.assertIn(b'test-image-content', request.content)
            return httpx.Response(200, json={'status': True, 'data': {'links': {'url': 'https://images.example.com/test.png'}}})

        client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
        image = UploadFile(file=io.BytesIO(b'test-image-content'), filename='test.png', headers=Headers({'content-type': 'image/png'}))
        try:
            with patch.object(picbed.httpx, 'AsyncClient', return_value=client):
                result = await picbed.upload_image(image, 'https://7bu.top/api/v1/', 'Bearer example-token')
        finally:
            await image.close()
        self.assertTrue(result['success'])
        self.assertEqual(result['url'], 'https://images.example.com/test.png')

    async def test_missing_route_is_distinguished_from_invalid_auth(self):
        for status_code in (401, 403, 404):
            with self.subTest(status=status_code):
                client = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(status_code)))
                with patch.object(picbed.httpx, 'AsyncClient', return_value=client):
                    result = await picbed.test_picbed_connection({'url': 'https://7bu.top/api/v1', 'token': 'example-token'})
                self.assertFalse(result['success'])
                self.assertIn(str(status_code), result['message'])
                self.assertIn('接口不存在' if status_code == 404 else '身份校验失败', result['message'])
                self.assertNotIn('example-token', result['message'])


if __name__ == '__main__':
    unittest.main()
