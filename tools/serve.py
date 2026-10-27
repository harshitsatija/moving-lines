"""Static dev server that never lets the browser cache (sketch edits always load)."""
import http.server
import sys


class NoStore(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


http.server.ThreadingHTTPServer(("", int(sys.argv[1]) if len(sys.argv) > 1 else 8123), NoStore).serve_forever()
