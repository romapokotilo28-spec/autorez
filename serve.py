#!/usr/bin/env python3
"""Локальный сервер для сайта «Кадр»."""

import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = 8765


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        super().end_headers()


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    try:
        server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError as exc:
        raise SystemExit(f"Порт {PORT} занят: {exc}") from exc
    print(f"http://127.0.0.1:{PORT}/")
    server.serve_forever()
