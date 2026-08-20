import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseRoster } from '../roster-import.ts';

describe('delimited formats', () => {
  test('comma-separated name and year', () => {
    const r = parseRoster('Jake Meyerson, Junior\nBen Cohen, Sophomore');
    assert.equal(r.problems.length, 0);
    assert.deepEqual(
      r.members.map((m) => [m.name, m.classYear]),
      [
        ['Jake Meyerson', 'junior'],
        ['Ben Cohen', 'sophomore'],
      ],
    );
  });

  test('tab-separated, as pasted from a spreadsheet', () => {
    const r = parseRoster('Aaron Katz\tJunior\nEthan Rosen\tSophomore');
    assert.equal(r.problems.length, 0);
    assert.equal(r.members.length, 2);
    assert.equal(r.members[1].classYear, 'sophomore');
  });

  test('abbreviations and parentheses', () => {
    const r = parseRoster('Aaron Katz (Jr)\nSam Feldman - soph\nEli Wolf | JUNIOR');
    assert.equal(r.problems.length, 0);
    assert.deepEqual(
      r.members.map((m) => m.classYear),
      ['junior', 'sophomore', 'junior'],
    );
    assert.equal(r.members[0].name, 'Aaron Katz');
    assert.equal(r.members[1].name, 'Sam Feldman');
  });

  test('space-separated with year as the trailing word', () => {
    const r = parseRoster('Noah Berger Junior\nJosh Adler Sophomore');
    assert.equal(r.problems.length, 0);
    assert.equal(r.members[0].name, 'Noah Berger');
    assert.equal(r.members[0].classYear, 'junior');
  });
});

describe('section headings', () => {
  test('names inherit the year from the heading above them', () => {
    const r = parseRoster(
      ['Juniors:', 'Noah Berger', 'Eli Wolf', '', 'Sophomores:', 'Josh Adler'].join(
        '\n',
      ),
    );
    assert.equal(r.problems.length, 0);
    assert.deepEqual(
      r.members.map((m) => [m.name, m.classYear]),
      [
        ['Noah Berger', 'junior'],
        ['Eli Wolf', 'junior'],
        ['Josh Adler', 'sophomore'],
      ],
    );
  });

  test('heading without a colon works', () => {
    const r = parseRoster('SOPHOMORES\nTyler Gross\nCole Bernstein');
    assert.equal(r.problems.length, 0);
    assert.equal(r.members.length, 2);
    assert.ok(r.members.every((m) => m.classYear === 'sophomore'));
  });

  test('heading and names on the same line', () => {
    const r = parseRoster('Juniors: Noah Berger, Eli Wolf, Nathan Fine');
    assert.equal(r.problems.length, 0);
    assert.equal(r.members.length, 3);
    assert.ok(r.members.every((m) => m.classYear === 'junior'));
    assert.equal(r.members[2].name, 'Nathan Fine');
  });

  test('bulleted and numbered lists under a heading', () => {
    const r = parseRoster(
      ['Juniors:', '  - Noah Berger', '  * Eli Wolf', '  1. Nathan Fine'].join('\n'),
    );
    assert.equal(r.problems.length, 0);
    assert.deepEqual(r.members.map((m) => m.name), [
      'Noah Berger',
      'Eli Wolf',
      'Nathan Fine',
    ]);
  });

  test('an explicit year on a line overrides the section heading', () => {
    const r = parseRoster('Juniors:\nNoah Berger\nJosh Adler, Sophomore');
    assert.equal(r.members[0].classYear, 'junior');
    assert.equal(r.members[1].classYear, 'sophomore');
  });
});

describe('mixed and messy input', () => {
  test('handles a paste that mixes every supported shape', () => {
    const r = parseRoster(
      [
        'Name\tClass Year',
        'Jake Meyerson, Junior',
        '',
        'Sophomores:',
        '  Ben Cohen',
        '  Ethan Rosen',
        'Aaron Katz (Jr)',
        'Juniors: Eli Wolf, Nathan Fine',
      ].join('\n'),
    );
    assert.equal(r.problems.length, 0, JSON.stringify(r.problems));
    assert.equal(r.members.length, 6);
    const byName = Object.fromEntries(r.members.map((m) => [m.name, m.classYear]));
    assert.equal(byName['Jake Meyerson'], 'junior');
    assert.equal(byName['Ben Cohen'], 'sophomore');
    assert.equal(byName['Ethan Rosen'], 'sophomore');
    assert.equal(byName['Aaron Katz'], 'junior');
    assert.equal(byName['Eli Wolf'], 'junior');
  });

  test('skips a spreadsheet header row', () => {
    const r = parseRoster('Name, Class Year\nJake Meyerson, Junior');
    assert.equal(r.members.length, 1);
    assert.equal(r.problems.length, 0);
  });

  test('blank lines are ignored', () => {
    const r = parseRoster('\n\nJake Meyerson, Junior\n\n\nBen Cohen, Sophomore\n\n');
    assert.equal(r.members.length, 2);
    assert.equal(r.problems.length, 0);
  });
});

describe('reporting rather than silently dropping', () => {
  test('a line with no year and no heading is reported, not discarded', () => {
    const r = parseRoster('Jake Meyerson, Junior\nSomeGuy');
    assert.equal(r.members.length, 1);
    assert.equal(r.problems.length, 1);
    assert.equal(r.problems[0].line, 2);
    assert.match(r.problems[0].reason, /no class year/);
  });

  test('duplicates are separated out rather than double-added', () => {
    const r = parseRoster(
      'Jake Meyerson, Junior\nBen Cohen, Sophomore\njake meyerson, Junior',
    );
    assert.equal(r.members.length, 2);
    assert.equal(r.duplicates.length, 1);
    assert.equal(r.duplicates[0].line, 3);
  });

  test('a freshman or senior line is reported, since they are not on duty', () => {
    const r = parseRoster('Jake Meyerson, Junior\nKyle Frosh, Freshman');
    assert.equal(r.members.length, 1);
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0].text, /Freshman/);
  });

  test('problem lines carry their original text for display', () => {
    const r = parseRoster('???');
    assert.equal(r.problems[0].text, '???');
  });
});

describe('realistic scale', () => {
  /** Digit-free surnames - the parser rejects names containing numbers. */
  const surname = (i: number): string => {
    const a = 'abcdefghijklmnopqrstuvwxyz';
    return (
      'Berg' +
      a[Math.floor(i / 26) % 26] +
      a[i % 26]
    ).replace(/^(.)/, (c) => c.toUpperCase());
  };

  test('parses a 58-person roster', () => {
    const juniors = Array.from({ length: 28 }, (_, i) => `Noah ${surname(i)}`);
    const sophomores = Array.from({ length: 30 }, (_, i) => `Josh ${surname(i + 100)}`);
    const text = [
      'Juniors:',
      ...juniors,
      '',
      'Sophomores:',
      ...sophomores,
    ].join('\n');

    const r = parseRoster(text);
    assert.equal(r.problems.length, 0);
    assert.equal(r.members.length, 58);
    assert.equal(r.members.filter((m) => m.classYear === 'junior').length, 28);
    assert.equal(r.members.filter((m) => m.classYear === 'sophomore').length, 30);
  });
});
