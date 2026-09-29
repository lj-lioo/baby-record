import http.server, os, sys
MODE='/tmp/swtest/mode'
class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        root, _, _ = open(MODE).read().strip().split('|')
        self.directory = root
        return super().translate_path(path)
    def end_headers(self):
        _, html, js = open(MODE).read().strip().split('|')
        p = self.path.split('?')[0]
        if p.endswith('sw.js'): self.send_header('Cache-Control', 'max-age=600')
        elif p.endswith('.html') or p.endswith('/') or p.endswith('config.js'): self.send_header('Cache-Control', f'max-age={html}')
        else: self.send_header('Cache-Control', f'max-age={js}')
        super().end_headers()
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('127.0.0.1', 8091), H).serve_forever()
