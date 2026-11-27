import json
import logging
import socket
import threading
import unittest
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import _env

_env.init()
from pipeline.clients.http_retry import RetriesExhausted, request
from pipeline.scripts.fetch_article_types import fetch_with_retry


def no_wait(_attempt):
    return 0


logging.getLogger("http").setLevel(logging.ERROR)  # the retry warnings are expected in these tests


class Server:
    """A local server that answers each request with the next (status, body) of a script, then repeats the last."""

    def __init__(self, *script):
        self.script, self.calls, self.bodies = list(script), 0, []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def answer(self):
                status, body = outer.script[min(outer.calls, len(outer.script) - 1)]
                outer.calls += 1
                length = int(self.headers.get("Content-Length") or 0)
                outer.bodies.append(self.rfile.read(length) if length else b"")
                self.send_response(status)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            do_GET = do_POST = answer

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.httpd.server_port}/x"

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()


class Request(unittest.TestCase):
    def serve(self, *script):
        server = Server(*script)
        self.addCleanup(server.close)
        return server

    def test_rate_limits_and_server_errors_are_retried(self):
        s = self.serve((429, b""), (503, b""), (200, b"ok"))
        self.assertEqual(request(s.url, backoff=no_wait), b"ok")
        self.assertEqual(s.calls, 3)

    def test_an_answer_like_404_is_raised_at_once_for_the_caller(self):
        s = self.serve((404, b""))
        with self.assertRaises(urllib.error.HTTPError) as caught:
            request(s.url, backoff=no_wait)
        self.assertEqual((caught.exception.code, s.calls), (404, 1))

    def test_running_out_of_attempts_raises_with_the_last_status(self):
        s = self.serve((500, b""))
        with self.assertRaises(RetriesExhausted) as caught:
            request(s.url, attempts=3, backoff=no_wait)
        self.assertEqual((caught.exception.status, s.calls), (500, 3))
        self.assertIsInstance(caught.exception, RuntimeError)  # callers that catch RuntimeError still do

    def test_a_response_cut_short_is_retried(self):
        s = self.serve((200, b'{"results": ['), (200, b'{"results": []}'))
        self.assertEqual(request(s.url, backoff=no_wait, parse=lambda b: json.loads(b)), {"results": []})
        self.assertEqual(s.calls, 2)

    def test_a_network_error_counts_as_retryable(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        with self.assertRaises(RetriesExhausted) as caught:
            request(f"http://127.0.0.1:{port}/nothing-listens-here", attempts=2, backoff=no_wait, timeout=2)
        self.assertIsNone(caught.exception.status)

    def test_posts_send_their_body(self):
        s = self.serve((200, b"[]"))
        request(s.url, data=b'{"ids": ["DOI:x"]}', headers={"Content-Type": "application/json"}, backoff=no_wait)
        self.assertEqual(s.bodies, [b'{"ids": ["DOI:x"]}'])


class PublisherResponses(unittest.TestCase):
    def test_status_and_text_as_the_article_type_fetch_expects(self):
        ok, missing, down = Server((200, b'{"records": []}')), Server((404, b"")), Server((503, b""))
        for s in (ok, missing, down):
            self.addCleanup(s.close)
        import pipeline.scripts.fetch_article_types as fat
        original = fat.request
        fat.request = lambda *a, **k: original(*a, **{**k, "backoff": no_wait})  # no real waits in a test
        try:
            self.assertEqual(fetch_with_retry(ok.url, {}), (200, '{"records": []}'))
            self.assertEqual(fetch_with_retry(missing.url, {}), (404, ""))
            self.assertEqual(fetch_with_retry(down.url, {}), (503, ""))
        finally:
            fat.request = original


if __name__ == "__main__":
    unittest.main()
