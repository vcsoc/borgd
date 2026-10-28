#!/usr/bin/env python3
"""Real Linux AppImage/WebKit smoke test; no IPC or shell mocks.

Requires WebKitWebDriver and tauri-driver. Uses a disposable HOME/config and
never accesses a user's configured repositories. Run with --application PATH.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import base64
import json
import os
from pathlib import Path
import subprocess
import socket
import tempfile
import time
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--application", required=True)
    parser.add_argument("--driver", default="tauri-driver")
    parser.add_argument("--port", type=int, default=4445)
    args = parser.parse_args()
    base = f"http://127.0.0.1:{args.port}"
    expected_version = subprocess.check_output(["borg", "--version"], text=True).strip()

    def request(method, path, payload=None):
        body = None if payload is None else json.dumps(payload).encode()
        req = urllib.request.Request(base + path, data=body, method=method, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=45) as response:
                result = json.load(response).get("value")
        except urllib.error.HTTPError as error:
            raise RuntimeError(error.read().decode()) from error
        if isinstance(result, dict) and "error" in result:
            raise RuntimeError(result)
        return result

    def until(check, seconds=20):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            value = check()
            if value:
                return value
            time.sleep(0.1)
        raise AssertionError("Timed out waiting for native application state")

    with tempfile.TemporaryDirectory(prefix="borgd-native-") as temp:
        home = Path(temp) / "home"
        home.mkdir()
        runtime = Path(temp) / "runtime"
        runtime.mkdir(mode=0o700)
        env = {**os.environ, "XDG_RUNTIME_DIR": str(runtime), "HOME": str(home), "XDG_CONFIG_HOME": str(Path(temp) / "config"), "XDG_DATA_HOME": str(Path(temp) / "data"), "XDG_CACHE_HOME": str(Path(temp) / "cache"), "XDG_STATE_HOME": str(Path(temp) / "state"), "SHELL": "/bin/bash"}
        log_path = Path("test-results/native-driver.log")
        log_path.parent.mkdir(exist_ok=True)
        with log_path.open("w") as log:
            driver = subprocess.Popen([args.driver, "--port", str(args.port), "--native-port", str(args.port + 1)], env=env, stdout=log, stderr=log)
            worker_directory = Path(temp) / "config/com.borgd.desktop"
            worker = subprocess.Popen([str(Path(args.application).resolve()), "--worker", "--config-dir", str(worker_directory)], env=env, stdout=log, stderr=log)
            def worker_rpc(method, arguments=None):
                with socket.socket(socket.AF_UNIX) as connection:
                    connection.settimeout(30)
                    connection.connect(str(worker_directory / "worker/runtime.sock"))
                    connection.sendall(json.dumps({"method": method, "args": arguments or {}}).encode() + b"\n")
                    data = b""
                    while not data.endswith(b"\n"):
                        chunk = connection.recv(65536)
                        if not chunk: raise RuntimeError("Worker disconnected")
                        data += chunk
                result = json.loads(data)
                if "error" in result: raise RuntimeError(result["error"])
                return result["result"]
            session = None
            try:
                until(lambda: (worker_directory / "worker/runtime.sock").exists())
                assert worker_rpc("worker_info")["running"]
                def ready():
                    try:
                        return request("GET", "/status")
                    except (OSError, RuntimeError):
                        return None
                until(ready)
                created = request("POST", "/session", {"capabilities": {"alwaysMatch": {"tauri:options": {"application": str(Path(args.application).resolve())}}}})
                session = created["sessionId"]
                root = f"/session/{session}"

                def js(script, arguments=None):
                    return request("POST", root + "/execute/sync", {"script": script, "args": arguments or []})

                def invoke(command, arguments=None):
                    return request("POST", root + "/execute/async", {"script": "const done=arguments[arguments.length-1]; window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(done,e=>done({error:String(e)}));", "args": [command, arguments or {}]})

                until(lambda: js("return document.querySelector('.engine-status')?.textContent.includes(arguments[0])", [expected_version]))
                assert invoke("probe") == expected_version
                assert invoke("get_status")["workerRunning"] is True
                print(f"PASS: packaged AppImage detects system {expected_version}")
                plan = invoke("get_install_plan")
                invoke("dismiss_install_plan", {"planId": plan["id"]})
                try:
                    invoke("install_borg", {"planId": plan["id"]})
                    raise AssertionError("Dismissed installer approval must never execute packages")
                except RuntimeError as error:
                    assert "fresh installation plan" in str(error)
                print("PASS: native installer plan can be inspected and cancelled; dismissed approval cannot run a package installer")
                until(lambda: js("return document.querySelector('.page-heading h1')?.textContent === 'Repositories' && !!document.querySelector('.empty')"))
                invoke("save_config", {"config": {"repositories": [{"id": "native-test", "name": "Disposable", "location": str(Path(temp) / "repo")}], "profiles": []}})
                try:
                    invoke("run_operation", {"request": {"action": "info", "repositoryId": "native-test"}})
                    raise AssertionError("Inspecting a nonexistent disposable repository should fail")
                except RuntimeError as error:
                    assert "does not exist" in str(error)
                entry = invoke("get_status")["history"][0]
                assert entry["detailsAvailable"]
                details = invoke("get_history_details", {"id": entry["id"]})
                assert details["repository"]["name"] == "Disposable"
                assert "does not exist" in details["log"]
                assert details["processExitCode"] == 2
                invoke("save_config", {"config": {"repositories": [], "profiles": []}})
                assert invoke("get_config")["onboardingComplete"] is True
                request("POST", root + "/refresh", {})
                until(lambda: js("return document.querySelector('.engine-status')?.textContent.includes(arguments[0])", [expected_version]))
                assert js("return !document.querySelector('.welcome') && !document.querySelector('.notice')")
                print("PASS: completed setup stays completed across reload and connection removal")
                assert invoke("get_history_details", {"id": entry["id"]})["repository"]["name"] == "Disposable"
                js("document.querySelector('[data-route=\"activity\"]').click()")
                until(lambda: js("return !!document.querySelector('[data-action=\"copy-log\"]') && !!document.querySelector('[data-action=\"copy-history\"]')"))
                assert js("return getComputedStyle(document.querySelector('.activity-content')).overflowY === 'hidden'")
                # Verify read access is denied without inspecting or overwriting the user's clipboard.
                try:
                    invoke("plugin:clipboard-manager|read_text")
                    raise AssertionError("Clipboard read access should not be granted")
                except RuntimeError as error:
                    assert "not allowed" in str(error).lower() or "denied" in str(error).lower()
                screenshot = request("GET", root + "/screenshot")
                Path("test-results/native-activity.png").write_bytes(base64.b64decode(screenshot))
                print("PASS: real failed operation diagnostics remain available after reload and forgetting its connection")
                print("PASS: native Activity displays copy controls; clipboard read permission stays denied")

                old_repo = Path(temp) / "old repo"
                new_repo = Path(temp) / "new repo"
                def relocation_config(path):
                    return {"repositories": [{"id": "relocation-native", "name": "Relocation test", "location": str(path)}], "profiles": []}
                invoke("save_config", {"config": relocation_config(old_repo)})
                invoke("run_operation", {"request": {"action": "init", "repositoryId": "relocation-native", "encrypted": False}})
                invoke("run_operation", {"request": {"action": "info", "repositoryId": "relocation-native"}})
                old_repo.rename(new_repo)
                invoke("save_config", {"config": relocation_config(new_repo)})
                request("POST", root + "/refresh", {})
                until(lambda: js("return document.querySelector('.engine-status')?.textContent.includes(arguments[0])", [expected_version]))
                js("document.querySelector('[data-route=\"repositories\"]').click(); document.querySelector('[data-action=\"info\"]').click()")
                until(lambda: js("return !!document.querySelector('.relocation-dialog[open]')"))
                challenge = invoke("get_status")["relocation"]
                assert challenge["paths"] == {"oldPath": str(old_repo), "newPath": str(new_repo)}
                assert invoke("get_status")["busy"] is False
                Path("test-results/native-relocation.png").write_bytes(base64.b64decode(request("GET", root + "/screenshot")))
                js("document.querySelector('.relocation-dialog button[type=submit]').click()")
                until(lambda: js("return !document.querySelector('.relocation-dialog') && [...document.querySelectorAll('.repo-details strong')].some(node => node.textContent === 'none')"))
                entry = invoke("get_status")["history"][0]
                assert entry["exitCode"] == 0
                details = invoke("get_history_details", {"id": entry["id"]})
                assert details["relocationConfirmation"] == challenge["paths"]
                try:
                    invoke("confirm_relocation", {"token": challenge["token"]})
                    raise AssertionError("Relocation approval must not be reusable")
                except RuntimeError as error:
                    assert "no longer available" in str(error)
                print("PASS: real moved repository prompts before retry, explicit approval succeeds, and its token cannot be reused")
                js("document.querySelector('[data-action=\"check\"]').click()")
                until(lambda: js("return !!document.querySelector('dialog[open] button[type=submit]')"))
                js("document.querySelector('dialog[open] button[type=submit]').click()")
                until(lambda: js("return !document.querySelector('dialog[open]') && document.querySelector('#check-progress')?.textContent.includes('Integrity check completed')"))
                assert js("return document.querySelector('#check-progress progress').value === 100")
                assert invoke("get_status")["history"][0]["action"] == "check"
                Path("test-results/native-check-progress.png").write_bytes(base64.b64decode(request("GET", root + "/screenshot")))
                print("PASS: integrity check closes its confirmation and reports real Borg completion in the main Activity window")

                source = Path(temp) / "source" / "Documents"
                source.mkdir(parents=True)
                (source / "native-file.txt").write_text("Native archive browser test\n")
                (source / "not-selected.txt").write_text("This must not be extracted")
                cfg = relocation_config(new_repo)
                cfg["profiles"] = [{"id": "native-profile", "name": "Native files", "repositoryId": "relocation-native", "sources": [str(source)], "excludes": [], "keepDaily": 7, "keepWeekly": 4, "keepMonthly": 6, "intervalHours": 0}]
                invoke("save_config", {"config": cfg})
                invoke("run_operation", {"request": {"action": "backup", "repositoryId": "relocation-native", "profileId": "native-profile"}})
                archive_record = invoke("run_operation", {"request": {"action": "archives", "repositoryId": "relocation-native"}})["data"]["archives"][0]
                archive = archive_record["name"]
                assert archive_record["stats"]["nfiles"] == 2
                assert archive_record["stats"]["original_size"] > 0
                listing = invoke("run_operation", {"request": {"action": "files", "repositoryId": "relocation-native", "archive": archive}})["data"]
                stored_path = next(item["path"] for item in listing if item["path"].endswith("native-file.txt"))
                (source / "not-selected.txt").write_text("A changed sibling for the read-only archive diff test")
                invoke("run_operation", {"request": {"action": "backup", "repositoryId": "relocation-native", "profileId": "native-profile"}})

                request("POST", root + "/refresh", {})
                until(lambda: js("return document.querySelector('.engine-status')?.textContent.includes(arguments[0])", [expected_version]))
                encrypted_repo = Path(temp) / "inline-encrypted"
                test_passphrase = "disposable-native-inline-secret"
                borg_env = {key: value for key, value in env.items() if not key.startswith("BORG_")}
                borg_env["BORG_PASSPHRASE"] = test_passphrase
                subprocess.run(["borg", "init", "--encryption=repokey", str(encrypted_repo)], env=borg_env, check=True, capture_output=True)
                cfg["repositories"].append({"id": "inline-encrypted", "name": "Inline encrypted", "location": str(encrypted_repo)})
                invoke("save_config", {"config": cfg})
                request("POST", root + "/refresh", {})
                until(lambda: js("return document.querySelector('.engine-status')?.textContent.includes(arguments[0])", [expected_version]))
                js("document.querySelector('[data-route=\"repositories\"]').click(); document.querySelector('[data-action=\"unlock\"][data-id=\"inline-encrypted\"]').click()")
                until(lambda: js("return !!document.querySelector('.inline-unlock input[type=password]') && !document.querySelector('dialog[open]')"))
                field = request("POST", root + "/element", {"using": "css selector", "value": ".inline-unlock input[type=password]"})
                request("POST", root + f"/element/{field['element-6066-11e4-a52e-4f735466cecf']}/value", {"text": test_passphrase})
                Path("test-results/native-inline-unlock.png").write_bytes(base64.b64decode(request("GET", root + "/screenshot")))
                js("document.querySelector('.inline-unlock').requestSubmit()")
                until(lambda: js("return !document.querySelector('.inline-unlock') && !!document.querySelector('[data-action=\"lock-repository\"][data-id=\"inline-encrypted\"]')"))
                js("document.querySelector('[data-action=\"info\"][data-id=\"inline-encrypted\"]').click()")
                until(lambda: js("return [...document.querySelectorAll('.repo-card')].some(row => row.textContent.includes('Inline encrypted') && row.textContent.includes('repokey'))"))
                assert invoke("get_status")["history"][0]["exitCode"] == 0
                assert test_passphrase not in json.dumps(invoke("get_config"))
                assert test_passphrase not in js("return JSON.stringify({...localStorage,...sessionStorage})")
                assert js("const row=document.querySelector('.repo-card[data-repository=\"inline-encrypted\"]'); const first=row.querySelector('.repo-actions > button'); return first.dataset.lockState==='unlocked' && !!first.querySelector('svg.lucide-lock-open') && !!row.querySelector('.repository-lock-state.is-unlocked svg.lucide-lock-open')")
                print("PASS: native inline password field unlocks a real encrypted Borg repository; Inspect verifies access without a modal or persisted passphrase")
                js("document.querySelector('[data-action=\"info\"][data-id=\"relocation-native\"]').click()")
                until(lambda: js("return [...document.querySelectorAll('.repo-card')].some(row => row.textContent.includes('Relocation test') && [...row.querySelectorAll('.repo-details strong')].some(node => node.textContent === 'none'))"))
                assert js("return [...document.querySelectorAll('.repo-card')].every(row => getComputedStyle(row).backgroundColor === 'rgba(0, 0, 0, 0)')")
                js("document.querySelector('[data-route=\"repositories\"]').click(); document.querySelector('[data-panel=\"overview\"][data-id=\"relocation-native\"]').click()")
                assert js("return !!document.querySelector('.trend-chart') && document.querySelectorAll('.heatmap > .heat-cell').length === 84 && document.querySelectorAll('.donut-chart').length === 2")
                js("document.querySelector('.content').scrollTop=0")
                until(lambda: js("return getComputedStyle(document.querySelector('.repository-panel')).opacity === '1'"))
                Path("test-results/native-flat-overview.png").write_bytes(base64.b64decode(request("GET", root + "/screenshot")))
                print("PASS: native flat overview charts use real backup history and inspected storage, with an 84-day heatmap and no repository cards")
                js("document.querySelector('[data-route=\"repositories\"]').click(); document.querySelector('[data-panel=\"archives\"][data-id=\"relocation-native\"]').click()")
                until(lambda: js("return !!document.querySelector('[data-action=\"files\"]:not(:disabled)')"))
                assert js("return document.querySelector('th[aria-sort=descending] button').dataset.column === 'time'")
                assert js("return document.querySelector('tbody tr').children[2].textContent.trim() === '2'")
                Path("test-results/native-archive-statistics.png").write_bytes(base64.b64decode(request("GET", root + "/screenshot")))
                print("PASS: native archive panel automatically loads on opening, defaults to date descending, and displays real Borg counts and sizes")
                js("document.querySelector('.archive-table tbody tr[data-archive-row]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:400,clientY:420}))")
                until(lambda: js("return !!document.querySelector('[role=menu][aria-label=\"Archive actions\"]')"))
                js("[...document.querySelectorAll('[role=menuitem]')].find(item => item.textContent === 'View diff').click()")
                try:
                    until(lambda: js("return !!document.querySelector('.archive-diff') && !document.querySelector('.archive-diff .repository-error') && (!!document.querySelector('.archive-diff-table') || document.querySelector('.archive-diff').textContent.includes('No differences found between these archives.'))"))
                except AssertionError:
                    Path("test-results/native-diff-failure.txt").write_text(js("return document.querySelector('.content').textContent"))
                    raise
                assert worker_rpc("get_status")["history"][0]["action"] == "diff"
                Path("test-results/native-archive-diff.png").write_bytes(base64.b64decode(request("GET", root + "/screenshot")))
                js("const row=[...document.querySelectorAll('.archive-diff-table tbody tr')].find(row=>row.textContent.includes('not-selected.txt')); row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:400,clientY:350}))")
                js("[...document.querySelectorAll('[role=menuitem]')].find(item=>item.textContent === 'Go to').click()")
                until(lambda: js("return document.querySelector('.archive-content-pane tr[aria-selected=true]')?.dataset.entry.endsWith('not-selected.txt') && !!document.querySelector('[data-restore-selection]')"))
                Path("test-results/native-diff-go-to.png").write_bytes(base64.b64decode(request("GET", root + "/screenshot")))
                assert worker_rpc("get_status")["history"][0]["action"] == "files"
                js("document.querySelector('[data-action=\"archive-back\"]').click()")
                until(lambda: js("return !!document.querySelector('.repo-header .repo-actions') && !!document.querySelector('.quick-profile-list') && !!document.querySelector('[data-action=\"files\"]')"))
                print("PASS: native right-click archive comparison runs real read-only Borg diff and returns to redesigned repository headers and quick profiles")

                js("document.querySelector('[data-action=\"files\"]').click()")
                until(lambda: js("return !!document.querySelector('[aria-label=\"Archive folder tree\"]') && !document.querySelector('dialog[open]')"))
                parts = [part for part in stored_path.split("/") if part and part != "."]
                for i in range(1, len(parts)):
                    folder = "/".join(parts[:i])
                    assert js("const button=[...document.querySelectorAll('.archive-content-pane button[data-folder]')].find(b=>b.dataset.folder===arguments[0]); if(!button)return false; button.click(); return true;", [folder])
                assert js("return document.querySelector('.archive-content-pane').textContent.includes('native-file.txt')")
                assert js("return !document.querySelector('#toast').classList.contains('bad')")
                Path("test-results/native-archive-browser.png").write_bytes(base64.b64decode(request("GET", root + "/screenshot")))
                print("PASS: real Borg archive opens inline with an expandable folder tree and navigable file list, without a modal")
                js("const b=[...document.querySelectorAll('button[data-select]')].find(b=>b.dataset.select.endsWith('native-file.txt')); b.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:450,clientY:300}));")
                until(lambda: js("return !!document.querySelector('[role=menuitem]')"))
                Path("test-results/native-selected-restore-menu.png").write_bytes(base64.b64decode(request("GET", root + "/screenshot")))
                js("document.querySelector('[role=menuitem]').click()")
                destination = Path(temp) / "selected-restore"
                destination.mkdir()
                js("document.querySelector('[name=destination]').value=arguments[0]; document.querySelector('dialog[open] button[type=submit]').click()", [str(destination)])
                def restored_selection():
                    status = invoke("get_status")
                    return not status["busy"] and status["history"][0]["action"] == "restore" and status["history"][0]["exitCode"] == 0
                until(restored_selection)
                assert destination.joinpath(*parts).read_text() == "Native archive browser test\n"
                assert not destination.joinpath(*parts[:-1], "not-selected.txt").exists()
                print("PASS: native context-menu restore extracts only the selected file and excludes its sibling")
                js("document.querySelector('[data-route=\"repositories\"]').click(); document.querySelector('[data-panel=\"profiles\"][data-id=\"relocation-native\"]').click(); document.querySelector('[data-action=\"edit-profile\"]').click()")
                assert js("return !!document.querySelector('#profile-form') && !document.querySelector('dialog[open]') && document.querySelector('#pick-source').textContent.trim() === '+ Source'")
                Path("test-results/native-profile-editor.png").write_bytes(base64.b64decode(request("GET", root + "/screenshot")))
                assert js("const input=document.querySelector('#profile-form [name=intervalHours]'); input.value='20'; input.scrollIntoView({block:'center'}); input.focus(); input.select(); return input.type==='text' && input.inputMode==='numeric' && input.selectionStart===0 && input.selectionEnd===2 && getComputedStyle(input,'::selection').backgroundColor !== getComputedStyle(input).backgroundColor")
                Path("test-results/native-profile-selection.png").write_bytes(base64.b64decode(request("GET", root + "/screenshot")))
                print("PASS: numeric profile fields support real native text selection with contrasting selection colors")
                js("document.querySelector('#profile-form [name=name]').value='Cancelled draft'; document.querySelector('[data-action=\"profile-cancel\"]').click()")
                assert invoke("get_config")["profiles"][0]["name"] == "Native files"
                js("document.querySelector('[data-action=\"edit-profile\"]').click(); document.querySelector('#profile-form [name=name]').value='Native files edited'; document.querySelector('#profile-form').requestSubmit()")
                until(lambda: js("return !document.querySelector('#profile-form')"))
                assert invoke("get_config")["profiles"][0]["name"] == "Native files edited"
                print("PASS: native inline profile editor cancels without changes and explicitly saves through the shared worker")
                js("document.querySelector('[data-route=\"settings\"]').click(); const s=document.querySelector('#appearance-size'); s.value='16'; s.dispatchEvent(new Event('change',{bubbles:true}))")
                assert js("return getComputedStyle(document.documentElement).fontSize==='16px'")
                request("POST", root + "/refresh", {})
                until(lambda: js("return getComputedStyle(document.documentElement).fontSize==='16px' && document.querySelector('.engine-status')?.textContent.includes(arguments[0])", [expected_version]))
                js("document.querySelector('[data-route=\"settings\"]').click(); document.querySelector('[data-action=\"appearance-reset\"]').click()")
                assert js("return getComputedStyle(document.documentElement).fontSize==='14px'")
                print("PASS: native appearance preference survives reload and resets to the JetBrains Mono 14px default")
                js("document.querySelector('[data-action=\"theme-studio\"]').click(); document.querySelector('[data-action=\"theme-select\"][data-theme=ocean]').click(); document.querySelector('[data-action=\"theme-mode\"][data-mode=light]').click(); document.querySelector('[data-route=repositories]').click()")
                assert js("return document.documentElement.dataset.theme==='ocean' && document.documentElement.dataset.themeMode==='light' && getComputedStyle(document.querySelector('.repo-header')).backgroundColor === 'rgb(201, 229, 238)'")
                Path("test-results/native-theme-light.png").write_bytes(base64.b64decode(request("GET", root + "/screenshot")))
                request("POST", root + "/refresh", {})
                until(lambda: js("return document.documentElement.dataset.theme==='ocean' && document.documentElement.dataset.themeMode==='light' && document.querySelector('.engine-status')?.textContent.includes(arguments[0])", [expected_version]))
                js("document.querySelector('[data-action=\"theme-studio\"]').click(); document.querySelector('[data-action=\"theme-select\"][data-theme=midnight]').click(); document.querySelector('[data-action=\"theme-mode\"][data-mode=dark]').click()")
                js("document.querySelector('.theme-preview[data-theme=forest]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:500,clientY:350})); document.querySelector('[role=menuitem]').click()")
                assert js("return document.documentElement.dataset.theme==='custom' && document.querySelector('[data-theme-color=header]').value==='#2a4536'")
                js("document.querySelector('[data-action=\"theme-mode\"][data-mode=light]').click()")
                assert js("return document.querySelector('[data-theme-color=header]').value==='#d3e5c9'")
                js("document.querySelector('[data-action=\"theme-select\"][data-theme=midnight]').click(); document.querySelector('[data-action=\"theme-mode\"][data-mode=dark]').click()")
                print("PASS: native theme preview context menu copies both template layouts into Custom")
                print("PASS: native Theme Studio applies colored repository headers in light mode and preserves the theme across reload")
                assert js("const bar=document.querySelector('.toolbar').getBoundingClientRect(); const center=bar.top+bar.height/2; return [...document.querySelectorAll('.top-brand strong, .top-brand .version, .brand-tagline, .engine-status, .engine-status > span, .top-icon, .top-icon svg')].filter(el=>el.getBoundingClientRect().width>0).every(el=>{const box=el.getBoundingClientRect(); return Math.abs(box.top+box.height/2-center)<=1})")
                print("PASS: native toolbar branding, badge, Borg status and controls share a centered alignment")
                js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'+',ctrlKey:true,bubbles:true,cancelable:true}))")
                until(lambda: js("return document.documentElement.dataset.zoom === '1.1'"))
                js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'0',ctrlKey:true,bubbles:true,cancelable:true}))")
                until(lambda: js("return document.documentElement.dataset.zoom === '1'"))
                js("document.querySelector('[data-route=\"about\"]').click()")
                assert js("return document.querySelector('.about-page').textContent.includes('Developed by Chris Visser') && document.querySelector('.license-text').textContent.includes('prior written approval') && !!document.querySelector('.project-link svg')")
                assert js("return !document.querySelector('.page-heading') && document.querySelector('.about-description').textContent.includes('Borg Backup') && !document.querySelector('.about-license').open")
                js("document.querySelector('.about-license summary').click()")
                assert js("return document.querySelector('.about-license').open")
                js("document.querySelector('.about-license summary').click(); document.querySelector('[data-action=\"help-topic\"][data-topic=restore]').click()")
                assert js("return document.querySelector('.help-detail h4').textContent==='Restore files' && document.querySelector('.help-detail').textContent.includes('empty destination') && !!document.querySelector('.help-example')")
                Path("test-results/native-about.png").write_bytes(base64.b64decode(request("GET", root + "/screenshot")))
                print("PASS: native webview zoom/reset and inline About with developer attribution, GitHub link and custom license")


                js("document.querySelector('[data-action=\"toggle-terminal\"]').click()")
                until(lambda: js("return !!document.querySelector('.terminal-dock .xterm-helper-textarea') && !document.querySelector('[aria-label=\"New terminal tab\"]').disabled"))
                # Exercise actual keyboard -> xterm -> IPC -> PTY -> shell -> display.
                field = request("POST", root + "/element", {"using": "css selector", "value": ".terminal-screen:not([hidden]) .xterm-helper-textarea"})
                element = field["element-6066-11e4-a52e-4f735466cecf"]
                command = "printf '\\137\\137BORG_NATIVE_PTY_OK\\137\\137\\n'; borg --version"
                request("POST", root + f"/element/{element}/value", {"text": command + "\ue007"})
                try:
                    until(lambda: js("return document.querySelector('.terminal-dock').textContent.includes('__BORG_NATIVE_PTY_OK__')"))
                except AssertionError:
                    Path("test-results/native-terminal-failure.txt").write_text(js("return document.querySelector('.terminal-dock').textContent"))
                    Path("test-results/native-terminal-failure.png").write_bytes(base64.b64decode(request("GET", root + "/screenshot")))
                    raise
                until(lambda: js("return document.querySelector('.terminal-dock').textContent.includes(arguments[0])", [expected_version]))
                js("document.querySelector('[aria-label=\"New terminal tab\"]').click()")
                until(lambda: js("return document.querySelectorAll('[role=tab]').length===2 && !document.querySelector('[aria-label=\"New terminal tab\"]').disabled"))
                print("PASS: real interactive shell executes commands and a second PTY tab starts")
                js("document.querySelector('#terminal-tab-1').click()")
                until(lambda: js("return !document.querySelector('#terminal-screen-1').hidden"))
                screenshot = request("GET", root + "/screenshot")
                Path("test-results/native-appimage.png").write_bytes(base64.b64decode(screenshot))
                print("Native screenshot: test-results/native-appimage.png")
                request("DELETE", root, {})
                session = None
                assert worker.poll() is None
                source = Path(temp) / "headless-source"
                source.mkdir()
                (source / "scheduled.txt").write_text("Backup while the desktop window is closed\n")
                cfg = worker_rpc("get_config")
                cfg["repositories"].append({"id": "headless", "name": "Headless schedule", "location": str(Path(temp) / "headless-repo")})
                worker_rpc("save_config", {"config": cfg})
                worker_rpc("run_operation", {"request": {"action": "init", "repositoryId": "headless", "encrypted": False}})
                cfg["profiles"].append({"id": "headless-profile", "name": "Scheduled without GUI", "repositoryId": "headless", "sources": [str(source)], "excludes": [], "keepDaily": 1, "keepWeekly": 0, "keepMonthly": 0, "intervalHours": 1})
                worker_rpc("save_config", {"config": cfg})
                def scheduled():
                    return any(h["action"] == "backup" and h.get("profileId") == "headless-profile" and h["exitCode"] == 0 for h in worker_rpc("get_status")["history"])
                until(scheduled, seconds=90)
                assert worker.poll() is None
                print("PASS: background worker survives GUI exit and executes a real scheduled Borg backup with no desktop window")
                with ThreadPoolExecutor(max_workers=1) as pool:
                    pending = pool.submit(worker_rpc, "run_operation", {"request": {"action": "check", "repositoryId": "headless"}})
                    until(lambda: worker_rpc("get_status")["busy"])
                    worker.terminate()
                    assert pending.result(timeout=60)["exitCode"] == 0
                    assert worker.wait(timeout=60) == 0
                print("PASS: worker SIGTERM waits for an active real Borg check and persists its completion")
                # A second desktop connects to a fresh worker; all startup files remain in the disposable XDG home.
                created = request("POST", "/session", {"capabilities": {"alwaysMatch": {"tauri:options": {"application": str(Path(args.application).resolve())}}}})
                session = created["sessionId"]
                root = f"/session/{session}"
                until(lambda: js("return !!document.querySelector('[data-route=\"settings\"]')"))
                def service_action(action):
                    js("window.__serviceOutcome=null; window.__TAURI_INTERNALS__.invoke('worker_service_action',{action:arguments[0]}).then(value=>window.__serviceOutcome={value}).catch(error=>window.__serviceOutcome={error:String(error)})", [action])
                    outcome = until(lambda: js("return window.__serviceOutcome"), seconds=60)
                    assert "error" not in outcome, outcome
                    return outcome["value"]
                js("window.__servicePlan=null; window.__TAURI_INTERNALS__.invoke('worker_service_info').then(value=>window.__servicePlan=value)")
                planned = until(lambda: js("return window.__servicePlan"))
                assert planned["manager"].startswith("XDG") and Path(planned["definition"]).is_relative_to(Path(temp)), planned
                before_config = worker_rpc("get_config")
                registered = service_action("register")
                assert registered["manager"].startswith("XDG"), registered
                assert Path(registered["definition"]).is_relative_to(Path(temp))
                assert registered["registered"] and Path(registered["definition"]).is_file()
                stopped = service_action("stop")
                assert not stopped["running"] and stopped["paused"]
                started = service_action("start")
                assert started["running"] and not started["paused"]
                assert worker_rpc("get_status")["unlocked"] == []
                assert worker_rpc("get_config") == before_config
                removed = service_action("uninstall")
                assert not removed["running"] and not removed["registered"]
                assert not Path(registered["definition"]).exists()
                print("PASS: real isolated XDG registration, graceful stop, restart with cleared passphrases, and uninstall preserve repository/profile configuration")
                request("DELETE", root, {})
                session = None

            finally:
                if session:
                    try:
                        request("DELETE", f"/session/{session}", {})
                    except (OSError, RuntimeError):
                        pass
                driver.terminate()
                try:
                    driver.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    driver.kill()
                    driver.wait()
                worker.terminate()
                worker.wait(timeout=120)


if __name__ == "__main__":
    main()
