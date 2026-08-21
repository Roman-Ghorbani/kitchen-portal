import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCSV,
  parseRosterCsv,
  isLiveIn,
  MAPPING_2026_27,
} from '../roster-csv.ts';

const HEADER = 'First Name,Last Name,Class,Phone Number,Email,Fall Room';

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join('\n');
}

describe('CSV parsing', () => {
  test('parses ordinary rows', () => {
    const rows = parseCSV('a,b,c\n1,2,3');
    assert.deepEqual(rows, [
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  test('handles a quoted field containing a newline', () => {
    // The real export does this for brothers with two email addresses.
    const rows = parseCSV('a,b\n"line1\nline2",z');
    assert.equal(rows.length, 2);
    assert.equal(rows[1][0], 'line1\nline2');
    assert.equal(rows[1][1], 'z');
  });

  test('handles a quoted field containing a comma', () => {
    const rows = parseCSV('a,b\n"Smith, John",x');
    assert.equal(rows[1][0], 'Smith, John');
  });

  test('handles escaped double quotes', () => {
    const rows = parseCSV('a\n"say ""hi"""');
    assert.equal(rows[1][0], 'say "hi"');
  });

  test('tolerates CRLF line endings', () => {
    const rows = parseCSV('a,b\r\n1,2\r\n');
    assert.deepEqual(rows[1], ['1', '2']);
  });

  test('drops fully blank rows', () => {
    const rows = parseCSV('a,b\n\n1,2\n\n');
    assert.equal(rows.length, 2);
  });
});

describe('live-in detection', () => {
  test('a numeric room means living in', () => {
    assert.ok(isLiveIn('210'));
    assert.ok(isLiveIn(' 109 '));
  });

  test('non-numeric room values mean living out', () => {
    assert.ok(!isLiveIn('Senior Live-Out'));
    assert.ok(!isLiveIn('Chandler Plan'));
    assert.ok(!isLiveIn('coop 1st sem'));
    assert.ok(!isLiveIn('Study Abroad'));
    assert.ok(!isLiveIn(''));
  });
});

describe('roster import', () => {
  test('maps pledge classes to duty years', () => {
    const r = parseRosterCsv(
      csv(
        'Noah,Brenner,Alpha Kappa,(555) 010-2344,n@x.com,219',
        'Max,Alder,Alpha Lambda,(555) 010-9809,m@x.com,203',
        'Daniel,Arnold,Alpha Mu,(555) 010-2194,d@x.com,307',
        'Nadav,Abrams,Alpha Nu,(555) 010-9731,a@x.com,104',
      ),
    );

    assert.equal(r.problems.length, 0);
    assert.deepEqual(
      r.members.map((m) => [m.name, m.classYear]),
      [
        ['Noah Brenner', 'junior'],
        ['Max Alder', 'junior'],
        ['Daniel Arnold', 'sophomore'],
        ['Nadav Abrams', 'sophomore'],
      ],
    );
  });

  test('excludes seniors who live out', () => {
    const r = parseRosterCsv(
      csv(
        'Noah,Brenner,Alpha Kappa,(555) 010-2344,n@x.com,219',
        'Charlie,Becker,Alpha Theta,(555) 010-5749,c@x.com,Senior Live-Out',
      ),
    );

    assert.equal(r.members.length, 1);
    assert.equal(r.excluded.length, 1);
    assert.equal(r.excluded[0].name, 'Charlie Becker');
    assert.match(r.excluded[0].reason, /not living in \(Senior Live-Out\)/);
  });

  test('excludes live-ins-on-paper who are away', () => {
    const r = parseRosterCsv(
      csv(
        'Andrew,Chen,Alpha Lambda,(555) 010-5495,a@x.com,Study Abroad',
        'Logan,Chen,Alpha Nu,(555) 010-3446,l@x.com,coop 1st sem',
        'Joseph,Becker,Alpha Mu,(555) 010-5756,j@x.com,Chandler Plan',
      ),
    );

    assert.equal(r.members.length, 0);
    assert.equal(r.excluded.length, 3);
    assert.ok(r.excluded.every((e) => /not living in/.test(e.reason)));
  });

  test('trims stray whitespace in names', () => {
    const r = parseRosterCsv(
      csv('Jonah ,Carver,Alpha Kappa,(555) 010-4609,j@x.com,109'),
    );
    assert.equal(r.members[0].name, 'Jonah Carver');
  });

  test('keeps names with apostrophes intact', () => {
    const r = parseRosterCsv(
      csv(
        'Liam,O’Dell,Alpha Kappa,(555) 010-0658,c@x.com,218',
        'Miles,Dorsey,Alpha Mu,(555) 010-5075,m@x.com,311',
      ),
    );
    assert.equal(r.members[0].name, 'Liam O’Dell');
    assert.equal(r.members[1].name, 'Miles Dorsey');
  });

  test('a multi-line quoted email does not corrupt the row', () => {
    const r = parseRosterCsv(
      csv('Liam,O’Dell,Alpha Kappa,(555) 010-0658,"a@x.com\nb@x.com",218'),
    );
    assert.equal(r.problems.length, 0);
    assert.equal(r.members.length, 1);
    assert.equal(r.members[0].room, '218');
    assert.equal(r.members[0].classYear, 'junior');
  });

  test('contact details are not carried into the result', () => {
    const r = parseRosterCsv(
      csv('Noah,Brenner,Alpha Kappa,(555) 010-2344,secret@x.com,219'),
    );
    const serialized = JSON.stringify(r.members);
    assert.ok(!serialized.includes('secret@x.com'), 'email must not be imported');
    assert.ok(!serialized.includes('260'), 'phone must not be imported');
  });

  test('flags duplicates rather than importing twice', () => {
    const r = parseRosterCsv(
      csv(
        'Noah,Brenner,Alpha Kappa,(555) 010-2344,n@x.com,219',
        'Noah,Brenner,Alpha Kappa,(555) 010-2344,n@x.com,219',
      ),
    );
    assert.equal(r.members.length, 1);
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0].reason, /duplicate/);
  });

  test('an unrecognized pledge class is excluded, not guessed at', () => {
    const r = parseRosterCsv(
      csv('Some,Guy,Alpha Omicron,(111) 111-1111,s@x.com,101'),
    );
    assert.equal(r.members.length, 0);
    assert.match(r.excluded[0].reason, /not on the duty roster/);
  });

  test('a missing required column is reported', () => {
    const r = parseRosterCsv('First Name,Last Name\nNoah,Brenner');
    assert.equal(r.members.length, 0);
    assert.match(r.problems[0].reason, /missing column/);
    assert.match(r.problems[0].reason, /Fall Room/);
  });
});

describe('per-person class year overrides', () => {
  // Some brothers rushed as sophomores and so are a year older than the rest
  // of their pledge class. The pledge class is a default, not a rule.
  test('an override beats the pledge class default', () => {
    const r = parseRosterCsv(
      csv(
        'Noah,Brenner,Alpha Mu,(555) 010-2344,n@x.com,219',
        'Max,Alder,Alpha Mu,(555) 010-9809,m@x.com,203',
      ),
      { overrides: { 'Noah Brenner': 'junior' } },
    );

    const byName = Object.fromEntries(r.members.map((m) => [m.name, m.classYear]));
    assert.equal(byName['Noah Brenner'], 'junior', 'override should apply');
    assert.equal(byName['Max Alder'], 'sophomore', 'others keep the default');
  });

  test('applied overrides are reported for confirmation', () => {
    const r = parseRosterCsv(
      csv('Noah,Brenner,Alpha Mu,(555) 010-2344,n@x.com,219'),
      { overrides: { 'Noah Brenner': 'junior' } },
    );

    assert.deepEqual(r.appliedOverrides, [
      { name: 'Noah Brenner', from: 'sophomore', to: 'junior' },
    ]);
  });

  test('override matching ignores case and stray spacing', () => {
    const r = parseRosterCsv(
      csv('Jonah ,Carver,Alpha Mu,(555) 010-4609,j@x.com,109'),
      { overrides: { '  Jonah Carver ': 'junior' } },
    );
    assert.equal(r.members[0].classYear, 'junior');
    assert.deepEqual(r.unmatchedOverrides, []);
  });

  test('an override naming nobody is surfaced, not silently dropped', () => {
    const r = parseRosterCsv(
      csv('Noah,Brenner,Alpha Mu,(555) 010-2344,n@x.com,219'),
      { overrides: { 'Noah Brennan': 'junior' } }, // misspelled
    );

    assert.equal(r.members[0].classYear, 'sophomore', 'default still applied');
    assert.deepEqual(r.unmatchedOverrides, ['Noah Brennan']);
  });

  test('an override can pull in someone whose pledge class is off-roster', () => {
    // A senior pledge class who is nonetheless living in and on duty.
    const r = parseRosterCsv(
      csv('Ben,Gould,Alpha Iota,(555) 010-2050,b@x.com,205'),
      { overrides: { 'Ben Gould': 'junior' } },
    );

    assert.equal(r.members.length, 1);
    assert.equal(r.members[0].classYear, 'junior');
    assert.equal(r.excluded.length, 0);
  });

  test('an override does not resurrect someone who lives out', () => {
    // Residency is decided by the room column and is not what the override is
    // for; someone who moved out should stay off the roster.
    const r = parseRosterCsv(
      csv('Charlie,Becker,Alpha Theta,(555) 010-5749,c@x.com,Senior Live-Out'),
      { overrides: { 'Charlie Becker': 'junior' } },
    );

    assert.equal(r.members.length, 0);
    assert.equal(r.excluded.length, 1);
  });

  test('no overrides means nothing reported', () => {
    const r = parseRosterCsv(csv('Noah,Brenner,Alpha Kappa,(1) 1,n@x.com,219'));
    assert.deepEqual(r.appliedOverrides, []);
    assert.deepEqual(r.unmatchedOverrides, []);
  });
});

describe('the 2026-27 mapping', () => {
  test('seniors are absent from both duty years', () => {
    const all = [...MAPPING_2026_27.junior, ...MAPPING_2026_27.sophomore];
    assert.ok(!all.includes('Alpha Theta'));
    assert.ok(!all.includes('Alpha Iota'));
  });

  test('no pledge class is in both years', () => {
    const overlap = MAPPING_2026_27.junior.filter((c) =>
      MAPPING_2026_27.sophomore.includes(c),
    );
    assert.deepEqual(overlap, []);
  });
});
