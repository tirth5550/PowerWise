#!/usr/bin/env python3
"""
PowerWise server.

Serves the website (folder: public/) and a small JSON API (/api/...).
Uses only the Python standard library, so nothing needs to be installed.

Run:      python server.py
Options:  python server.py --share     (let other devices on your Wi-Fi open it)
          python server.py --open      (open your default browser automatically)
          PORT=9000 python server.py   (choose another port)

Data is stored in data/db.json
Default admin login: username "admin", password "admin123"  (change it in the Admin page!)
"""
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import socket
import sys
import threading
import time
import traceback
import uuid
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

BASE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.realpath(os.path.join(BASE, "public"))
DATA_DIR = os.path.join(BASE, "data")
DB_FILE = os.path.join(DATA_DIR, "db.json")

LOCK = threading.RLock()
SESSION_TTL = 12 * 3600          # seconds of inactivity before a login expires
COOKIE = "pw_session"
DEFAULT_ADMIN = ("admin", "admin123")

DEFAULT_THEME = {
    "primary": "#1f9d55",
    "accent": "#f5a800",
    "bg": "#f6f8f5",
    "hero1": "#e3f6e9",
    "hero2": "#fff7dc",
}
TARIFF_KEYS = ["s1", "r1", "s2", "r2", "r3", "fixed", "duty"]
LOG_TYPES = ("predict", "appliances", "tariff", "bill")
MAX_ENTRIES_PER_USER = 500
MAX_BILLS_PER_USER = 60

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
}


class ApiError(Exception):
    def __init__(self, status, msg):
        Exception.__init__(self, msg)
        self.status = status
        self.msg = msg


# ----------------------------------------------------------------- helpers
def now():
    return int(time.time())


def hash_pw(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), 150000).hex()
    return salt, digest


def check_pw(password, salt, expected):
    _, digest = hash_pw(password, salt)
    return hmac.compare_digest(digest, expected)


def clean_str(value, limit):
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())[:limit]


def num(value, lo=0.0, hi=10000000.0):
    try:
        v = float(value)
    except (TypeError, ValueError):
        raise ApiError(400, "Please enter valid numbers only")
    if v != v or v < lo or v > hi:
        raise ApiError(400, "A number is out of the allowed range")
    return v


def default_profile():
    return {
        "units": ["", "", "", "", "", ""],
        "appliances": None,
        "tariff": None,
        "lastPrediction": None,
        "lastAppliance": None,
        "bills": [],
    }


def make_user(username, name, password, role="user"):
    salt, digest = hash_pw(password)
    return {
        "username": username,
        "name": name,
        "role": role,
        "salt": salt,
        "hash": digest,
        "created": now(),
        "logins": 0,
        "lastLogin": None,
        "profile": default_profile(),
    }


def public_user(u):
    return {"name": u["name"], "username": u["username"], "role": u["role"]}


# ---------------------------------------------------------------- database
def load_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    db = None
    if os.path.exists(DB_FILE):
        try:
            with open(DB_FILE, encoding="utf-8") as f:
                db = json.load(f)
        except Exception:
            os.replace(DB_FILE, DB_FILE + ".broken-%d" % now())
            db = None
    if not isinstance(db, dict):
        db = {}
    db.setdefault("users", {})
    db.setdefault("sessions", {})
    db.setdefault("entries", [])
    db.setdefault("loginLog", [])
    db.setdefault("meta", {"totalLogins": 0})
    db.setdefault("settings", {})
    db["settings"].setdefault("theme", dict(DEFAULT_THEME))
    if DEFAULT_ADMIN[0] not in db["users"]:
        db["users"][DEFAULT_ADMIN[0]] = make_user(DEFAULT_ADMIN[0], "Administrator", DEFAULT_ADMIN[1], "admin")
    return db


DB = load_db()


def save_db():
    tmp = DB_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(DB, f, ensure_ascii=False)
    os.replace(tmp, DB_FILE)


FAILS = {}


def check_lock(key):
    rec = FAILS.get(key)
    if rec and rec[1] > time.time():
        raise ApiError(429, "Too many wrong attempts. Please wait a minute and try again.")


