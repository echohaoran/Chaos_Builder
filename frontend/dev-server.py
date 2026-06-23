#!/usr/bin/env python3
"""
ChaosBuilder frontend dev server.
Maps root-level .html page requests to frontend/html/ so that direct access
like /text-to-image.html works even though files are in frontend/html/.
"""
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
BASE = os.path.dirname(os.path.abspath(__file__))  # frontend/
HTML_DIR = os.path.join(BASE, 'html')


class Handler(http.server.SimpleHTTPRequestHandler):
    """HTTP request handler that maps .html pages from html/ subdirectory."""

    def translate_path(self, path):
        # Strip query string (e.g. /landing.html?from=login → /landing.html)
        if '?' in path:
            path = path[:path.index('?')]
        rel = path.lstrip('/')

        # Root or directory: serve html/index.html
        if rel == '' or rel.endswith('/'):
            return os.path.join(HTML_DIR, 'index.html')

        # Root-level .html file: serve from html/ subdirectory
        if '/' not in rel and rel.endswith('.html'):
            html_path = os.path.join(HTML_DIR, rel)
            if os.path.exists(html_path):
                return html_path

        # Everything else (js/, css/, assets/, html/*): serve from BASE
        return super().translate_path(path)


if __name__ == '__main__':
    os.chdir(BASE)
    httpd = http.server.HTTPServer(('', PORT), Handler)
    print(f'ChaosBuilder frontend serving on http://localhost:{PORT}')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nShutting down.')
        httpd.shutdown()