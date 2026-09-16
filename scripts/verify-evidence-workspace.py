"""Exercise the actual local scripted Arena, never a phone/model provider."""
from pathlib import Path
import json, time, urllib.request
from playwright.sync_api import sync_playwright
base='http://127.0.0.1:4242'; out=Path('ui-review'); out.mkdir(exist_ok=True)
for attempt in range(90):
    try:
        with urllib.request.urlopen(base,timeout=1) as response:
            if response.status==200: break
    except Exception:
        time.sleep(1)
else: raise RuntimeError('Local Arena did not start')
report=[]
with sync_playwright() as p:
    browser=p.chromium.launch()
    for width in [390,1440]:
        for scheme in ['light','dark']:
            context=browser.new_context(viewport={'width':width,'height':900},color_scheme=scheme,reduced_motion='reduce')
            page=context.new_page(); errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(base,wait_until='networkidle')
            page.locator('#scenario-list button').first.wait_for()
            assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1'), 'Start screen overflows'
            page.locator('[data-transport="real"]').click()
            page.locator('#screen-real').wait_for(state='visible')
            assert page.locator('#screen-real input:disabled').count()>0, 'Real providers unexpectedly enabled'
            page.locator('#real-back').click()
            page.locator('#scenario-list button').first.click()
            page.locator('#screen-call').wait_for(state='visible')
            page.wait_for_function("document.querySelector('#transcript').children.length>0",timeout=20000)
            transcript=page.locator('#transcript').bounding_box(); evidence=page.locator('.panels').bounding_box()
            assert transcript and evidence
            if width>900: assert evidence['x']>=transcript['x']+transcript['width']-1,'Evidence must be alongside transcript'
            else: assert evidence['y']>=transcript['y']+transcript['height']-1,'Evidence must stack below transcript'
            page.locator('#drawer-toggle').click()
            page.locator('#drawer-body').wait_for(state='visible')
            assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1'), 'Call screen overflows'
            assert not errors,errors
            page.screenshot(path=str(out/f'arena-{width}-{scheme}.png'),full_page=True)
            report.append({'width':width,'scheme':scheme,'start':True,'real_phone_disabled':True,'scripted_transcript':True,'evidence_layout':True,'details':True})
            context.close()
    browser.close()
(out/'report.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
