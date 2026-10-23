"""
Claude 中转服务（部署在 Oracle ashburn）

客户端（rank-analysis 桌面端）不内置 Anthropic key：Claude 请求全部走这里，
由服务端持有 key 转发到 Anthropic，并按**客户端出口 IP 的国家**做区域门控——
Anthropic 未提供服务的地区（默认 CN/HK/MO/RU 等）一律拒绝，前端据此置灰 Claude 选项。

接口：
- GET  /v1/region  → {"country": "US", "allowed": true}
- POST /v1/chat    → SSE，行格式与 OpenAI 兼容流一致：
                     data: {"choices":[{"delta":{"content":"..."}}]}
                     出错：data: {"error":{"message":"..."}}；结束：data: [DONE]
- GET  /healthz

请求头：
- X-Device-ID（可选）：客户端匿名设备 ID，命中 ALLOWED_DEVICE_IDS 时豁免地区限制
- X-User-Key（可选）：用户自带 Anthropic key，带了就用用户的、不占内置额度
- User-Agent：必须以 REQUIRED_UA_PREFIX（默认 rank-analysis/）开头，否则 403（/healthz 除外）
- X-Relay-Token：服务端设了 RELAY_TOKEN 时必须一致（防被随手白嫖）

只依赖 anthropic SDK + 标准库。国家判定用 DB-IP Lite 国家库（CSV，CC BY 4.0）。
"""

import bisect
import csv
import gzip
import ipaddress
import json
import logging
import os
import threading
import time
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import anthropic

log = logging.getLogger("claude-relay")

# ---- 配置（全部走环境变量，见 claude-relay.env.example）----
PORT = int(os.environ.get("PORT", "8787"))
# 只听本机：公网入口是前面的 Caddy（HTTPS :8443，见 Caddyfile），不直接暴露明文端口
BIND = os.environ.get("BIND", "127.0.0.1")
GEO_DB = os.environ.get("GEO_DB", "/opt/claude-relay/dbip-country-lite.csv.gz")
# Anthropic 未提供服务的地区（ISO 3166-1 alpha-2）。以官方支持国家列表为准随时可改，不用发客户端版本
BLOCKED_COUNTRIES = set(
    os.environ.get("BLOCKED_COUNTRIES", "CN,HK,MO,RU,BY,IR,KP,SY,CU").upper().split(",")
)
# 测试白名单仅豁免地区限制，认证和限流仍生效；不把设备 ID 当作鉴权凭证。
ALLOWED_IPS = frozenset(
    str(ipaddress.ip_address(v.strip()))
    for v in os.environ.get("ALLOWED_IPS", "").split(",") if v.strip()
)
ALLOWED_DEVICE_IDS = frozenset(
    v.strip() for v in os.environ.get("ALLOWED_DEVICE_IDS", "").split(",") if v.strip()
)
ALLOWED_MODELS = set(
    os.environ.get("ALLOWED_MODELS", "claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5").split(",")
)
# 速度优先：复盘类任务 low 足够（PK 时 Opus 5.5 low 已明显优于 ds）
EFFORT = os.environ.get("EFFORT", "low")
MAX_TOKENS = int(os.environ.get("MAX_TOKENS", "8000"))
# 内置 key 的限额（用户自带 key 不受限）：单 IP 每小时次数 + 全局每日次数，防成本失控
PER_IP_HOURLY = int(os.environ.get("PER_IP_HOURLY", "30"))
DAILY_CAP = int(os.environ.get("DAILY_CAP", "500"))
RELAY_TOKEN = os.environ.get("RELAY_TOKEN", "")
# 客户端 UA 前缀（Rust 侧 RELAY_USER_AGENT）。UA 可伪造，只挡浏览器 / 扫描器这类随手请求；置空关闭
REQUIRED_UA_PREFIX = os.environ.get("REQUIRED_UA_PREFIX", "rank-analysis/")
# 调试开关：允许 /v1/region?ip=x.x.x.x 指定 IP 测判定
DEBUG = os.environ.get("RELAY_DEBUG") == "1"
MAX_BODY = 512 * 1024

JSON_MODE_HINT = "\n\n只输出一个合法 JSON 对象，不要输出任何解释文字或 markdown 代码块。"


