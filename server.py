#!/usr/bin/env python3
"""
Mr. Oops!! - Lightweight Local Game & Config Server
Serves the game files and provides a POST /api/config endpoint to persist config.json to disk.
"""

import http.server
import socketserver
import json
import os
import sys

PORT = 8081
if len(sys.argv) > 1:
    try:
        PORT = int(sys.argv[1])
    except ValueError:
        pass

BASE_DIR = os.path.abspath(os.path.dirname(__file__))

class GameConfigHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def do_POST(self):
        if self.path == '/api/config' or self.path == '/save_config':
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                post_data = self.rfile.read(content_length)
                config_data = json.loads(post_data.decode('utf-8'))
                
                config_path = os.path.join(BASE_DIR, 'config.json')
                with open(config_path, 'w', encoding='utf-8') as f:
                    json.dump(config_data, f, indent=2, ensure_ascii=False)

                print(f"[Mr. Oops Server] Successfully wrote new configuration to {config_path}")

                response = json.dumps({"status": "ok", "message": "Saved to config.json"}).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-Length', str(len(response)))
                self.end_headers()
                self.wfile.write(response)
            except Exception as e:
                print(f"[Mr. Oops Server] Error saving config: {e}")
                err_resp = json.dumps({"status": "error", "message": str(e)}).encode('utf-8')
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-Length', str(len(err_resp)))
                self.end_headers()
                self.wfile.write(err_resp)
        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def end_headers(self):
        # Prevent caching for config.json and API responses
        if self.path.endswith('.json') or self.path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        super().end_headers()

def main():
    socketserver.TCPServer.allow_reuse_address = True
    try:
        with socketserver.TCPServer(("", PORT), GameConfigHandler) as httpd:
            print(f"=====================================================")
            print(f"🎮 Mr. Oops!! 遊戲與設定伺服器已啟動！")
            print(f"▶ 遊戲頁面:   http://localhost:{PORT}/index.html")
            print(f"⚙️ 設定頁面:   http://localhost:{PORT}/settings.html")
            print(f"=====================================================")
            print("提示：您可以用 Chrome 開啟兩個分頁並排顯示，邊玩邊調整數值！")
            sys.stdout.flush()
            httpd.serve_forever()
    except OSError as e:
        print(f"無法綁定通訊埠 {PORT}: {e}")
        print("請嘗試更換通訊埠，例如: python3 server.py 8082")

if __name__ == '__main__':
    main()
