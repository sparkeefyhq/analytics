import test from 'node:test';
import assert from 'node:assert/strict';
import { countText, observation, statusText, groups } from '../vercel-static/src/phase0-data.ts';
test('missing and pending data never becomes measured zero', () => {
  assert.equal(countText(), '—');
  assert.equal(countText({count:0,status:'pending',source:'posthog'}), '—');
  assert.equal(countText({count:0,status:'available',source:'posthog'}), '0');
  assert.equal(countText({count:1,status:'available',source:'posthog'}), '1');
  for (const count of [null,undefined,NaN,-1,1.2,Infinity]) assert.equal(countText({count,status:'available',source:'posthog'}),'—');
});
test('unknown schema or another cohort cannot populate Phase 0', () => {
  const sample={version:1,cohort:'phase-0',metrics:{onboarding:{count:7,status:'available',source:'posthog'}}};
  assert.equal(countText(observation(sample,'onboarding')),'7');
  assert.equal(observation({...sample,cohort:'phase-1a'},'onboarding'),undefined);
  assert.equal(observation({...sample,version:2},'onboarding'),undefined);
  assert.equal(statusText({status:'error'}),'Source unavailable');
});
test('milestones keep unique stable connector IDs without ratings', () => {
  const ids=groups.flatMap(group=>group.rows.map(row=>row[0]));
  assert.equal(new Set(ids).size,ids.length);
  assert.ok(!ids.some(id=>/rat(ing|ed)/.test(id)));
});