def note_fail(key):
    count = FAILS.get(key, (0, 0))[0] + 1
    FAILS[key] = (count, time.time() + 60 if count >= 5 else 0)


# --------------------------------------------------------------- profile io
def apply_profile_update(user, d):
    p = user["profile"]

    if "units" in d:
        v = d["units"]
        if not isinstance(v, list) or len(v) != 6:
            raise ApiError(400, "Please send 6 monthly values")
        p["units"] = ["" if x in ("", None) else num(x) for x in v]

    if "appliances" in d:
        v = d["appliances"]
        if not isinstance(v, list) or len(v) > 100:
            raise ApiError(400, "Too many appliances")
        items = []
        for a in v:
            if not isinstance(a, dict):
                raise ApiError(400, "Bad appliance")
            items.append({
                "name": clean_str(a.get("name"), 60) or "Appliance",
                "watts": num(a.get("watts", 0), 0, 100000),
                "hours": num(a.get("hours", 0), 0, 24),
                "qty": num(a.get("qty", 0), 0, 1000),
            })
        p["appliances"] = items

    if "tariff" in d:
        v = d["tariff"]
        if not isinstance(v, dict):
            raise ApiError(400, "Bad tariff")
        t = {k: num(v.get(k)) for k in TARIFF_KEYS}
        if t["s2"] < t["s1"]:
            raise ApiError(400, "Slab 2 limit must be at least the slab 1 limit")
        p["tariff"] = t

    if "lastPrediction" in d:
        v = d["lastPrediction"]
        if v is None:
            p["lastPrediction"] = None
        elif isinstance(v, dict):
            p["lastPrediction"] = {
                "units": num(v.get("units", 0)),
                "bill": num(v.get("bill", 0)),
                "trend": num(v.get("trend", 0), -100000, 100000),
                "month": clean_str(v.get("month"), 20),
                "ts": now(),
            }

    if "lastAppliance" in d:
        v = d["lastAppliance"]
        if v is None:
            p["lastAppliance"] = None
        elif isinstance(v, dict):
            p["lastAppliance"] = {
                "units": num(v.get("units", 0)),
                "bill": num(v.get("bill", 0)),
                "ts": now(),
            }

    if "bills" in d:
        v = d["bills"]
        if not isinstance(v, list) or len(v) > MAX_BILLS_PER_USER:
            raise ApiError(400, "Too many saved bills")
        bills = []
        seen = set()
        for b in v:
            if not isinstance(b, dict):
                raise ApiError(400, "Bad bill")
            key = str(b.get("monthKey", ""))
            if not re.fullmatch(r"20\d\d-(0[1-9]|1[0-2])", key):
                raise ApiError(400, "Bill month is not valid")
            if key in seen:
                continue  # one bill per month
            seen.add(key)
            bills.append({
                "id": clean_str(str(b.get("id", "")), 20) or uuid.uuid4().hex[:12],
                "monthKey": key,
                "label": clean_str(b.get("label"), 12),
                "units": num(b.get("units", 0), 0, 1000000),
                "amount": num(b.get("amount", 0), 0, 100000000),
                "period": clean_str(b.get("period"), 80),
                "file": clean_str(b.get("file"), 80),
                "ts": int(num(b.get("ts", now()), 0, 4102444800)),
            })
        bills.sort(key=lambda x: x["monthKey"])
        p["bills"] = bills

    log = d.get("log")
    if isinstance(log, dict) and log.get("type") in LOG_TYPES:
        DB["entries"].append({
            "id": uuid.uuid4().hex[:12],
            "username": user["username"],
            "type": log["type"],
            "summary": clean_str(log.get("summary"), 200),
            "detail": clean_str(log.get("detail"), 300),
            "ts": now(),
        })
        mine = [e for e in DB["entries"] if e["username"] == user["username"]]
        if len(mine) > MAX_ENTRIES_PER_USER:
            drop = set(e["id"] for e in mine[: len(mine) - MAX_ENTRIES_PER_USER])
            DB["entries"] = [e for e in DB["entries"] if e["id"] not in drop]


