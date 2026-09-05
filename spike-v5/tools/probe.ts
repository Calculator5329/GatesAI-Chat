import { test } from 'node:test';
import assert from 'node:assert/strict';

const value: number = 2;
test('probe', () => assert.equal(value + 2, 4));
