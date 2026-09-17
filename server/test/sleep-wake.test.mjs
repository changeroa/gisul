import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sleepWakeEvidence } from '../diagnose-sleep-wake.mjs';
const since=Date.parse('2026-09-17T02:00:00Z');
test('only actual sleep followed by full wake after arming satisfies the observation',()=>{
  const noise='2026-09-17 11:01:00 +0900 Assertions     PID 1 Summary PreventUserIdleSystemSleep "Video Wake Lock"';
  const sleep='2026-09-17 11:02:00 +0900 Sleep          Entering Sleep state due to Clamshell Sleep';
  const dark='2026-09-17 11:02:30 +0900 DarkWake       DarkWake from Normal Sleep';
  const wake='2026-09-17 11:03:00 +0900 Wake           Wake from Normal Sleep due to Lid Open';
  assert.equal(sleepWakeEvidence(noise+'\n'+dark,since),null);
  assert.equal(sleepWakeEvidence(wake+'\n'+sleep,since+150000),null);
  assert.equal(sleepWakeEvidence(sleep+'\n'+dark,since),null);
  const result=sleepWakeEvidence([noise,sleep,dark,wake].join('\n'),since);
  assert.equal(result.sleep.time,'2026-09-17T02:02:00.000Z');
  assert.equal(result.wake.time,'2026-09-17T02:03:00.000Z');
});
