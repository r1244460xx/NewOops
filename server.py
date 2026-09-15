#!/usr/bin/env python3
"""
Mr. Oops!! - Lightweight Local Game, Config & LAN Multiplayer Relay Server
Serves the game files, provides /api/config persistence, and acts as a
zero-dependency RFC 6455 WebSocket relay for 1v1 LAN multiplayer.
"""

import http.server
import socketserver
import socket
import threading
import hashlib
import base64
import struct
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
MAGIC_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

def get_local_ip():
    """Detect local LAN IP for easy sharing with opponent on same Wi-Fi/network."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def make_ws_accept(key):
    val = (key.strip() + MAGIC_GUID).encode('utf-8')
    return base64.b64encode(hashlib.sha1(val).digest()).decode('utf-8')

def encode_ws_frame(payload_str):
    payload = payload_str.encode('utf-8')
    length = len(payload)
    if length <= 125:
        header = struct.pack('!BB', 0x81, length)
    elif length <= 65535:
        header = struct.pack('!BBH', 0x81, 126, length)
    else:
        header = struct.pack('!BBQ', 0x81, 127, length)
    return header + payload

def decode_ws_frame(stream):
    first_two = stream.read(2)
    if not first_two or len(first_two) < 2:
        return None, None
    b1, b2 = struct.unpack('!BB', first_two)
    opcode = b1 & 0x0F
    is_masked = (b2 & 0x80) != 0
    length = b2 & 0x7F

    if length == 126:
        lb = stream.read(2)
        if len(lb) < 2: return None, None
        length = struct.unpack('!H', lb)[0]
    elif length == 127:
        lb = stream.read(8)
        if len(lb) < 8: return None, None
        length = struct.unpack('!Q', lb)[0]

    mask = stream.read(4) if is_masked else None
    data = stream.read(length)
    if len(data) < length: return None, None

    if is_masked and mask:
        unmasked = bytearray(length)
        for i in range(length):
            unmasked[i] = data[i] ^ mask[i % 4]
        return opcode, unmasked.decode('utf-8', errors='replace')
    return opcode, data.decode('utf-8', errors='replace')

class WSClientWrapper:
    def __init__(self, rfile, wfile, raw_socket):
        self.rfile = rfile
        self.wfile = wfile
        self.socket = raw_socket
        self.room_code = None
        self.role = None
        self.lock = threading.Lock()

    def send_json(self, obj):
        frame = encode_ws_frame(json.dumps(obj, ensure_ascii=False))
        with self.lock:
            try:
                self.wfile.write(frame)
                self.wfile.flush()
            except Exception:
                pass

class RoomManager:
    def __init__(self):
        self.lock = threading.Lock()
        self.rooms = {}

    def join_room(self, room_code, role, client):
        with self.lock:
            if room_code not in self.rooms:
                self.rooms[room_code] = {"host": None, "client": None}
            room = self.rooms[room_code]

            if role == "host":
                room["host"] = client
                client.room_code = room_code
                client.role = "host"
                client.send_json({
                    "type": "joined",
                    "role": "host",
                    "room": room_code,
                    "opponent_present": room["client"] is not None
                })
                if room["client"]:
                    room["client"].send_json({"type": "host_ready", "role": "host"})
                print(f"[WebSocket] Host joined room '{room_code}'")
            else:
                room["client"] = client
                client.room_code = room_code
                client.role = "client"
                client.send_json({
                    "type": "joined",
                    "role": "client",
                    "room": room_code,
                    "host_present": room["host"] is not None
                })
                if room["host"]:
                    room["host"].send_json({"type": "opponent_joined", "role": "client"})
                print(f"[WebSocket] Client (P2) joined room '{room_code}'")

    def handle_message(self, client, data_str):
        try:
            msg = json.loads(data_str)
        except Exception:
            return

        msg_type = msg.get("action") or msg.get("type")
        if msg_type == "join":
            room_code = str(msg.get("room", "1234")).strip()
            role = msg.get("role", "host")
            self.join_room(room_code, role, client)
        elif msg_type == "ping":
            client.send_json({"type": "pong"})
        else:
            # Generic bidirectional relay between Host (P1) and Client (P2)
            with self.lock:
                room = self.rooms.get(getattr(client, "room_code", None))
                if room:
                    if client.role == "client" and room.get("host"):
                        room["host"].send_json(msg)
                    elif client.role == "host" and room.get("client"):
                        room["client"].send_json(msg)

    def remove_client(self, client):
        with self.lock:
            room_code = getattr(client, "room_code", None)
            if not room_code or room_code not in self.rooms:
                return
            room = self.rooms[room_code]
            if client.role == "host" and room.get("host") == client:
                room["host"] = None
                if room.get("client"):
                    room["client"].send_json({"type": "opponent_left", "role": "host"})
                print(f"[WebSocket] Host left room '{room_code}'")
            elif client.role == "client" and room.get("client") == client:
                room["client"] = None
                if room.get("host"):
                    room["host"].send_json({"type": "opponent_left", "role": "client"})
                print(f"[WebSocket] Client left room '{room_code}'")
            if not room["host"] and not room["client"]:
                del self.rooms[room_code]

room_manager = RoomManager()

class GameServerHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def do_GET(self):
        # 1. Check for WebSocket upgrade on /ws
        if self.path.startswith('/ws'):
            upgrade = self.headers.get('Upgrade', '').lower()
            if upgrade == 'websocket':
                key = self.headers.get('Sec-WebSocket-Key', '')
                if not key:
                    self.send_response(400)
                    self.end_headers()
                    return

                accept_key = make_ws_accept(key)
                self.send_response(101, "Switching Protocols")
                self.send_header("Upgrade", "websocket")
                self.send_header("Connection", "Upgrade")
                self.send_header("Sec-WebSocket-Accept", accept_key)
                self.end_headers()

                client = WSClientWrapper(self.rfile, self.wfile, self.connection)
                try:
                    while True:
                        opcode, payload = decode_ws_frame(self.rfile)
                        if opcode is None or opcode == 0x08: # close frame or eof
                            break
                        if opcode == 0x01: # text frame
                            room_manager.handle_message(client, payload)
                        elif opcode == 0x09: # ping frame
                            pong = struct.pack('!BB', 0x8A, 0)
                            with client.lock:
                                client.wfile.write(pong)
                                client.wfile.flush()
                except Exception as e:
                    pass
                finally:
                    room_manager.remove_client(client)
                return

        # 2. LAN IP Discovery Endpoint
        if self.path == '/api/lan-ip':
            ip_data = {
                "ip": get_local_ip(),
                "port": PORT,
                "url": f"http://{get_local_ip()}:{PORT}"
            }
            resp = json.dumps(ip_data).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 3. Default static file handler
        super().do_GET()

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
    # Use ThreadingTCPServer so persistent WebSocket connections don't block HTTP file requests
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    local_ip = get_local_ip()
    try:
        with socketserver.ThreadingTCPServer(("", PORT), GameServerHandler) as httpd:
            print(f"=====================================================")
            print(f"🎮 Mr. Oops!! 遊戲、設定與區網連線伺服器已啟動！")
            print(f"▶ 本機遊戲頁面:   http://localhost:{PORT}/index.html")
            print(f"🌐 區網連線網址:   http://{local_ip}:{PORT}/index.html")
            print(f"⚙️ 參數設定頁面:   http://localhost:{PORT}/settings.html")
            print(f"📡 雙人連線端點:   ws://{local_ip}:{PORT}/ws")
            print(f"=====================================================")
            print("提示：若另一台電腦要在同區網連線對戰，請在該電腦瀏覽器輸入：")
            print(f"      👉 http://{local_ip}:{PORT}/index.html")
            sys.stdout.flush()
            httpd.serve_forever()
    except OSError as e:
        print(f"無法綁定通訊埠 {PORT}: {e}")
        print("請嘗試更換通訊埠，例如: python3 server.py 8082")

if __name__ == '__main__':
    main()