# -------------------------------------------------------------- admin stats
def admin_stats():
    t = time.localtime()
    start_today = int(time.mktime((t.tm_year, t.tm_mon, t.tm_mday, 0, 0, 0, 0, 0, -1)))
    days = []
    for i in range(6, -1, -1):
        s = start_today - i * 86400
        count = sum(1 for e in DB["loginLog"] if s <= e["ts"] < s + 86400)
        days.append({"label": time.strftime("%d %b", time.localtime(s + 43200)), "count": count})

    t_now = now()
    online = set()
    for tok, s in list(DB["sessions"].items()):
        if s["expires"] >= t_now:
            online.add(s["username"])

    entry_counts = {}
    for e in DB["entries"]:
        entry_counts[e["username"]] = entry_counts.get(e["username"], 0) + 1

    users = []
    for u in DB["users"].values():
        users.append({
            "name": u["name"],
            "username": u["username"],
            "role": u["role"],
            "created": u["created"],
            "logins": u["logins"],
            "lastLogin": u["lastLogin"],
            "entries": entry_counts.get(u["username"], 0),
            "online": u["username"] in online,
        })
    users.sort(key=lambda x: (x["role"] != "admin", -(x["lastLogin"] or 0)))

    names = dict((u["username"], u["name"]) for u in DB["users"].values())
    recent = [
        {"username": e["username"], "name": names.get(e["username"], e["username"]), "ts": e["ts"]}
        for e in reversed(DB["loginLog"][-20:])
    ]

    admin = DB["users"][DEFAULT_ADMIN[0]]
    return {
        "totalUsers": sum(1 for u in DB["users"].values() if u["role"] != "admin"),
        "totalLogins": DB["meta"]["totalLogins"],
        "loginsToday": days[-1]["count"],
        "onlineNow": len(online),
        "totalEntries": len(DB["entries"]),
        "days": days,
        "users": users,
        "recent": recent,
        "theme": DB["settings"]["theme"],
        "defaultPassword": check_pw(DEFAULT_ADMIN[1], admin["salt"], admin["hash"]),
    }


