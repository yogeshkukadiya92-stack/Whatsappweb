import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simpleReply } from './simpleReply.ts';

test('simple replies are personal-chat drafts with explicit keywords and cooldown', () => {
  const result = simpleReply(' Welcome ', 'hello, hi, hello, ', ' Thanks! ');
  assert.equal(result.enabled, false);
  assert.equal(result.name, 'Welcome');
  assert.equal(result.definition.audience, 'direct');
  assert.equal(result.definition.cooldownSeconds, 60);
  assert.deepEqual(result.definition.keywords, ['hello', 'hi']);
  assert.equal(result.definition.steps[0].config.text, 'Thanks!');
});
test('blank input cannot accidentally create a catch-all reply', () => {
  for (const values of [
    [' ', 'hi', 'Hello'],
    ['Welcome', ', ,', 'Hello'],
    ['Welcome', 'hi', ' '],
  ]) {
    assert.throws(() => simpleReply(values[0], values[1], values[2]));
  }
});