class GeoDb:
    """DB-IP Lite 国家库：按起始地址排序的区间表 + 二分查找"""

    def __init__(self, path):
        self.v4 = ([], [], [])  # starts, ends, countries
        self.v6 = ([], [], [])
        if not os.path.exists(path):
            log.error("geo db %s 不存在，所有请求都会判为未知地区", path)
            return
        opener = gzip.open if path.endswith(".gz") else open
        with opener(path, "rt", newline="") as f:
            for start, end, cc in csv.reader(f):
                s, e = ipaddress.ip_address(start), ipaddress.ip_address(end)
                table = self.v4 if s.version == 4 else self.v6
                table[0].append(int(s))
                table[1].append(int(e))
                table[2].append(cc)
        # 二分要求按起始地址有序；官方文件本就有序，排一次防手工拼接的库乱序
        self.v4, self.v6 = (self._sorted(t) for t in (self.v4, self.v6))
        log.info("geo db loaded: v4=%d v6=%d", len(self.v4[0]), len(self.v6[0]))

    @staticmethod
    def _sorted(table):
        rows = sorted(zip(*table))
        return tuple(list(col) for col in zip(*rows)) if rows else ([], [], [])

    def country(self, ip):
        try:
            addr = ipaddress.ip_address(ip)
        except ValueError:
            return None
        # IPv4-mapped IPv6（::ffff:1.2.3.4）按 v4 查
        if addr.version == 6 and addr.ipv4_mapped:
            addr = addr.ipv4_mapped
        starts, ends, ccs = self.v4 if addr.version == 4 else self.v6
        n = int(addr)
        i = bisect.bisect_right(starts, n) - 1
        if i >= 0 and n <= ends[i]:
            return ccs[i]
        return None


def region_allowed(country, ip=None, device_id=None):
    """白名单优先；其他客户端仍按地区限制，未知地区默认拒绝。"""
    if device_id and device_id.strip() in ALLOWED_DEVICE_IDS:
        return True
    if ip:
        try:
            addr = ipaddress.ip_address(ip)
            if addr.version == 6 and addr.ipv4_mapped:
                addr = addr.ipv4_mapped
            if str(addr) in ALLOWED_IPS:
                return True
        except ValueError:
            pass
    return bool(country) and country not in BLOCKED_COUNTRIES and country != "ZZ"


class Limiter:
    """内存限流：单 IP 滑动一小时窗口 + 全局自然日计数（进程重启清零，够用）"""

    def __init__(self):
        self.lock = threading.Lock()
        self.per_ip = defaultdict(deque)
        self.day = time.strftime("%Y-%m-%d")
        self.day_count = 0

    def acquire(self, ip):
        now = time.time()
        with self.lock:
            today = time.strftime("%Y-%m-%d")
            if today != self.day:
                self.day, self.day_count = today, 0
            if self.day_count >= DAILY_CAP:
                return "今日内置 Claude 额度已用完，可明天再试，或在设置中填入自己的 Claude API Key"
            q = self.per_ip[ip]
            while q and now - q[0] > 3600:
                q.popleft()
            if len(q) >= PER_IP_HOURLY:
                return "请求过于频繁（每小时上限 %d 次），请稍后再试" % PER_IP_HOURLY
            q.append(now)
            self.day_count += 1
            return None


GEO = None
LIMITER = Limiter()
DEFAULT_CLIENT = None


def sse(obj):
    return ("data: " + json.dumps(obj, ensure_ascii=False) + "\n\n").encode()


