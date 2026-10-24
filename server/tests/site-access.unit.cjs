'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkSiteAccess } = require('../scripts/check-site-access.cjs');

function browserModel(responses) {
  let launches = 0, open = 0;
  const contexts = [], navigations = [];
  return {
    contexts, navigations,
    get open() { return open; },
    chromium: { launch: async () => {
      assert.equal(open, 0, 'browser checks must be sequential');
      open++;
      const response = responses[launches++];
      if (response.launchError) { open--; throw new Error('launch details must not be logged'); }
      return {
        version: () => 'test-browser-version',
        newContext: async options => {
          contexts.push(options);
          const control = {
            or() { return this; }, filter() { return this; }, first() { return this; },
            waitFor: async () => {}, all: async () => [{ isVisible: async () => !!response.login }],
          };
          return { newPage: async () => ({
            setDefaultTimeout() {},
            goto: async url => {
              navigations.push(url);
              if (response.error) throw new Error('sensitive browser error details');
              return { status: () => response.status, headers: () => response.headers || {} };
            },
            title: async () => response.title || 'Flingster',
            locator: () => { assert.ok(!response.challenge, 'challenge page must not be inspected for login controls'); return control; },
            getByRole: () => control,
          }) };
        },
        close: async () => { open--; },
      };
    } },
  };
}

test('challenge responses stop without login interaction and both browsers close', async () => {
  const model = browserModel([
    { status: 403, challenge: true, headers: { 'cf-mitigated': 'challenge' } },
    { status: 200, challenge: true, title: 'Just a moment...' },
  ]);
  const output = [];
  const results = await checkSiteAccess(model.chromium, line => output.push(line));
  assert.ok(results.every(result => result.challenge));
  assert.equal(model.open, 0);
  assert.deepEqual(model.navigations, ['https://flingster.com/', 'https://flingster.com/']);
  assert.match(output.at(-1), /Both browser configurations/);
});

test('native defaults are actually native and do not claim verified password success', async () => {
  const model = browserModel([{ status: 200, login: true }, { status: 403, challenge: true }]);
  const output = [];
  const results = await checkSiteAccess(model.chromium, line => output.push(line));
  assert.deepEqual(model.contexts[0], {});
  assert.match(model.contexts[1].userAgent, /Chrome\/125/);
  assert.equal(results[0].loginControlVisible, true);
  assert.match(output.at(-1), /remains unverified/);
  assert.equal(model.open, 0);
});

test('navigation failure closes the browser, prints no raw errors, and permits the second check', async () => {
  const model = browserModel([{ error: true }, { status: 200, login: true }]);
  const output = [];
  const results = await checkSiteAccess(model.chromium, line => output.push(line));
  assert.equal(results[0].error, 'navigation: Error');
  assert.equal(results[1].loginControlVisible, true);
  assert.equal(model.open, 0);
  assert.ok(!output.join('\n').includes('sensitive'));
});
