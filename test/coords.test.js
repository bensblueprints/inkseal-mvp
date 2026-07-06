// Unit tests for the coordinate mapping — run standalone with:
//   node test/coords.test.js
// Also invoked from test/smoke.js so `npm test` covers it.
import assert from 'node:assert/strict';
import { toPdfSpace } from '../server/coords.js';

const field = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
const pageSize = { width: 200, height: 100 };

let failed = false;
function check(name, actual, expected) {
  try {
    assert.equal(Math.round(actual.x * 1000) / 1000, expected.x);
    assert.equal(Math.round(actual.y * 1000) / 1000, expected.y);
    assert.equal(Math.round(actual.w * 1000) / 1000, expected.w);
    assert.equal(Math.round(actual.h * 1000) / 1000, expected.h);
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed = true;
    console.error(`  FAIL  ${name}: ${err.message}`);
  }
}

console.log('coords.js unit tests (0/90/180/270 rotation)\n');

check('rotation 0', toPdfSpace(field, 0, pageSize), { x: 20, y: 70, w: 60, h: 10 });
check('rotation 90', toPdfSpace(field, 90, pageSize), { x: 40, y: 10, w: 20, h: 30 });
check('rotation 180', toPdfSpace(field, 180, pageSize), { x: 120, y: 20, w: 60, h: 10 });
check('rotation 270', toPdfSpace(field, 270, pageSize), { x: 140, y: 60, w: 20, h: 30 });

// negative / overflowing rotation values normalize the same as their mod-360 equivalent
check('rotation -270 === rotation 90', toPdfSpace(field, -270, pageSize), { x: 40, y: 10, w: 20, h: 30 });
check('rotation 450 === rotation 90', toPdfSpace(field, 450, pageSize), { x: 40, y: 10, w: 20, h: 30 });

// full-page field (0,0,1,1) must map to the full page regardless of rotation
for (const rot of [0, 90, 180, 270]) {
  check(`full-page field @ rotation ${rot}`, toPdfSpace({ x: 0, y: 0, w: 1, h: 1 }, rot, pageSize), { x: 0, y: 0, w: 200, h: 100 });
}

console.log('');
if (failed) {
  console.error('COORDS TEST FAILED');
  process.exit(1);
}
console.log('All coords tests passed.');
