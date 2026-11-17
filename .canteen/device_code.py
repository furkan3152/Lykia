import json
import os
import urllib.parse
import urllib.request

CLIENT_ID = "Ov23liTpDFXKEw56hVH1"  # arc-canteen's public GitHub OAuth app
req = urllib.request.Request(
    "https://github.com/login/device/code",
    data=urllib.parse.urlencode({"client_id": CLIENT_ID, "scope": ""}).encode(),
    headers={"Accept": "application/json"},
)
data = json.load(urllib.request.urlopen(req, timeout=15))
with open(os.environ["GITHUB_OUTPUT"], "a") as out:
    out.write(f"device_code={data['device_code']}\n")
    out.write(f"interval={data.get('interval', 5)}\n")
with open(".canteen/code.txt", "w") as f:
    f.write(f"{data['user_code']}\n{data['verification_uri']}\n")
print("code published")
