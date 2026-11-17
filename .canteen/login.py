"""Finish arc-canteen's GitHub device login on this runner and set up the profile."""
import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path

home = Path.home() / ".arc-canteen"
home.mkdir(mode=0o700, exist_ok=True)
(home / "settings.yaml").write_text("chain: mainnet\nevent_name: tameion\n")

from arc_canteen import auth, config  # noqa: E402
from arc_canteen import push as _push  # noqa: E402

CLIENT_ID = "Ov23liTpDFXKEw56hVH1"
device_code = os.environ["DEVICE_CODE"]
interval = int(os.environ.get("INTERVAL") or 5)
deadline = time.time() + 15 * 60
token = None
while time.time() < deadline and token is None:
    time.sleep(interval)
    req = urllib.request.Request(
        "https://github.com/login/oauth/access_token",
        data=urllib.parse.urlencode({
            "client_id": CLIENT_ID,
            "device_code": device_code,
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
        }).encode(),
        headers={"Accept": "application/json"},
    )
    result = json.load(urllib.request.urlopen(req, timeout=15))
    if "access_token" in result:
        token = result["access_token"]
    elif result.get("error") == "slow_down":
        interval += 5
    elif result.get("error") != "authorization_pending":
        raise SystemExit(f"device login failed: {result.get('error')}")
if token is None:
    raise SystemExit("device login timed out")

user = auth.get_github_user(token)
cfg = config.load()
cfg.setdefault("auth", {})
cfg["auth"].update({"github_token": token, "github_handle": user["login"], "github_name": user.get("name") or user["login"]})
config.save(cfg)
Path(".canteen/handle.txt").write_text(user["login"])

_push.ping()
if not _push.cli_login(token):
    raise SystemExit("Canteen server did not accept the login")
_push.push_event("login", {"github_username": user["login"]})
config.set_val("profile.discord", "Akdoganos")
config.set_val("profile.telegram", "@AkdoganCoin")
config.set_val("profile.luma_email", "furkan@lykiaai.com")
_push.push_event("profile_edit", {
    "discord": "Akdoganos",
    "telegram": "@AkdoganCoin",
    "luma_email": "furkan@lykiaai.com",
    "wallet_address": None,
})
print(f"logged in as {user['login']}")
