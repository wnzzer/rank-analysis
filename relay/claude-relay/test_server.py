"""地区白名单的 HTTP 回归测试：python3 -m unittest discover -s relay/claude-relay。"""
import http.client
import json
import importlib.util
from pathlib import Path
import threading
import unittest
from unittest.mock import patch, MagicMock

spec = importlib.util.spec_from_file_location("relay_server", Path(__file__).with_name("server.py"))
relay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(relay)


class WhitelistTests(unittest.TestCase):
    def setUp(self):
        self.config = patch.multiple(
            relay, ALLOWED_IPS=frozenset({"203.0.113.1"}),
            ALLOWED_DEVICE_IDS=frozenset({"test-device"}),
            RELAY_TOKEN="test-token", DEBUG=False,
        )
        self.config.start()
        self.geo = patch.object(relay, "GEO")
        self.geo.start().country.return_value = "CN"
        self.server = relay.ThreadingHTTPServer(("127.0.0.1", 0), relay.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.geo.stop()
        self.config.stop()

    def request(self, method, device=None, token="test-token", ip="198.51.100.1", ua="rank-analysis/test", body=None):
        conn = http.client.HTTPConnection(*self.server.server_address)
        headers = {"User-Agent": ua, "X-Forwarded-For": ip, "X-Relay-Token": token}
        if device is not None:
            headers["X-Device-ID"] = device
        conn.request(method, "/v1/region" if method == "GET" else "/v1/chat", body=(body or "{}") if method == "POST" else None, headers=headers)
        resp = conn.getresponse()
        result = resp.status, resp.read()
        conn.close()
        return result

    def test_device_whitelist_applies_to_both_endpoints(self):
        for ip in ("198.51.100.1", "198.51.100.2"):
            with self.subTest(ip=ip):
                self.assertIn(b'"allowed": true', self.request("GET", "test-device", ip=ip)[1])
                # 缺少 model/prompt 返回 400，说明已通过地区门控，未实际调用上游。
                self.assertEqual(self.request("POST", "test-device", ip=ip)[0], 400)

    def test_unlisted_and_missing_device_remain_blocked(self):
        for device in (None, "", "other-device"):
            with self.subTest(device=device):
                self.assertIn(b'"allowed": false', self.request("GET", device)[1])
                self.assertEqual(self.request("POST", device)[0], 403)

    def test_ip_whitelist_remains_supported(self):
        for ip in ("203.0.113.1", "::ffff:203.0.113.1"):
            self.assertIn(b'"allowed": true', self.request("GET", ip=ip)[1])
            self.assertEqual(self.request("POST", ip=ip)[0], 400)

    def test_whitelisted_device_still_requires_authentication(self):
        self.assertEqual(self.request("POST", "test-device", token="wrong")[0], 401)
        self.assertEqual(self.request("GET", "test-device", ua="browser")[0], 403)

    def test_fast_mode_only_applies_to_opus_when_enabled(self):
        for enabled in (False, True):
            for model in ("claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"):
                with self.subTest(enabled=enabled, model=model):
                    client = MagicMock()
                    stream = client.beta.messages.stream.return_value.__enter__.return_value
                    stream.text_stream = iter(["ok"])
                    final = stream.get_final_message.return_value
                    final.stop_reason = "end_turn"
                    final.model = model
                    with patch.multiple(relay, FAST_MODE=enabled, DEFAULT_CLIENT=client), patch.object(relay, "LIMITER") as limiter:
                        limiter.acquire.return_value = None
                        status, data = self.request("POST", "test-device", body=json.dumps({"model": model, "prompt": "test"}))
                    self.assertEqual(status, 200)
                    self.assertIn(b"[DONE]", data)
                    kwargs = client.beta.messages.stream.call_args.kwargs
                    if enabled and model == "claude-opus-5-5":
                        self.assertEqual(kwargs["speed"], "fast")
                    else:
                        self.assertNotIn("speed", kwargs)

    def test_region_rules_without_whitelist(self):
        self.assertTrue(relay.region_allowed("US"))
        for country in ("CN", "ZZ", None):
            self.assertFalse(relay.region_allowed(country))
            self.assertTrue(relay.region_allowed(country, device_id="test-device"))


if __name__ == "__main__":
    unittest.main()
