import assert from 'node:assert/strict';
import { test } from '../helpers/app.mjs';

test('The application links to an offline model document with generated facts, equations and a diagram', async ({ app }) => {
  const { page, context, config, shot } = app;
  const before = await config();
  const [document] = await Promise.all([context.waitForEvent('page'), page.locator('#model-documentation').click()]);
  await document.waitForURL(url => decodeURIComponent(url.pathname).endsWith('/Documentación del simulador.html'));
  await document.waitForLoadState('domcontentloaded');
  assert.equal(decodeURIComponent(new URL(document.url()).pathname.split('/').at(-1)), 'Documentación del simulador.html');
  assert.ok(await document.locator('math').count() >= 3);
  assert.equal(await document.locator('svg[role="img"]').count(), 1);
  assert.ok(await document.locator('[data-parameter]').count() > 80);
  assert.ok(await document.locator('[data-model-fact]').count() > 25);
  assert.equal(await document.locator('[data-fit]').count(), 6);
  assert.equal(await document.locator('script').count(), 0);
  assert.deepEqual(await config(), before);
  await document.screenshot({ path: test.info().outputPath('model-documentation.png') });
  await document.close();
  await shot('model-link');
});

test('Documentation and limitations remain readable on a phone and link back to the application', async ({ app }) => {
  const { page, index } = app;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(index);
  assert.equal(await page.locator('footer').getByText('Diseñado por Facundo Karanik', { exact: false }).count(), 1);
  assert.equal(await page.locator('footer').getByText('Hecho con Claude y Codex', { exact: false }).count(), 1);
  await page.getByRole('link', { name: 'Cómo funciona el simulador', exact: true }).click();
  const size = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  assert.ok(size[0] <= size[1], 'the document must keep wide tables inside scrolling containers');
  await page.getByRole('link', { name: 'Limitaciones del modelo', exact: true }).first().click();
  assert.equal(await page.locator('h1').textContent(), 'Limitaciones del modelo');
  assert.equal(await page.locator('script').count(), 0);
  await page.getByRole('link', { name: 'Volver al simulador', exact: true }).first().click();
  await page.waitForFunction(() => !!window.VFDSimulator);
});
