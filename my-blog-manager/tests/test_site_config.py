import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from cms_core.api import config
from cms_core.site_config import ConfigSyntaxError, parse_site_config, replace_config_fields


SAMPLE = r'''// const siteConfig = { bio: "comment decoy" };
export const unrelated = { bio: "unrelated" };
export const siteConfig = {
  // Keep this comment and unrelated fields byte-for-byte.
  title: 'A "quoted" title',
  bio: "old bio",
  untouched: { bio: 'nested field', title: 'not root' },
  social: { email: 'old@example.com', nested: { text: 'a } brace // text' } },
  geminiConfig: { temperature: 0.85, maxOutputTokens: 150, systemPrompt: 'say "hi" { }' },
  gitalkConfig: { admin: ['one'], clientID: 'id', clientSecret: 'not-a-real-secret' },
  counts: { articles: 3, visible: true },
  themeColors: ['#111', '#222'],
  footerBadges: [{ label: 'one', enabled: false }],
  useGradient: true,
  enableLevelSystem: false,
};
'''


class SiteConfigTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "siteConfig.ts"
        self.path.write_text(SAMPLE, encoding="utf-8")
        self.path_patch = patch.object(config, "get_config_path", return_value=str(self.path))
        self.path_patch.start()
        self.addCleanup(self.path_patch.stop)

    def test_repeated_save_round_trips_quotes_backslashes_and_newlines(self):
        texts = [
            '之前的简介。"从"人类历史中汲取智慧。',
            "A 'single' and \"double\" quote; C:\\users\\new; literal \\n\n真实换行\r\nend",
            'template ${text}, backtick `, braces { } and emoji 🐾',
        ]
        for text in texts:
            for _ in range(3):
                result = config.update_site_config({"updates": {"bio": text, "title": text}})
                self.assertTrue(result["success"], result)
                data = config.get_site_config()
                self.assertTrue(data["success"], data)
                self.assertEqual(data["data"]["bio"], text)
                self.assertEqual(data["data"]["title"], text)
        self.assertIn("// Keep this comment", self.path.read_text(encoding="utf-8"))
        self.assertIn("untouched: { bio: 'nested field', title: 'not root' }", self.path.read_text(encoding="utf-8"))

    def test_nested_structures_arrays_numbers_and_root_isolation(self):
        data = config.get_site_config()["data"]
        self.assertEqual(data["geminiConfig"]["temperature"], 0.85)
        self.assertEqual(data["geminiConfig"]["maxOutputTokens"], 150)
        self.assertNotIn("temperature", data)
        self.assertEqual(data["themeColors"], ["#111", "#222"])
        changes = {
            "bio": 'changed "root"',
            "social": {"email": "new@example.com", "nested": {"text": '} \\" {', "list": [True, None, -1, 2.5]}},
            "counts": {"articles": 5, "visible": False},
            "themeColors": ["#333", "#444"],
            "footerBadges": [{"label": '"badge"', "enabled": True}],
            "useGradient": False,
            "enableLevelSystem": True,
        }
        self.assertTrue(config.update_site_config({"updates": changes})["success"])
        readback = config.get_site_config()["data"]
        for key, expected in changes.items():
            self.assertEqual(readback[key], expected)
        self.assertEqual(readback["untouched"], data["untouched"])
        self.assertIn('export const unrelated = { bio: "unrelated" };', self.path.read_text(encoding="utf-8"))

    def test_decode_js_escapes_and_static_multiline_template(self):
        source = r'''export const siteConfig = {
          bio: 'quote \' double " slash \\ literal \\n newline \n\x41\u4e2d\u{1f43e}\ud83d\udc3e',
          title: `line one
line two`,
          counts: { negative: -2.5e-2, hex: 0xff, yes: true, no: false },
        };'''
        data, _ = parse_site_config(source)
        self.assertEqual(data["bio"], "quote ' double \" slash \\ literal \\n newline \nA中🐾🐾")
        self.assertEqual(data["title"], "line one\nline two")
        self.assertEqual(data["counts"], {"negative": -0.025, "hex": 255, "yes": True, "no": False})

    def test_whitelist_and_unchanged_comments_are_preserved(self):
        original = self.path.read_text(encoding="utf-8")
        data = config.get_site_config()["data"]
        self.assertTrue(config.update_site_config({"updates": {"untouched": "blocked", "temperature": 1, "social": data["social"]}})["success"])
        self.assertEqual(self.path.read_text(encoding="utf-8"), original)

    def test_invalid_source_or_update_cannot_replace_file(self):
        broken = 'export const siteConfig = { bio: "new"leftover", title: "title" };'
        self.path.write_text(broken, encoding="utf-8")
        result = config.update_site_config({"updates": {"bio": "replacement"}})
        self.assertFalse(result["success"])
        self.assertEqual(self.path.read_text(encoding="utf-8"), broken)
        self.path.write_text(SAMPLE, encoding="utf-8")
        self.assertFalse(config.update_site_config({"updates": {"counts": float("nan")}})["success"])
        self.assertEqual(self.path.read_text(encoding="utf-8"), SAMPLE)
        self.assertEqual(list(Path(self.directory.name).glob(".siteConfig-*.tmp")), [])

    def test_expressions_are_rejected_without_evaluation(self):
        for expression in ("process.exit(1)", "`hello ${danger()}`", "{ ...other }"):
            with self.assertRaises(ConfigSyntaxError):
                replace_config_fields("export const siteConfig = { bio: " + expression + " };", {"bio": "safe"}, {"bio"})

    def test_root_object_cannot_have_a_dynamic_suffix(self):
        for suffix in ("+ dangerous()", ".property", " || other"):
            with self.assertRaises(ConfigSyntaxError):
                parse_site_config('export const siteConfig = { bio: "text" }' + suffix + ";")
        data, _ = parse_site_config('export const siteConfig = { bio: "text" } as const;')
        self.assertEqual(data, {"bio": "text"})

    def test_failed_atomic_replace_keeps_original_and_cleans_temporary_file(self):
        original = self.path.read_bytes()
        with patch("cms_core.site_config.os.replace", side_effect=OSError("simulated replace failure")):
            result = config.update_site_config({"updates": {"bio": 'changed "bio"'}})
        self.assertFalse(result["success"])
        self.assertEqual(self.path.read_bytes(), original)
        self.assertEqual(list(Path(self.directory.name).glob(".siteConfig-*.tmp")), [])

    def test_single_admin_shorthand_is_serialized_safely(self):
        updates = {"gitalkConfig": {"admin": 'one "quoted" user', "clientID": "new-id", "clientSecret": 'a } brace "'}}
        self.assertTrue(config.update_site_config({"updates": updates})["success"])
        data = config.get_site_config()["data"]["gitalkConfig"]
        self.assertEqual(data["admin"], ['one "quoted" user'])
        self.assertEqual(updates["gitalkConfig"]["admin"], 'one "quoted" user')


if __name__ == "__main__":
    unittest.main()
