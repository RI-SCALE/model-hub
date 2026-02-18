import unittest

from scripts.chat_proxy_utils import (
    build_service_alias,
    make_dev_app_id,
    slugify_branch_name,
)


class ChatProxyUtilsTests(unittest.TestCase):
    def test_slugify_branch_name(self):
        self.assertEqual(slugify_branch_name("feature/chat proxy"), "feature-chat-proxy")
        self.assertEqual(slugify_branch_name("___"), "branch")

    def test_make_dev_app_id(self):
        app_id = make_dev_app_id("feature/super-long-branch-name-with-more-and-more-characters")
        self.assertTrue(app_id.startswith("chat-proxy-dev-"))
        self.assertLessEqual(len(app_id), 63)

    def test_build_service_alias(self):
        alias = build_service_alias("ri-scale", "chat-proxy-dev-abc")
        self.assertEqual(alias, "ri-scale/default@chat-proxy-dev-abc")


if __name__ == "__main__":
    unittest.main()
