import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { readRoster, parseDelimited, isLiveInRoom, nameKey, pledgeClassesIn } from '../roster-intake.ts';

const EXPORT_HEADER = 'First Name,Last Name,Class,Phone Number,Email,Fall Room';
const chapterExport = (...rows: string[]) => [EXPORT_HEADER, ...rows].join('\n');

describe('delimited parsing', () => {
  test('ordinary rows', () => {
    assert.deepEqual(parseDelimited('a,b,c\n1,2,3'), [
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  test('a quoted field containing a newline', () => {
    // The chapter export does this for brothers with two email addresses.
    const rows = parseDelimited('a,b\n"line1\nline2",z');
    assert.equal(rows.length, 2);
    assert.equal(rows[1][0], 'line1\nline2');
    assert.equal(rows[1][1], 'z');
  });

  test('quoted commas and escaped quotes', () => {
    assert.equal(parseDelimited('a\n"Smith, John"')[1][0], 'Smith, John');
    assert.equal(parseDelimited('a\n"say ""hi"""')[1][0], 'say "hi"');
  });

  test('CRLF and blank rows', () => {
    assert.deepEqual(parseDelimited('a,b\r\n\r\n1,2\r\n'), [
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  test('tabs, as pasted from a spreadsheet', () => {
    assert.deepEqual(parseDelimited('a\tb\n1\t2', '\t')[1], ['1', '2']);
  });
});

describe('living in', () => {
  test('a room starting with a digit is in the house', () => {
    assert.ok(isLiveInRoom('210'));
    assert.ok(isLiveInRoom(' 109 '));
    assert.ok(isLiveInRoom('3B'));
  });

  test('anything else is not', () => {
    for (const r of ['Senior Live-Out', 'Chandler Plan', 'coop 1st sem', '', undefined]) {
      assert.ok(!isLiveInRoom(r), String(r));
    }
  });
});

describe('the chapter export', () => {
  test('reads names, pledge class and room, and ignores contact details', () => {
    const r = readRoster(
      chapterExport(
        'Noah,Brenner,Alpha Kappa,(555) 010-2344,secret@x.com,219',
        'Liam,O’Dell,Alpha Mu,(555) 010-0658,"a@x.com\nb@x.com",218',
      ),
    );
    assert.equal(r.format, 'table');
    assert.deepEqual(r.problems, []);
    assert.deepEqual(
      r.rows.map((m) => [m.name, m.pledgeClass, m.room, m.classYear]),
      [
        ['Noah Brenner', 'Alpha Kappa', '219', undefined],
        ['Liam O’Dell', 'Alpha Mu', '218', undefined],
      ],
    );
    const serialised = JSON.stringify(r);
    assert.ok(!serialised.includes('secret@x.com'), 'email must never be read');
    assert.ok(!serialised.includes('579'), 'phone must never be read');
    assert.deepEqual(r.columns, { classYear: false, pledgeClass: true, room: true, crew: false });
  });

  test('pledge classes needing a year are listed once each, sorted', () => {
    const r = readRoster(
      chapterExport('A,One,Alpha Mu,,,1', 'B,Two,Alpha Kappa,,,2', 'C,Three,Alpha Mu,,,3'),
    );
    assert.deepEqual(pledgeClassesIn(r), ['Alpha Kappa', 'Alpha Mu']);
  });

  test('trims stray spaces in names', () => {
    const r = readRoster(chapterExport('Jonah ,Carver,Alpha Kappa,,,109'));
    assert.equal(r.rows[0].name, 'Jonah Carver');
  });

  test('a duplicate is reported, not imported twice', () => {
    const r = readRoster(chapterExport('Noah,Brenner,Alpha Kappa,,,219', 'Noah,Brenner,Alpha Kappa,,,219'));
    assert.equal(r.rows.length, 1);
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0].reason, /twice/);
  });
});

describe('hand-made tables', () => {
  test('a "Class" column full of years is read as the year', () => {
    const r = readRoster('Name,Class,Room\nJake Meyerson,Junior,204\nBen Cohen,Sr,301\nNoah Berger,soph,112');
    assert.deepEqual(
      r.rows.map((m) => [m.name, m.classYear]),
      [
        ['Jake Meyerson', 'junior'],
        ['Ben Cohen', 'senior'],
        ['Noah Berger', 'sophomore'],
      ],
    );
    assert.equal(r.columns.pledgeClass, false);
  });

  test('columns in any order, with a crew column', () => {
    const r = readRoster('Crew\tRoom\tFull name\tYear\nlunch\t204\tJake Meyerson\tsenior\nexempt\t\tBen Cohen\tjunior');
    assert.deepEqual(r.rows[0], { line: 2, name: 'Jake Meyerson', classYear: 'senior', room: '204', crew: 'lunch' });
    assert.equal(r.rows[1].crew, 'exempt');
  });

  test('an unreadable year or crew is reported and left blank', () => {
    const r = readRoster('Name,Year,Crew\nJake Meyerson,Grad,breakfast');
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].classYear, undefined);
    assert.equal(r.rows[0].crew, undefined);
    assert.equal(r.problems.length, 2);
  });
});

describe('typed lists', () => {
  test('name and year on each line, in several styles', () => {
    const r = readRoster(
      ['Jake Meyerson, Junior', 'Aaron Katz (Jr)', 'Sam Feldman - soph', 'Eli Wolf\tSenior', 'Ari Goldman fifth year'].join('\n'),
    );
    assert.equal(r.format, 'list');
    assert.deepEqual(r.problems, []);
    assert.deepEqual(
      r.rows.map((m) => [m.name, m.classYear]),
      [
        ['Jake Meyerson', 'junior'],
        ['Aaron Katz', 'junior'],
        ['Sam Feldman', 'sophomore'],
        ['Eli Wolf', 'senior'],
        ['Ari Goldman', 'fifth-year'],
      ],
    );
  });

  test('headings set the year for the names under them', () => {
    const r = readRoster('Juniors:\n- Noah Berger\n- Eli Wolf\n\nSENIORS\n1. Ben Cohen (lunch)');
    assert.deepEqual(
      r.rows.map((m) => [m.name, m.classYear, m.crew]),
      [
        ['Noah Berger', 'junior', undefined],
        ['Eli Wolf', 'junior', undefined],
        ['Ben Cohen', 'senior', 'lunch'],
      ],
    );
  });

  test('a heading with names on the same line', () => {
    const r = readRoster('Sophomores: Noah Berger, Eli Wolf');
    assert.deepEqual(
      r.rows.map((m) => [m.name, m.classYear]),
      [
        ['Noah Berger', 'sophomore'],
        ['Eli Wolf', 'sophomore'],
      ],
    );
  });

  test('a line that is not a name is reported with its line number', () => {
    const r = readRoster('Jake Meyerson\n12345\nBen Cohen');
    assert.equal(r.rows.length, 2);
    assert.deepEqual(r.problems.map((p) => p.line), [2]);
  });

  test('names without a year come through without one', () => {
    const r = readRoster('Jake Meyerson\nBen Cohen');
    assert.deepEqual(r.rows.map((m) => m.classYear), [undefined, undefined]);
  });
});

describe('matching names', () => {
  test('case, spacing, accents and apostrophes do not matter', () => {
    assert.equal(nameKey('  Liam  O’Dell '), nameKey("Liam O’Dell"));
    assert.equal(nameKey('José Núñez'), nameKey('jose nunez'));
  });
});
