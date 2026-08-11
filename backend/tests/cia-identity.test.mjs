import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getCiaIdentityText, isCiaIdentityQuestion } from '../src/services/ciaIdentity.js';

test('ciaIdentity returns valid identity text containing 4 core elements', () => {
  const text = getCiaIdentityText();
  assert.ok(text.includes('CIA (Cimory Intelligence Assistant)'));
  assert.ok(text.includes('CMD Plant Sentul'));
  assert.ok(text.includes('Power BI'));
  assert.ok(text.includes('tag CIA'));
  // Ensure no em dash or emoji
  assert.equal(text.includes('—'), false);
  assert.equal(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}]/u.test(text), false);
});

test('isCiaIdentityQuestion detects identity questions', () => {
  assert.equal(isCiaIdentityQuestion('cia itu apa'), true);
  assert.equal(isCiaIdentityQuestion('kamu siapa'), true);
  assert.equal(isCiaIdentityQuestion('bisa bantu apa aja'), true);
  assert.equal(isCiaIdentityQuestion('berapa losses hari ini'), false);
});
