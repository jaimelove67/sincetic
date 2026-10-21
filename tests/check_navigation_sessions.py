"""Browser checks for the course directory and isolated grade-stage chats.

Run against a local server: python tests/check_navigation_sessions.py.
Chat responses are simulated in this test only; no model requests are made.
"""

import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


MOCK_CHAT = r"""(() => {
  const originalFetch = window.fetch.bind(window);
  window.__chatRequests = [];
  window.__finishedChats = [];
  window.fetch = (url, options) => {
    if (url !== '/api/chat') return originalFetch(url, options);
    const payload = JSON.parse(options.body);
    window.__chatRequests.push(payload);
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        const send = (event, data) => controller.enqueue(encoder.encode(
          `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
        ));
        send('meta', { sources: [] });
        send('delta', { text: `回答开头：${payload.message}\n` });
        const delay = payload.message === 'stream-old' ? 1000
          : payload.message === 'stream-new' ? 2400 : 30;
        // Deliberately deliver buffered events even after abort, to test isolation.
        setTimeout(() => {
          send('meta', { sources: [{ id: payload.message, title: `${payload.message}资料`,
            excerpt: '测试资料', pages: 'p.1', chapter: '测试' }] });
          send('delta', { text: `完成回答：${payload.message}` });
          send('graph', { title: `${payload.message}图谱`, nodes: [
            { id: 'root', label: payload.message, root: true },
            { id: 'child', label: '测试节点' }
          ], edges: [{ from: 'root', to: 'child', relation: '包含' }] });
          send('done', {});
          controller.close();
          window.__finishedChats.push(payload.message);
        }, delay);
      }
    });
    return Promise.resolve(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
  };
})();"""


def send_question(page, message):
    page.locator('#messageInput').fill(message)
    page.locator('#sendBtn').click()
    page.wait_for_function('(message) => document.querySelector("#conversation").textContent.includes("回答开头：" + message)', arg=message)


def wait_for_answer(page, message):
    page.wait_for_function('(message) => window.__finishedChats.includes(message)', arg=message)
    page.wait_for_function('!document.querySelector("#composerForm").classList.contains("is-streaming")')


def saved_sessions(page):
    return page.evaluate('JSON.parse(localStorage.getItem("gewu-sessions-v1") || "[]")')


