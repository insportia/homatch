"""Local fixture only; no Agent/model/cloud connection, no production dependency."""
import os
from pathlib import Path
os.environ['BROWSER_USE_CONFIG_DIR'] = str(Path('publisher-worker/artifacts/toolkit/browseruse-config').resolve())
os.environ['XDG_CACHE_HOME'] = str(Path('publisher-worker/artifacts/toolkit/cache').resolve())
os.environ['ANONYMIZED_TELEMETRY'] = 'false'
os.environ['BROWSER_USE_DISABLE_EXTENSIONS'] = '1'
os.environ['BROWSER_USE_LOGGING_LEVEL'] = 'error'
import asyncio, json, time, importlib.metadata
from pathlib import Path
from urllib.parse import quote
from browser_use import BrowserSession, BrowserProfile

async def main():
    started = time.monotonic()
    browser = BrowserSession(browser_profile=BrowserProfile(headless=True, executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe'))
    result = {'tool': 'Browser Use', 'version': importlib.metadata.version('browser-use'), 'status': 'PARTIAL', 'agentInference': 'NOT_RUN_NO_MODEL'}
    try:
        await browser.start()
        page = await browser.new_page('data:text/html,' + quote(Path('publisher-worker/qa/toolkit-fixture.html').read_text(encoding='utf-8')))
        title = await page.evaluate('() => document.title')
        assert 'HOMATCH' in title
        await page.evaluate("() => { document.querySelector('[name=myhome]').checked=true; document.querySelector('button').click(); }")
        selected = await page.evaluate('() => document.querySelector("output").textContent')
        assert selected == 'myhome'
        result.update(initialized=True, fixtureInteraction='PASS', selected=selected)
    except Exception as error:
        result.update(status='FAIL', errorType=type(error).__name__, error=str(error)[:800])
    finally:
        await browser.kill()
    result['durationMs'] = round((time.monotonic()-started)*1000)
    target = Path('publisher-worker/artifacts/toolkit')
    target.mkdir(parents=True, exist_ok=True)
    (target/'browser-use.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result))
    if result['status'] == 'FAIL':
        raise SystemExit(1)

asyncio.run(asyncio.wait_for(main(), timeout=45))
