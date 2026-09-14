/* global window, document, MutationObserver, innerWidth, innerHeight, scrollY */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');

// Invoked by frontend-v2-qa.js with its isolated database and media fixtures.
module.exports = async function motionChecks(browser, origin, output, report, cover) {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width === 390, hasTouch: width === 390 });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/qa-cover.svg') return route.fulfill({ contentType: 'image/svg+xml', body: cover });
      if (url.origin !== origin) return route.fulfill({ body: '' });
      return route.continue();
    });
    await context.addInitScript(() => {
      window.motionQA = { values: [], pending: new Set(), maxPending: 0, frames: [] };
      const raf = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window);
      window.requestAnimationFrame = callback => {
        const isMotion = callback.name === 'tick';
        const id = raf(time => {
          window.motionQA.pending.delete(id);
          if (isMotion) window.motionQA.frames.push(time);
          callback(time);
        });
        if (isMotion) {
          window.motionQA.pending.add(id);
          window.motionQA.maxPending = Math.max(window.motionQA.maxPending, window.motionQA.pending.size);
        }
        return id;
      };
      window.cancelAnimationFrame = id => { window.motionQA.pending.delete(id); cancel(id); };
      new MutationObserver(() => {
        const loader = document.querySelector('.motion-loader');
        if (loader) {
          const value = Number(loader.getAttribute('aria-valuenow'));
          if (window.motionQA.values.at(-1) !== value) window.motionQA.values.push(value);
        }
      }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-valuenow'] });
    });
    const page = await context.newPage();
    page.on('pageerror', e => report.errors.push({ width, error: e.message }));
    page.on('console', msg => { if (msg.type() === 'error') report.errors.push({ width, error: msg.text() }); });
    const settled = () => page.waitForFunction(() => !document.querySelector('.motion-scene,.motion-clone,.motion-loader') && !document.documentElement.classList.contains('motion-locked') && !document.body.classList.contains('pjax-loading'));
    await page.goto(origin);
    await page.locator('.motion-loader').waitFor();
    await page.screenshot({ path: path.join(output, `loader-${width}.png`) });
    await settled();
    const values = await page.evaluate(() => window.motionQA.values);
    assert.equal(values[0], 0); assert.equal(values.at(-1), 100);
    assert(values.every((v, i) => !i || v >= values[i - 1]));
    await page.screenshot({ path: path.join(output, `hero-${width}.png`) });
    if (width === 1440) {
      await page.mouse.move(200, 230);
      await page.mouse.move(400, 300, { steps: 30 });
      await page.mouse.move(1000, 380, { steps: 3 });
      await page.waitForTimeout(1600);
      const cursor = await page.locator('.motion-cursor').boundingBox();
      assert(Math.abs(cursor.x + cursor.width / 2 - 1000) < 2, 'cursor settles at pointer');
      await page.waitForFunction(() => window.motionQA.pending.size === 0, null, { timeout: 8000 });
    }
    assert.equal(await page.locator('.motion-flow').count(), 0, 'pointer path leaves no canvas trail');
    await page.locator('main a[href="/works"]').first().click();
    await settled();
    await page.locator('.work-card').first().scrollIntoViewIfNeeded();
    if (width === 1440) {
      await page.locator('.work-card').first().hover();
      await page.waitForTimeout(300);
      assert.equal(await page.locator('.work-card.motion-hover').count(), 1);
    }
    const savedY = await page.evaluate(() => scrollY);
    await page.locator('.work-card').first().click();
    await page.waitForTimeout(250);
    assert.equal(await page.locator('.motion-scene').count(), 1);
    assert.equal(await page.locator('.motion-clone').count(), width === 1440 ? 1 : 0);
    await page.screenshot({ path: path.join(output, `transition-${width}.png`) });
    await settled();
    assert(page.url().includes('/works/qa-work-'));
    assert.equal(await page.locator('main').evaluate(el => el.inert), false);
    await page.screenshot({ path: path.join(output, `detail-${width}.png`) });
    await page.goBack(); await settled();
    assert.equal(new URL(page.url()).pathname, '/works');
    assert(Math.abs(await page.evaluate(() => scrollY) - savedY) < 3);
    for (let round = 0; round < 3; round++) {
      await page.locator('.work-card').first().click(); await settled();
      await page.goBack(); await settled();
      assert.equal(await page.locator('.motion-cursor').count(), 1);
      assert.equal(await page.locator('.motion-progress').count(), 1);
    }
    for (const delta of [1700, -1300, 1900, -1800, 600]) { await page.mouse.wheel(0, delta); await page.waitForTimeout(70); }
    await page.waitForTimeout(600);
    const progress = await page.evaluate(() => ({ actual: Number(document.querySelector('.motion-progress').getAttribute('aria-valuenow')), expected: Math.round(100 * scrollY / (document.documentElement.scrollHeight - innerHeight)) }));
    assert(Math.abs(progress.actual - progress.expected) <= 1);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.evaluate(() => window.aeoleafTheme.set('dark'));
    await page.screenshot({ path: path.join(output, `works-dark-${width}.png`) });
    await page.locator('.work-card').first().click();
    await page.waitForTimeout(150);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await settled();
    assert.equal(await page.locator('.motion-scene,.motion-clone,.motion-flow').count(), 0);
    assert.equal(await page.evaluate(() => window.motionQA.maxPending), 1);
    report.checks.push(`motion ${width}: loader monotonic 0–100, pointer/hover, scene, detail, back scroll restoration, fast scroll, theme, reduced motion, single RAF`);
    const frames = await page.evaluate(() => window.motionQA.frames);
    const gaps = frames.slice(1).map((t, i) => t - frames[i]).filter(t => t < 100).sort((a,b) => a-b);
    report.pages.push({ width, loaderValues: values, activeFrameP95: gaps[Math.floor(gaps.length * .95)], maxPending: 1 });
    await page.reload(); await settled();
    assert.equal(await page.locator('.motion-loader').count(), 0, 'return visits skip loader');
    await context.close();
  }
};