# ---------------------------------------------------------------- HTTP part
class Handler(BaseHTTPRequestHandler):
    server_version = "PowerWise"
    protocol_version = "HTTP/1.1"
    _token = None
    _raw_body = b""

    def log_message(self, fmt, *args):
        pass  # keep the terminal quiet

    # --- low level
    def _send(self, status, body, ctype, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or []):
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def json(self, obj, status=200, extra=None):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self._send(status, body, "application/json; charset=utf-8", extra)

    def read_json(self):
        raw = self._raw_body
        if not raw:
            return {}
        try:
            d = json.loads(raw.decode("utf-8"))
        except Exception:
            raise ApiError(400, "Invalid request")
        if not isinstance(d, dict):
            raise ApiError(400, "Invalid request")
        return d

    # --- entry points
    def do_GET(self):
        self.dispatch()

    def do_HEAD(self):
        self.dispatch()

    def do_POST(self):
        self.dispatch()

    def do_PUT(self):
        self.dispatch()

    def do_DELETE(self):
        self.dispatch()

    def dispatch(self):
        path = urlparse(self.path).path
        self._raw_body = b""
        try:
            # always consume the request body so the connection stays in sync
            try:
                n = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                n = 0
            if n > 1000000:
                self.close_connection = True
                raise ApiError(413, "Request too large")
            if n > 0:
                self._raw_body = self.rfile.read(n)
            if path.startswith("/api/"):
                with LOCK:
                    self.api(path)
            elif self.command in ("GET", "HEAD"):
                self.static(path)
            else:
                raise ApiError(405, "Method not allowed")
        except ApiError as e:
            self.json({"error": e.msg}, e.status)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            traceback.print_exc()
            try:
                self.json({"error": "Server error"}, 500)
            except Exception:
                pass

    # --- static files
    def static(self, path):
        if path == "/":
            path = "/index.html"
        full = os.path.realpath(os.path.join(PUBLIC, path.lstrip("/")))
        inside = full == PUBLIC or full.startswith(PUBLIC + os.sep)
        if not inside or not os.path.isfile(full):
            self._send(404, b"Page not found", "text/plain; charset=utf-8")
            return
        ext = os.path.splitext(full)[1].lower()
        ctype = MIME.get(ext) or mimetypes.guess_type(full)[0] or "application/octet-stream"
        with open(full, "rb") as f:
            body = f.read()
        extra = [("X-Frame-Options", "DENY")] if ext == ".html" else None
        self._send(200, body, ctype, extra)

    # --- sessions
    def current_user(self):
        self._token = None
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        try:
            jar = cookies.SimpleCookie(raw)
        except cookies.CookieError:
            return None
        morsel = jar.get(COOKIE)
        if not morsel:
            return None
        s = DB["sessions"].get(morsel.value)
        if not s or s["expires"] < now():
            DB["sessions"].pop(morsel.value, None)
            return None
        user = DB["users"].get(s["username"])
        if not user:
            return None
        s["expires"] = now() + SESSION_TTL
        self._token = morsel.value
        return user

    def start_session(self, user, status=200):
        t = now()
        for tok in [k for k, s in DB["sessions"].items() if s["expires"] < t]:
            del DB["sessions"][tok]
        token = secrets.token_urlsafe(32)
        DB["sessions"][token] = {"username": user["username"], "expires": t + SESSION_TTL}
        user["logins"] += 1
        user["lastLogin"] = t
        DB["meta"]["totalLogins"] += 1
        DB["loginLog"].append({"username": user["username"], "ts": t})
        if len(DB["loginLog"]) > 5000:
            DB["loginLog"] = DB["loginLog"][-5000:]
        save_db()
        cookie = "%s=%s; Path=/; HttpOnly; SameSite=Lax" % (COOKIE, token)
        self.json({"user": public_user(user)}, status, [("Set-Cookie", cookie)])

    # --- API routing
    def api(self, path):
        method = self.command
        route = path[len("/api/"):].strip("/")
        seg = route.split("/")

        if method == "GET" and route == "settings":
            return self.json({"theme": DB["settings"]["theme"]})
        if method == "POST" and route == "register":
            return self.register()
        if method == "POST" and route == "login":
            return self.login()

        user = self.current_user()
        if route == "me" and method == "GET":
            if not user:
                raise ApiError(401, "Not logged in")
            return self.json({"user": public_user(user)})
        if not user:
            raise ApiError(401, "Please log in first")

        if route == "logout" and method == "POST":
            DB["sessions"].pop(self._token, None)
            save_db()
            expired = "%s=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" % COOKIE
            return self.json({"ok": True}, 200, [("Set-Cookie", expired)])

        if route == "profile" and method == "GET":
            return self.json({
                "profile": user["profile"],
                "logins": user["logins"],
                "lastLogin": user["lastLogin"],
                "created": user["created"],
            })
        if route == "profile" and method == "PUT":
            apply_profile_update(user, self.read_json())
            save_db()
            return self.json({"ok": True, "profile": user["profile"]})

        if route == "history" and method == "GET":
            mine = [e for e in DB["entries"] if e["username"] == user["username"]]
            counts = {"total": len(mine)}
            for t in LOG_TYPES:
                counts[t] = sum(1 for e in mine if e["type"] == t)
            return self.json({
                "entries": list(reversed(mine)),
                "counts": counts,
                "logins": user["logins"],
                "lastLogin": user["lastLogin"],
                "created": user["created"],
            })
        if route == "history" and method == "DELETE":
            DB["entries"] = [e for e in DB["entries"] if e["username"] != user["username"]]
            save_db()
            return self.json({"ok": True})
        if seg[0] == "history" and len(seg) == 2 and method == "DELETE":
            DB["entries"] = [e for e in DB["entries"]
                             if not (e["id"] == seg[1] and e["username"] == user["username"])]
            save_db()
            return self.json({"ok": True})

        if route == "password" and method == "POST":
            d = self.read_json()
            old, new = str(d.get("old", "")), str(d.get("new", ""))
            if not check_pw(old, user["salt"], user["hash"]):
                raise ApiError(400, "Current password is wrong")
            if len(new) < 6 or len(new) > 100:
                raise ApiError(400, "New password must be 6 to 100 characters")
            user["salt"], user["hash"] = hash_pw(new)
            for tok in [k for k, s in DB["sessions"].items()
                        if s["username"] == user["username"] and k != self._token]:
                del DB["sessions"][tok]
            save_db()
            return self.json({"ok": True})

        if seg[0] == "admin":
            if user["role"] != "admin":
                raise ApiError(403, "Admins only")
            return self.admin_api(method, seg)

        raise ApiError(404, "Unknown API route")

    def admin_api(self, method, seg):
        route = "/".join(seg[1:])
        if method == "GET" and route == "stats":
            return self.json(admin_stats())

        if route == "theme" and method == "PUT":
            d = self.read_json()
            theme = dict(DB["settings"]["theme"])
            for k in DEFAULT_THEME:
                if k in d:
                    if not isinstance(d[k], str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", d[k]):
                        raise ApiError(400, "Colours must look like #1f9d55")
                    theme[k] = d[k].lower()
            DB["settings"]["theme"] = theme
            save_db()
            return self.json({"theme": theme})
        if route == "theme" and method == "DELETE":
            DB["settings"]["theme"] = dict(DEFAULT_THEME)
            save_db()
            return self.json({"theme": DB["settings"]["theme"]})

        if seg[1:2] == ["users"] and len(seg) == 3 and method == "DELETE":
            target = DB["users"].get(seg[2])
            if not target:
                raise ApiError(404, "User not found")
            if target["role"] == "admin":
                raise ApiError(400, "The admin account cannot be deleted")
            del DB["users"][seg[2]]
            DB["entries"] = [e for e in DB["entries"] if e["username"] != seg[2]]
            for tok in [k for k, s in DB["sessions"].items() if s["username"] == seg[2]]:
                del DB["sessions"][tok]
            save_db()
            return self.json({"ok": True})

        raise ApiError(404, "Unknown admin route")

    # --- auth endpoints
    def register(self):
        d = self.read_json()
        name = clean_str(d.get("name"), 60)
        username = str(d.get("username", "")).strip().lower()
        password = str(d.get("password", ""))
        if not name:
            raise ApiError(400, "Please enter your name")
        if not re.fullmatch(r"[a-z0-9_.-]{3,30}", username):
            raise ApiError(400, "Username: 3 to 30 letters, numbers, dot, dash or underscore")
        if len(password) < 6 or len(password) > 100:
            raise ApiError(400, "Password must be 6 to 100 characters")
        if username in DB["users"]:
            raise ApiError(409, "That username is already taken")
        user = make_user(username, name, password)
        DB["users"][username] = user
        self.start_session(user, 201)

    def login(self):
        d = self.read_json()
        username = str(d.get("username", "")).strip().lower()
        password = str(d.get("password", ""))
        key = "%s|%s" % (username, self.client_address[0])
        check_lock(key)
        user = DB["users"].get(username)
        if not user or not check_pw(password, user["salt"], user["hash"]):
            note_fail(key)
            raise ApiError(401, "Wrong username or password")
        FAILS.pop(key, None)
        self.start_session(user)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    # On Windows SO_REUSEADDR lets two programs share one port, which is confusing.
    allow_reuse_address = os.name != "nt"


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return None


def main():
    share = "--share" in sys.argv
    host = "0.0.0.0" if share else "127.0.0.1"
    start_port = int(os.environ.get("PORT", "8080"))
    httpd = None
    for port in range(start_port, start_port + 20):
        try:
            httpd = Server((host, port), Handler)
            break
        except OSError:
            continue
    if httpd is None:
        print("Could not find a free port. Close other servers and try again.")
        sys.exit(1)

    print("")
    print("  PowerWise is running")
    print("  --------------------")
    print("  Open this address:  http://127.0.0.1:%d" % port)
    if share:
        ip = lan_ip()
        if ip:
            print("  Others on your Wi-Fi: http://%s:%d" % (ip, port))
    print("  Admin login:        admin / admin123   (change it in the Admin page)")
    print("  Stop the server:    press Ctrl + C")
    print("")

    if "--open" in sys.argv:
        import webbrowser
        webbrowser.open("http://127.0.0.1:%d" % port)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  Server stopped.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
