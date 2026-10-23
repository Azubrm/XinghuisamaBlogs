import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from cms_core.api import sync
from cms_core.site_config import parse_site_config


class CommentSecretSyncTests(unittest.TestCase):
    def test_blog_sync_preserves_public_oauth_fields_but_excludes_secret(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manager = root / 'manager'
            blog = root / 'blog'
            manager.mkdir()
            blog.mkdir()
            (blog / 'package.json').write_text('{}', encoding='utf-8')
            (manager / 'siteConfig.ts').write_text('''export const siteConfig = {
              title: "Example",
              gitalkConfig: { clientID: "public-id", clientSecret: "test-only-private-value", owner: "owner", repo: "comments", admin: ["owner"] },
            };''', encoding='utf-8')
            (manager / '.local-runtime').mkdir()
            (manager / '.local-runtime' / 'github-oauth.json').write_text('{"clientSecret":"test-only-private-value"}', encoding='utf-8')
            app = FastAPI()
            app.include_router(sync.router, prefix='/api/sync')
            with patch.object(sync, 'PROJECT_ROOT', str(manager)), TestClient(app) as client:
                response = client.post('/api/sync/execute', json={'blogPath': str(blog)})
            self.assertTrue(response.json()['success'])
            source = (blog / 'siteConfig.ts').read_text(encoding='utf-8')
            data, _ = parse_site_config(source)
            self.assertEqual(data['gitalkConfig']['clientID'], 'public-id')
            self.assertEqual(data['gitalkConfig']['clientSecret'], '')
            self.assertNotIn('test-only-private-value', source)
            self.assertFalse((blog / '.local-runtime').exists())


if __name__ == '__main__':
    unittest.main()