class Handler(BaseHTTPRequestHandler):
    server_version = "claude-relay/1"
    # HTTP/1.1 才支持 keep-alive：客户端（Rust 共享连接池）复用连接、省掉到美东的握手。
    # 因此每个响应都必须有明确边界（JSON 带 Content-Length，SSE 走 chunked），不能靠断连收尾
    protocol_version = "HTTP/1.1"
    # 连接空闲超时（秒）：长于客户端连接池的 90s，保证总是客户端先放弃空闲连接，
    # 不会复用到一条服务端刚关掉的连接；同时防空闲连接长期占着线程
    timeout = 120

    def log_message(self, fmt, *args):
        log.info("%s %s", self.client_address[0], fmt % args)

    def _json(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status, message):
        self._json(status, {"error": {"message": message}})

    def _chunk(self, data):
        """写一个 chunked 分块并立即刷出（SSE 要逐块送达）"""
        self.wfile.write(b"%x\r\n%s\r\n" % (len(data), data))
        self.wfile.flush()

    def _client_ip(self):
        """真实客户端 IP（地区判定与限流都靠它）。

        经 Caddy 转发时 TCP 对端是本机，真实 IP 在 X-Forwarded-For。只在对端是本机时才信这个头，
        并取最后一跳（Caddy 追加的那个）——客户端自己伪造的 XFF 排在前面，骗不过地区判定。
        """
        peer = self.client_address[0]
        xff = self.headers.get("X-Forwarded-For")
        if xff and ipaddress.ip_address(peer).is_loopback:
            return xff.split(",")[-1].strip()
        return peer

    def _ua_ok(self):
        return (self.headers.get("User-Agent") or "").startswith(REQUIRED_UA_PREFIX)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/healthz":
            return self._json(200, {"ok": True})
        if not self._ua_ok():
            return self._error(403, "forbidden")
        if url.path == "/v1/region":
            ip = self._client_ip()
            if DEBUG:
                ip = parse_qs(url.query).get("ip", [ip])[0]
            country = GEO.country(ip)
            return self._json(200, {"country": country, "allowed": region_allowed(country, ip, self.headers.get("X-Device-ID"))})
        self._error(404, "not found")

    def do_POST(self):
        # keep-alive 下必须先把请求体读完，否则任何提前返回都会把没读的 body
        # 留在连接里，被当成下一个请求解析
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            self.close_connection = True  # 不读超大 body，直接断开
            return self._error(413, "请求体过大")
        raw = self.rfile.read(length) if length > 0 else b""

        if urlparse(self.path).path != "/v1/chat":
            return self._error(404, "not found")
        if not self._ua_ok():
            return self._error(403, "forbidden")
        if RELAY_TOKEN and self.headers.get("X-Relay-Token") != RELAY_TOKEN:
            return self._error(401, "客户端未授权")

        ip = self._client_ip()
        country = GEO.country(ip)
        if not region_allowed(country, ip, self.headers.get("X-Device-ID")):
            return self._error(403, "当前地区（%s）不在 Claude 服务范围内" % (country or "未知"))

        try:
            req = json.loads(raw)
            model, prompt = req["model"], req["prompt"]
        except (ValueError, KeyError, TypeError):
            return self._error(400, "请求格式错误")
        if model not in ALLOWED_MODELS:
            return self._error(400, "不支持的模型：%s" % model)

        user_key = (self.headers.get("X-User-Key") or "").strip()
        if user_key:
            client = anthropic.Anthropic(api_key=user_key)
        else:
            if DEFAULT_CLIENT is None:
                return self._error(503, "中转未配置官方 Key，请在设置中填入自己的 Claude API Key")
            reason = LIMITER.acquire(ip)
            if reason:
                return self._error(429, reason)
            client = DEFAULT_CLIENT

        system = req.get("system") or ""
        if req.get("jsonMode"):
            system += JSON_MODE_HINT

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()

        started = time.time()
        first_token = None
        try:
            with client.beta.messages.stream(
                model=model,
                max_tokens=MAX_TOKENS,
                system=system,
                messages=[{"role": "user", "content": prompt}],
                output_config={"effort": EFFORT},
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            ) as stream:
                # 上游已建立连接：先回一个 SSE 注释，喂饱客户端首字看门狗
                # （Opus 5.5 思考恒开，首个正文 token 前会有一段思考时间）
                self._chunk(b": started\n\n")
                for text in stream.text_stream:
                    if first_token is None:
                        first_token = time.time() - started
                    self._chunk(sse({"choices": [{"delta": {"content": text}}]}))
                final = stream.get_final_message()
            if final.stop_reason == "refusal":
                self._chunk(sse({"error": {"message": "Claude 拒绝了这次请求，请换用 DeepSeek 再试"}}))
            elif final.stop_reason == "max_tokens":
                log.warning("max_tokens hit model=%s", model)
            log.info(
                # ttft：首个正文 token 耗时（含思考），total：全程。提速决策看这两个数
                "chat ok ip=%s cc=%s model=%s byok=%s in=%s out=%s ttft=%s total=%.1fs",
                ip, country, final.model, bool(user_key),
                final.usage.input_tokens, final.usage.output_tokens,
                "%.1fs" % first_token if first_token is not None else "-", time.time() - started,
            )
            self._chunk(b"data: [DONE]\n\n")
        except anthropic.AuthenticationError:
            self._chunk(sse({"error": {"message": "Claude API Key 无效"}}))
        except anthropic.RateLimitError:
            self._chunk(sse({"error": {"message": "Claude 服务繁忙（限流），请稍后再试"}}))
        except anthropic.APIStatusError as e:
            log.warning("upstream %s: %s", e.status_code, e.message)
            self._chunk(sse({"error": {"message": "Claude 上游错误（%s）" % e.status_code}}))
        except anthropic.APIConnectionError as e:
            log.warning("upstream connection: %s", e)
            self._chunk(sse({"error": {"message": "连接 Claude 失败，请稍后再试"}}))
        except (BrokenPipeError, ConnectionResetError):
            log.info("client disconnected ip=%s", ip)
            self.close_connection = True
            return
        # chunked 结束标记：流到此为止，连接留给下一个请求复用
        self.wfile.write(b"0\r\n\r\n")


def main():
    global GEO, DEFAULT_CLIENT
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    GEO = GeoDb(GEO_DB)
    # 内置 key 从 ANTHROPIC_API_KEY 读；SDK 自带 429/5xx/连接错误重试。
    # 没配也照常启动（区域检测、自带 key 仍可用），便于先部署后填 key
    if os.environ.get("ANTHROPIC_API_KEY"):
        DEFAULT_CLIENT = anthropic.Anthropic()
    else:
        log.warning("ANTHROPIC_API_KEY 未配置，仅支持用户自带 key")
    httpd = ThreadingHTTPServer((BIND, PORT), Handler)
    httpd.daemon_threads = True
    log.info("listening on %s:%d blocked=%s models=%s", BIND, PORT, sorted(BLOCKED_COUNTRIES), sorted(ALLOWED_MODELS))
    httpd.serve_forever()


if __name__ == "__main__":
    main()
