import '../test-helpers/register-hooks.ts';
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { installJsdomGlobals as installJsdomGlobalsFn } from '../test-helpers/jsdom.ts';
import {
  getPinnedGroupIds,
  isGroupPinned,
  togglePinGroup,
  getPinnedContacts,
  isContactPinned,
  togglePinContact,
  removePinnedContact,
  FAVORITE_STORAGE_KEYS,
} from './favoriteStorage.ts';

let installJsdomGlobals: typeof installJsdomGlobalsFn;

before(async () => {
  ({ installJsdomGlobals } = await import('../test-helpers/jsdom.ts'));
  await installJsdomGlobals();
});

beforeEach(() => {
  localStorage.clear();
});

test('togglePinGroup pins and unpins groups', () => {
  assert.equal(isGroupPinned('group-1@g.us'), false);

  const pinned = togglePinGroup('group-1@g.us');
  assert.equal(pinned, true);
  assert.equal(isGroupPinned('group-1@g.us'), true);
  assert.deepEqual(getPinnedGroupIds(), ['group-1@g.us']);

  // Pin another
  togglePinGroup('group-2@g.us');
  assert.deepEqual(getPinnedGroupIds(), ['group-1@g.us', 'group-2@g.us']);

  // Unpin first
  const unpinned = togglePinGroup('group-1@g.us');
  assert.equal(unpinned, false);
  assert.deepEqual(getPinnedGroupIds(), ['group-2@g.us']);
});

test('togglePinContact pins and unpins personal contacts by phone number', () => {
  assert.equal(isContactPinned('+91 98253 44428'), false);

  togglePinContact({ phone: '+91 98253 44428', name: 'Yogesh' });
  assert.equal(isContactPinned('919825344428'), true);
  assert.equal(isContactPinned('+919825344428'), true);

  const contacts = getPinnedContacts();
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].name, 'Yogesh');

  // Toggle again unpins
  togglePinContact({ phone: '919825344428' });
  assert.equal(isContactPinned('919825344428'), false);
  assert.equal(getPinnedContacts().length, 0);
});

test('removePinnedContact removes by phone regardless of formatting', () => {
  togglePinContact({ phone: '+91-98765-43210', name: 'Client' });
  assert.equal(isContactPinned('919876543210'), true);

  removePinnedContact('919876543210');
  assert.equal(isContactPinned('919876543210'), false);
});
