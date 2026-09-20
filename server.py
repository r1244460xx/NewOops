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
import io

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

PORT = 8081
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "").strip()

# CLI Argument parsing: python server.py [port] [--password <pwd>]
if len(sys.argv) > 1:
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        arg = args[i]
        if arg in ("--password", "-p") and i + 1 < len(args):
            ADMIN_PASSWORD = args[i + 1].strip()
            i += 2
        elif not arg.startswith("-"):
            try:
                PORT = int(arg)
            except ValueError:
                pass
            i += 1
        else:
            i += 1

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

    def send_raw_text(self, text):
        frame = encode_ws_frame(text)
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

    def join_room(self, room_code, role, client, mode="versus"):
        with self.lock:
            if room_code not in self.rooms:
                self.rooms[room_code] = {"host": None, "clients": [], "client": None, "mode": mode}
            room = self.rooms[room_code]
            if "clients" not in room:
                room["clients"] = []

            if role == "host":
                room["host"] = client
                room["mode"] = mode
                client.room_code = room_code
                client.role = "host"
                client.client_id = "host"
                client.player_index = 0
                client.send_json({
                    "type": "joined",
                    "role": "host",
                    "room": room_code,
                    "mode": room.get("mode", mode),
                    "clients": [getattr(c, "client_id", "") for c in room["clients"] if c],
                    "opponent_present": len(room["clients"]) > 0
                })
                for c in room["clients"]:
                    if c:
                        c.send_json({"type": "host_ready", "role": "host"})
                print(f"[WebSocket] Host joined room '{room_code}' (mode: {mode})")
            else:
                room_mode = room.get("mode", mode)
                if room_mode == "versus4p":
                    max_clients = 3
                elif room_mode == "versus3p":
                    max_clients = 2
                else:
                    max_clients = 1
                occupied_slots = {getattr(c, "player_index", None) for c in room["clients"] if c}
                assigned_slot = None
                for s in range(1, max_clients + 1):
                    if s not in occupied_slots:
                        assigned_slot = s
                        break

                if assigned_slot is None:
                    client.send_json({"type": "error", "message": "房間已滿，無法加入！"})
                    print(f"[WebSocket] Room '{room_code}' is full. Rejected client.")
                    return

                client_id = f"client_{assigned_slot}_{id(client) % 10000}"
                client.room_code = room_code
                client.role = "client"
                client.client_id = client_id
                client.player_index = assigned_slot
                room["clients"].append(client)
                room["client"] = room["clients"][0] if room["clients"] else None

                client.send_json({
                    "type": "joined",
                    "role": "client",
                    "room": room_code,
                    "clientId": client_id,
                    "playerIndex": assigned_slot,
                    "mode": room.get("mode", mode),
                    "host_present": room.get("host") is not None
                })
                if room.get("host"):
                    room["host"].send_json({
                        "type": "opponent_joined",
                        "role": "client",
                        "clientId": client_id,
                        "playerIndex": assigned_slot,
                        "totalClients": len([c for c in room["clients"] if c])
                    })
                print(f"[WebSocket] Client (P{assigned_slot + 1}) joined room '{room_code}' id={client_id}")

    def handle_message(self, client, data_str):
        is_ping = '"type":"ping"' in data_str or '"type": "ping"' in data_str
        is_join = '"join"' in data_str

        # Targeted WebRTC signaling messages (with targetClientId)
        if getattr(client, "room_code", None) and not is_join and not is_ping:
            if '"targetClientId"' in data_str:
                try:
                    msg = json.loads(data_str)
                    target_id = msg.get("targetClientId")
                    with self.lock:
                        room = self.rooms.get(client.room_code)
                        if room:
                            if target_id == "host" and room.get("host"):
                                msg["fromClientId"] = getattr(client, "client_id", "client")
                                room["host"].send_json(msg)
                                return
                            else:
                                for c in room.get("clients", []):
                                    if c and getattr(c, "client_id", None) == target_id:
                                        msg["fromClientId"] = getattr(client, "client_id", "host")
                                        c.send_json(msg)
                                        return
                except Exception:
                    pass

            # Fast relay for gameplay states and inputs
            with self.lock:
                room = self.rooms.get(client.room_code)
                if room:
                    if client.role == "client" and room.get("host"):
                        room["host"].send_raw_text(data_str)
                        return
                    elif client.role == "host":
                        for c in room.get("clients", []):
                            if c:
                                c.send_raw_text(data_str)
                        return

        try:
            msg = json.loads(data_str)
        except Exception:
            return

        msg_type = msg.get("action") or msg.get("type")
        if msg_type == "join":
            room_code = str(msg.get("room", "1234")).strip()
            role = msg.get("role", "host")
            mode = msg.get("mode", "versus")
            self.join_room(room_code, role, client, mode)
        elif msg_type == "ping":
            pong_msg = {"type": "pong"}
            if "t" in msg:
                pong_msg["t"] = msg["t"]
            client.send_json(pong_msg)
        else:
            with self.lock:
                room = self.rooms.get(getattr(client, "room_code", None))
                if room:
                    if client.role == "client" and room.get("host"):
                        room["host"].send_raw_text(data_str)
                    elif client.role == "host":
                        for c in room.get("clients", []):
                            if c:
                                c.send_raw_text(data_str)

    def remove_client(self, client):
        with self.lock:
            room_code = getattr(client, "room_code", None)
            if not room_code or room_code not in self.rooms:
                return
            room = self.rooms[room_code]
            if client.role == "host" and room.get("host") == client:
                room["host"] = None
                for c in room.get("clients", []):
                    if c:
                        c.send_json({"type": "opponent_left", "role": "host"})
                print(f"[WebSocket] Host left room '{room_code}'")
            elif client.role == "client":
                if client in room.get("clients", []):
                    room["clients"].remove(client)
                room["client"] = room["clients"][0] if room.get("clients") else None
                left_msg = {
                    "type": "opponent_left",
                    "role": "client",
                    "clientId": getattr(client, "client_id", "client"),
                    "playerIndex": getattr(client, "player_index", 1),
                    "totalClients": len(room["clients"])
                }
                if room.get("host"):
                    room["host"].send_json(left_msg)
                for other_c in room.get("clients", []):
                    if other_c:
                        other_c.send_json(left_msg)
                print(f"[WebSocket] Client ({getattr(client, 'client_id', 'P2')}) left room '{room_code}'")

            if not room.get("host") and not room.get("clients"):
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

                # Enable TCP_NODELAY to eliminate Nagle buffering for ultra-low latency LAN relay
                try:
                    self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                except Exception:
                    pass

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
                    print(f"[WebSocket Loop Error]: {e}", flush=True)
                finally:
                    room_manager.remove_client(client)
                return

        # 2. Ping Health/Latency Endpoint
        if self.path.startswith('/api/ping'):
            resp = b'{"pong":true}'
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 3. LAN IP Discovery Endpoint
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

        # 4. Admin Auth Status Endpoint
        if self.path == '/api/auth-status':
            req_pwd = self.headers.get('X-Admin-Password', '').strip()
            auth_data = {
                "protected": bool(ADMIN_PASSWORD),
                "authenticated": (not ADMIN_PASSWORD) or (req_pwd == ADMIN_PASSWORD)
            }
            resp = json.dumps(auth_data).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 5. Default static file handler
        super().do_GET()

    def do_POST(self):
        if self.path == '/api/config' or self.path == '/save_config':
            # Check Admin Password if configured
            if ADMIN_PASSWORD:
                client_pwd = self.headers.get('X-Admin-Password', '').strip()
                if client_pwd != ADMIN_PASSWORD:
                    print(f"[Mr. Oops Server] ⛔ Unauthorized save attempt! Incorrect or missing admin password.")
                    err_resp = json.dumps({
                        "status": "unauthorized",
                        "message": "管理員密碼錯誤或未提供！無法儲存設定至硬碟。"
                    }, ensure_ascii=False).encode('utf-8')
                    self.send_response(403)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.send_header('Content-Length', str(len(err_resp)))
                    self.end_headers()
                    self.wfile.write(err_resp)
                    return

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
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password')
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
