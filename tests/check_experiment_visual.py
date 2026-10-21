"""Browser regression check: python tests/check_experiment_visual.py.

Requires Playwright and an installed Chromium browser; no model requests are sent.
"""

import argparse
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


PARTICLE_SNAPSHOT = """() => {
  const parent = document.querySelector('.solute-particles');
  const parentStyle = getComputedStyle(parent);
  const particles = [...parent.children].map((particle) => {
    const style = getComputedStyle(particle);
    const matrix = new DOMMatrixReadOnly(style.transform);
    return {
      area: parseFloat(style.width) * parseFloat(style.height)
        * Math.abs(matrix.a * matrix.d - matrix.b * matrix.c),
      opacity: Number(style.opacity) * Number(parentStyle.opacity),
      hidden: style.visibility === 'hidden' || parentStyle.visibility === 'hidden'
    };
  });
  return {
    progress: document.querySelector('#experimentProgressText').textContent,
    status: document.querySelector('#experimentBench').dataset.status,
    particles,
    visible: particles.filter((p) => !p.hidden && p.opacity > 0.01 && p.area > 0.05).length,
    totalArea: particles.reduce((sum, p) => sum + p.area, 0)
  };
}"""


def run_trial(page, particle, stirring, output_dir, capture=False):
    page.locator('#experimentReset').click()
    page.locator(f'#experimentParticle [data-particle="{particle}"]').click()
    page.locator(f'#experimentStirring [data-stirring="{stirring}"]').click()
    page.locator('#experimentTemperature').fill('80')
    page.locator('#experimentLoad').click()
    page.wait_for_timeout(300)
    initial = page.evaluate(PARTICLE_SNAPSHOT)
    if capture:
        page.locator('.experiment-body').screenshot(path=str(output_dir / 'loaded.png'))
    page.locator('#experimentRun').click()
    page.wait_for_function("parseInt(document.querySelector('#experimentProgressText').textContent) >= 45")
    middle = page.evaluate(PARTICLE_SNAPSHOT)
    motion = page.evaluate("""() => ({
      rod: getComputedStyle(document.querySelector('.glass-rod')).animationName
    })""")
    if capture:
        page.locator('.experiment-body').screenshot(path=str(output_dir / 'dissolving.png'), animations='allow')
    page.wait_for_function("document.querySelector('#experimentBench').dataset.status === 'complete'", timeout=10000)
    page.wait_for_timeout(500)
    final = page.evaluate(PARTICLE_SNAPSHOT)
    if capture:
        page.locator('.experiment-body').screenshot(path=str(output_dir / 'complete.png'))
    print(json.dumps({
        'particle': particle, 'stirring': stirring,
        'initial_area': round(initial['totalArea'], 2),
        'middle_area': round(middle['totalArea'], 2),
        'final_visible_particles': final['visible'], 'final_status': final['status']
    }, ensure_ascii=False))
    problems = []
    if initial['visible'] == 0:
        problems.append('added sugar must be visible before the trial')
    if middle['totalArea'] >= initial['totalArea'] * 0.9:
        problems.append('sugar must shrink as the trial progresses')
    if final['visible'] != 0:
        problems.append('no undissolved sugar should remain when the trial completes')
    if stirring == 'yes' and motion['rod'] != 'stirRod':
        problems.append('glass rod must move when stirring')
    if stirring == 'no' and motion['rod'] != 'none':
        problems.append('an unstirred trial must not display stirring motion')
    assert not problems, '; '.join(problems)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:8000/')
    parser.add_argument('--output-dir', default='work/experiment-visual-check')
    parser.add_argument('--browser', help='Optional path to an installed Chromium executable.')
    parser.add_argument('--all', action='store_true', help='Check all particle sizes, stirring, reset and mobile layout.')
    args = parser.parse_args()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        options = {'headless': True}
        if args.browser:
            options['executable_path'] = args.browser
        elif not Path(playwright.chromium.executable_path).is_file():
            cache = Path(os.environ.get('LOCALAPPDATA', '')) / 'ms-playwright'
            installed = sorted(cache.glob('chromium-*/chrome-win64/chrome.exe'),
                               key=lambda path: int(path.parents[1].name.split('-')[1]), reverse=True)
            if installed:
                options['executable_path'] = str(installed[0])
        browser = playwright.chromium.launch(**options)
        page = browser.new_page(viewport={'width': 1365, 'height': 960})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(args.url)
        page.locator('.suggestion-card.is-experiment').click()
        run_trial(page, 'large', 'yes', output_dir, capture=True)
        if args.all:
            for particle, stirring in [('medium', 'yes'), ('powder', 'yes'), ('large', 'no')]:
                run_trial(page, particle, stirring, output_dir)
            page.locator('#experimentLoad').click()
            page.wait_for_timeout(300)
            assert page.evaluate(PARTICLE_SNAPSHOT)['visible'] > 0, 'reloading must restore sugar'
            page.locator('#experimentRun').click()
            page.locator('#experimentReset').click()
            page.wait_for_timeout(300)
            assert page.locator('#experimentBench').get_attribute('data-status') == 'idle'
            assert page.evaluate(PARTICLE_SNAPSHOT)['visible'] == 0, 'reset must clear sugar'
            page.set_viewport_size({'width': 390, 'height': 844})
            page.locator('#experimentLoad').click()
            page.wait_for_timeout(300)
            page.locator('#toastWrap').evaluate('(element) => element.replaceChildren()')
            page.locator('.experiment-body').screenshot(path=str(output_dir / 'mobile.png'))
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'mobile page must not overflow'
        assert not errors, errors
        browser.close()
    print('Experiment visual checks passed.')


if __name__ == '__main__':
    main()
