#!/usr/bin/env python3
# 本地静态服务器：为 Unity WebGL(WebGPU) 构建提供正确的 MIME 与安全隔离头。
# 关键：所有 .br 文件实为未压缩内容（扩展名误标），按真实类型返回，不带 Content-Encoding。
import http.server, socketserver, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8901
os.chdir(ROOT)

class Handler(http.server.SimpleHTTPRequestHandler):
    def guess_type(self, path):
        p = path.lower()
        if p.endswith('.wasm') or p.endswith('.wasm.br'):   return 'application/wasm'
        if p.endswith('.js') or p.endswith('.js.br'):       return 'application/javascript'
        if p.endswith(('.data', '.data.br', '.bundle', '.bundle.br', '.br', '.bin', '.raw')):
            return 'application/octet-stream'
        if p.endswith('.json'):   return 'application/json'
        if p.endswith('.woff2'):  return 'font/woff2'
        return super().guess_type(path)

    def end_headers(self):
        # WebGPU + SharedArrayBuffer（Unity 多线程）需要跨域隔离
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, *args):
        pass

socketserver.TCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), Handler) as srv:
    print(f"Serving {ROOT}\n  → http://127.0.0.1:{PORT}  (Ctrl+C 停止)", flush=True)
    srv.serve_forever()
