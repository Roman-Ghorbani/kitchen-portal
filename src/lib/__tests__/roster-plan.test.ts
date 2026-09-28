import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { readRoster } from '../roster-intake.ts';
import {
  planImport,
  placement,
  DEFAULT_ROSTER_DEFAULTS,
  type CurrentMember,
  type ImportOptions,
} from '../roster-plan.ts';

const opts = (o: Partial<ImportOptions> = {}): ImportOptions => ({
  pledgeYears: {},
  liveInOnly: true,
  removeMissing: false,
  resetCrews: false,
  ...o,
});

const member = (name: string, o: Partial<CurrentMember> = {}): CurrentMember => ({
  id: `id-${name}`,
  name,
  classYear: 'junior',
  rotation: 'lunch',
  exempt: false,
  exemptReason: null,
  room: null,
  pledgeClass: null,
  active: true,
  ...o,
});

describe('placement', () => {
  test('each year gets its default crew', () => {
    assert.deepEqual(placement('junior', undefined, DEFAULT_ROSTER_DEFAULTS), {
      rotation: 'lunch',
      exempt: false,
      exemptReason: null,
    });
    assert.equal(placement('sophomore', undefined, DEFAULT_ROSTER_DEFAULTS).rotation, 'dinner');
  });

  test('seniors are exempt as seniors by default', () => {
    const p = placement('senior', undefined, DEFAULT_ROSTER_DEFAULTS);
    assert.equal(p.exempt, true);
    assert.equal(p.exemptReason, 'senior');
  });

  test('an explicit crew wins over the year', () => {
    // A live-in senior who is on duty; a sophomore who is really a junior.
    assert.deepEqual(placement('senior', 'lunch', DEFAULT_ROSTER_DEFAULTS), {
      rotation: 'lunch',
      exempt: false,
      exemptReason: null,
    });
    assert.equal(placement('sophomore', 'lunch', DEFAULT_ROSTER_DEFAULTS).rotation, 'lunch');
  });

  test('house defaults are respected', () => {
    const defaults = { ...DEFAULT_ROSTER_DEFAULTS, crewForYear: { ...DEFAULT_ROSTER_DEFAULTS.crewForYear, senior: 'dinner' as const } };
    assert.equal(placement('senior', undefined, defaults).exempt, false);
  });
});

describe('planning an import', () => {
  test('new people are added on their default crew', () => {
    const plan = planImport(readRoster('Jake Meyerson, Junior\nBen Cohen, Senior'), [], DEFAULT_ROSTER_DEFAULTS, opts());
    assert.deepEqual(
      plan.add.map((a) => [a.name, a.classYear, a.placement.rotation, a.placement.exempt]),
      [
        ['Jake Meyerson', 'junior', 'lunch', false],
        ['Ben Cohen', 'senior', 'dinner', true],
      ],
    );
  });

  test('someone with no year is added as "other" and flagged', () => {
    const plan = planImport(readRoster('Jake Meyerson'), [], DEFAULT_ROSTER_DEFAULTS, opts());
    assert.equal(plan.add[0].classYear, 'other');
    assert.equal(plan.add[0].yearGuessed, true);
  });

  test('pledge classes are mapped to years, or skipped', () => {
    const csv = 'First Name,Last Name,Class,Fall Room\nA,One,Alpha Mu,101\nB,Two,Alpha Theta,102';
    const plan = planImport(readRoster(csv), [], DEFAULT_ROSTER_DEFAULTS, opts({ pledgeYears: { 'Alpha Mu': 'sophomore', 'Alpha Theta': 'skip' } }));
    assert.deepEqual(plan.add.map((a) => [a.name, a.classYear]), [['A One', 'sophomore']]);
    assert.equal(plan.skipped.length, 1);
    assert.match(plan.skipped[0].reason, /Alpha Theta/);
  });

  test('live-outs are skipped when only live-ins are wanted', () => {
    const csv = 'Name,Year,Room\nIn House,Junior,210\nOut House,Senior,Senior Live-Out';
    const plan = planImport(readRoster(csv), [], DEFAULT_ROSTER_DEFAULTS, opts());
    assert.deepEqual(plan.add.map((a) => a.name), ['In House']);
    assert.match(plan.skipped[0].reason, /lives out/);

    const all = planImport(readRoster(csv), [], DEFAULT_ROSTER_DEFAULTS, opts({ liveInOnly: false }));
    assert.equal(all.add.length, 2);
  });

  test('an existing member keeps his crew unless the file names one', () => {
    // He was moved to dinner by hand; a re-import of the year must not undo it.
    const current = [member('Jake Meyerson', { rotation: 'dinner' })];
    const plan = planImport(readRoster('Jake Meyerson, Junior'), current, DEFAULT_ROSTER_DEFAULTS, opts());
    assert.equal(plan.update.length, 0);
    assert.equal(plan.unchanged, 1);

    const withCrew = planImport(readRoster('Jake Meyerson, Junior, lunch'), current, DEFAULT_ROSTER_DEFAULTS, opts());
    assert.equal(withCrew.update[0].set.rotation, 'lunch');
  });

  test('"reset crews" puts existing members back on their year default', () => {
    const current = [member('Jake Meyerson', { classYear: 'sophomore', rotation: 'lunch' })];
    const plan = planImport(readRoster('Jake Meyerson, Sophomore'), current, DEFAULT_ROSTER_DEFAULTS, opts({ resetCrews: true }));
    assert.equal(plan.update[0].set.rotation, 'dinner');
  });

  test('changed year and room are updates, matched regardless of case', () => {
    const current = [member('Jake Meyerson', { classYear: 'sophomore', room: '101' })];
    const plan = planImport(readRoster('Name,Year,Room\njake meyerson,Junior,204'), current, DEFAULT_ROSTER_DEFAULTS, opts());
    assert.deepEqual(
      plan.update[0].changes.map((c) => [c.field, c.from, c.to]),
      [
        ['classYear', 'sophomore', 'junior'],
        ['room', '101', '204'],
      ],
    );
  });

  test('someone who was taken off the roster is put back, not duplicated', () => {
    const current = [member('Jake Meyerson', { active: false })];
    const plan = planImport(readRoster('Jake Meyerson, Junior'), current, DEFAULT_ROSTER_DEFAULTS, opts());
    assert.equal(plan.add.length, 0);
    assert.equal(plan.update[0].set.active, true);
  });

  test('people missing from the file are removed only when asked', () => {
    const current = [member('Jake Meyerson'), member('Gone Guy'), member('Already Off', { active: false })];
    const text = 'Jake Meyerson, Junior';
    assert.equal(planImport(readRoster(text), current, DEFAULT_ROSTER_DEFAULTS, opts()).remove.length, 0);
    const plan = planImport(readRoster(text), current, DEFAULT_ROSTER_DEFAULTS, opts({ removeMissing: true }));
    assert.deepEqual(plan.remove.map((r) => r.name), ['Gone Guy']);
  });

  test('a skipped live-out is not then treated as missing... unless asked to remove', () => {
    // Somebody who moved out shows up with a live-out room: skipped, and with
    // removeMissing he comes off the roster, which is what the manager wants.
    const current = [member('Out House')];
    const csv = 'Name,Year,Room\nOut House,Senior,Senior Live-Out';
    const plan = planImport(readRoster(csv), current, DEFAULT_ROSTER_DEFAULTS, opts({ removeMissing: true }));
    assert.deepEqual(plan.remove.map((r) => r.name), ['Out House']);
  });
});