def main():
    output_dir = Path('work/navigation-session-check')
    output_dir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        options = {'headless': True}
        if not Path(playwright.chromium.executable_path).is_file():
            cache = Path(os.environ.get('LOCALAPPDATA', '')) / 'ms-playwright'
            installed = sorted(cache.glob('chromium-*/chrome-win64/chrome.exe'),
                               key=lambda path: int(path.parents[1].name.split('-')[1]), reverse=True)
            if installed:
                options['executable_path'] = str(installed[0])
        browser = playwright.chromium.launch(**options)
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.add_init_script(MOCK_CHAT)
        page.goto('http://127.0.0.1:8000/')
        page.wait_for_selector('.domain-label')
        assert page.locator('.domain-block').count() == 4
        assert page.locator('.domain-children .concept-item').count() == 13
        matter = page.locator('[data-domain-id="matter"]')
        matter.locator('summary').focus()
        matter.locator('summary').press('Enter')
        assert not matter.locator('.concept-item').first.is_visible(), 'collapsed children must be hidden'
        matter.locator('summary').press('Space')
        assert matter.locator('.concept-item').first.is_visible(), 'keyboard must expand the directory'
        life = page.locator('[data-domain-id="life"]')
        life.locator('summary').click()
        life.locator('[data-concept-id="5"]').click()
        assert page.locator('#conceptPillText').inner_text() == '生命系统的构成层次'
        page.locator('[data-concept-id="1"]').click()
        assert page.locator('[data-concept-id="1"]').get_attribute('aria-current') == 'true'
        assert page.locator('[data-concept-id="1"]').bounding_box()['height'] < 45
        page.locator('#toastWrap').evaluate('(element) => element.replaceChildren()')
        page.locator('#leftRail').screenshot(path=str(output_dir / 'directory.png'))

        send_question(page, 'original-stage-question')
        wait_for_answer(page, 'original-stage-question')
        old_session = saved_sessions(page)[0]
        assert old_session['stage'] == '3-4'
        page.locator('#stageSwitch [data-stage="5-6"]').click()
        assert page.locator('#conversation .message').count() == 0, 'grade change must start a blank chat'
        assert page.locator('#welcome').is_visible()
        assert page.locator('#stagePill').inner_text() == '5–6年级'
        assert page.locator('#messageInput').input_value() == ''
        assert page.locator('#conceptPill').get_attribute('class').find('is-hidden') >= 0
        assert page.locator('#focusCard .focus-card-type').inner_text() == '课程总览'
        assert saved_sessions(page)[0]['stage'] == '3-4', 'old session must retain its original stage'

        send_question(page, 'new-stage-question')
        wait_for_answer(page, 'new-stage-question')
        request = page.evaluate('window.__chatRequests.at(-1)')
        assert request['stage'] == '5-6' and request['history'] == [] and request['concept'] is None
        assert saved_sessions(page)[0]['id'] != old_session['id'], 'new stage needs a separate session'
        page.locator('#stageSwitch [data-stage="5-6"]').click()
        assert page.locator('#conversation .message').count() == 2, 'reselecting the same stage must keep the chat'

        matter.locator('summary').click()
        page.locator('#openArchive').click()
        page.locator(f'[data-restore-session="{old_session["id"]}"]').click()
        assert page.locator('#stagePill').inner_text() == '3–4年级'
        assert page.locator('#conversation .message').count() == 2, 'restoring a session must not clear it'
        assert matter.get_attribute('open') is not None, 'restoring the topic must reveal its parent directory'

        send_question(page, 'stream-old')
        page.locator('#stageSwitch [data-stage="5-6"]').click()
        send_question(page, 'stream-new')
        page.wait_for_function('window.__finishedChats.includes("stream-old")')
        assert 'is-streaming' in page.locator('#composerForm').get_attribute('class'), 'old cleanup must not stop the new response'
        assert 'stream-old' not in page.locator('#sourcesList').inner_text()
        assert 'stream-old' not in page.locator('#graphTitle').inner_text()
        wait_for_answer(page, 'stream-new')
        current = saved_sessions(page)[0]
        assert current['stage'] == '5-6'
        assert all('stream-old' not in message['content'] for message in current['messages'])
        previous = next(session for session in saved_sessions(page) if session['id'] == old_session['id'])
        assert previous['stage'] == '3-4' and previous['messages'][-1]['aborted']
        assert '回答开头：stream-old' in previous['messages'][-1]['content']
        assert '完成回答：stream-old' not in previous['messages'][-1]['content']
        send_question(page, 'follow-up')
        wait_for_answer(page, 'follow-up')
        history = page.evaluate('window.__chatRequests.at(-1).history')
        assert len(history) == 2 and all('stream-old' not in message['content'] for message in history)
        page.locator('#newChat').click()
        page.locator('#stageSwitch [data-stage="7-9"]').click()
        page.locator('#stageSwitch [data-stage="1-2"]').click()
        assert page.locator('#conversation .message').count() == 0
        assert page.locator('#stagePill').inner_text() == '1–2年级'
        assert len(saved_sessions(page)) == 3, 'blank stage switches must not create empty archive records'

        page.set_viewport_size({'width': 390, 'height': 844})
        page.locator('#openCourses').click()
        page.locator('[data-concept-id="1"]').click()
        assert page.locator('#conceptPillText').inner_text() == '物质的结构与性质'
        assert 'is-open' not in page.locator('#leftRail').get_attribute('class')
        page.locator('#openCourses').click()
        page.locator('#toastWrap').evaluate('(element) => element.replaceChildren()')
        page.screenshot(path=str(output_dir / 'mobile-directory.png'))
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert not errors, errors
        browser.close()
    print(json.dumps({'directory': 'passed', 'stage_chat_isolation': 'passed',
                      'stream_switch': 'passed', 'restore': 'passed', 'mobile': 'passed'}))


if __name__ == '__main__':
    main()
