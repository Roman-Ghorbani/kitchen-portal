/**
 * Everything the manager does to the roster, as plain functions that take the
 * acting manager's name. The server actions in app/actions/roster-actions.ts
 * are thin wrappers that check the session and refresh pages; keeping the
 * work here means the test suite can drive it against a real database.
 *
 * Every change writes an audit event against each member it touched, so a
 * brother's record page shows the change even when it came from a bulk
 * action, and every bulk action runs in one transaction: it happens to
 * everybody or to nobody.
 */

import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';

import { db } from '../db/index.ts';
import { members, events, assignments, CLASS_YEARS, EXEMPT_REASONS } from '../db/schema.ts';
import {
  CLASS_YEAR_LABELS,
  ROTATION_LABELS,
  EXEMPT_REASON_LABELS,
  formatPoints,
  type ClassYear,
  type ExemptReason,
  type Meal,
} from './types.ts';
import { checkAmount, describeOp, planPoints, type PointOp, type PointsPlan } from './points-ops.ts';
import { readRoster, nameKey, normaliseName, pledgeClassesIn, type IntakeResult } from './roster-intake.ts';
import {
  planImport,
  placement,
  type ImportOptions,
  type ImportPlan,
  type CrewDefault,
  type RosterDefaults,
} from './roster-plan.ts';
import { getRosterDefaults, saveRosterDefaults } from './roster-defaults.ts';

export interface RosterResult {
  ok: boolean;
  message: string;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** An audit row written inside a transaction, so it commits with the change. */
function logIn(
  tx: Tx,
  actor: string,
  action: string,
  memberId: string | null,
  summary: string,
  payload?: unknown,
) {
  tx.insert(events)
    .values({
      action,
      entityType: memberId ? 'member' : 'roster',
      entityId: memberId,
      actorRole: 'manager',
      actorName: actor,
      summary,
      payload: payload ?? null,
    })
    .run();
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const isClassYear = (v: unknown): v is ClassYear => (CLASS_YEARS as readonly unknown[]).includes(v);
const isReason = (v: unknown): v is ExemptReason => (EXEMPT_REASONS as readonly unknown[]).includes(v);
const isMeal = (v: unknown): v is Meal => v === 'lunch' || v === 'dinner';

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

export interface ProfileInput {
  name: string;
  classYear: ClassYear;
  room: string;
  pledgeClass: string;
  slackUserId: string;
  managerNotes: string;
}

const SLACK_ID = /^[UW][A-Z0-9]{6,15}$/;

/** Checks and tidies a name; returns an error, or null if it is fine. */
async function checkName(name: string, exceptId?: string): Promise<string | null> {
  if (name.length < 2 || name.length > 60) return 'Names are 2 to 60 characters.';
  const others = await db.select({ id: members.id, name: members.name }).from(members);
  const clash = others.find((m) => m.id !== exceptId && nameKey(m.name) === nameKey(name));
  return clash ? `${clash.name} is already on the roster (or was - check "Off roster").` : null;
}

export function cleanSlackId(raw: string): string | null | 'invalid' {
  const v = raw.trim().toUpperCase();
  if (!v) return null;
  return SLACK_ID.test(v) ? v : 'invalid';
}

export async function updateProfile(actor: string, id: string, input: ProfileInput): Promise<RosterResult> {
  const [m] = await db.select().from(members).where(eq(members.id, id)).limit(1);
  if (!m) return { ok: false, message: 'No such member.' };

  const name = normaliseName(input.name);
  const nameError = name === m.name ? null : await checkName(name, id);
  if (nameError) return { ok: false, message: nameError };
  if (!isClassYear(input.classYear)) return { ok: false, message: 'Pick a class year.' };

  const slack = cleanSlackId(input.slackUserId);
  if (slack === 'invalid') {
    return { ok: false, message: 'A Slack member ID looks like U01ABC23DEF (Profile → ⋯ → Copy member ID).' };
  }

  const next = {
    name,
    classYear: input.classYear,
    room: input.room.trim().slice(0, 20) || null,
    pledgeClass: input.pledgeClass.trim().slice(0, 40) || null,
    slackUserId: slack,
    managerNotes: input.managerNotes.trim().slice(0, 1000) || null,
  };

  const labels: Record<keyof typeof next, string> = {
    name: 'name',
    classYear: 'class',
    room: 'room',
    pledgeClass: 'pledge class',
    slackUserId: 'Slack ID',
    managerNotes: 'notes',
  };
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => (m[k] ?? null) !== next[k]);
  if (!changed.length) return { ok: true, message: 'Nothing changed.' };

  db.transaction((tx) => {
    tx.update(members).set(next).where(eq(members.id, id)).run();
    logIn(
      tx,
      actor,
      'roster.profile_updated',
      id,
      `${actor} updated ${name}'s ${changed.map((k) => labels[k]).join(', ')}` +
        (changed.includes('name') ? ` (was ${m.name})` : ''),
      // Notes stay out of the log: they are private to the manager's page.
      Object.fromEntries(changed.filter((k) => k !== 'managerNotes').map((k) => [k, { from: m[k], to: next[k] }])),
    );
  });
  return { ok: true, message: `Saved ${name}'s profile.` };
}

/* ------------------------------------------------------------------ */
/* Duty: rotation and exemption                                        */
/* ------------------------------------------------------------------ */

/** Lunch rotation, dinner rotation, or exempt with a reason. */
export type Duty = { kind: 'crew'; crew: Meal } | { kind: 'exempt'; reason: ExemptReason; notes?: string };

export function dutyLabel(d: { rotation: Meal; exempt: boolean; exemptReason: ExemptReason | null }): string {
  return d.exempt
    ? `exempt (${EXEMPT_REASON_LABELS[d.exemptReason ?? 'other'].toLowerCase()})`
    : ROTATION_LABELS[d.rotation].toLowerCase();
}

/**
 * Puts people on a rotation or exempts them. Putting an exempt brother on a rotation
 * lifts the exemption; exempting keeps his rotation for when he comes back.
 * Weeks already posted are not touched.
 */
export async function setDuty(actor: string, ids: string[], duty: Duty): Promise<RosterResult> {
  if (!ids.length) return { ok: false, message: 'Nobody selected.' };
  if (duty.kind === 'crew' && !isMeal(duty.crew)) return { ok: false, message: 'Pick lunch or dinner.' };
  if (duty.kind === 'exempt' && !isReason(duty.reason)) return { ok: false, message: 'Pick a reason.' };

  const rows = await db.select().from(members).where(inArray(members.id, ids));
  const notes = duty.kind === 'exempt' ? duty.notes?.trim().slice(0, 200) || null : null;

  let moved = 0;
  db.transaction((tx) => {
    for (const m of rows) {
      const set =
        duty.kind === 'crew'
          ? { rotation: duty.crew, exempt: false, exemptReason: null, exemptNotes: null }
          : { exempt: true, exemptReason: duty.reason, exemptNotes: notes };
      const after = { rotation: m.rotation, ...set };
      const from = dutyLabel(m);
      const to = dutyLabel(after);
      if (from === to && (m.exemptNotes ?? null) === (after.exemptNotes ?? null)) continue;

      tx.update(members).set(set).where(eq(members.id, m.id)).run();
      logIn(
        tx,
        actor,
        duty.kind === 'exempt' ? 'roster.exempted' : m.exempt ? 'roster.unexempted' : 'roster.crew_changed',
        m.id,
        `${actor} moved ${m.name} from ${from} to ${to}` + (notes ? ` - "${notes}"` : ''),
        { from, to, notes },
      );
      moved++;
    }
  });

  const what =
    duty.kind === 'crew' ? `on the ${ROTATION_LABELS[duty.crew].toLowerCase()}` : 'exempt';
  if (!moved) return { ok: true, message: `Already ${what}.` };
  return {
    ok: true,
    message:
      rows.length === 1
        ? `${rows[0].name} is now ${what}. Weeks already posted are unchanged.`
        : `${plural(moved, 'brother')} now ${what}. Weeks already posted are unchanged.`,
  };
}

/* ------------------------------------------------------------------ */
/* Points                                                              */
/* ------------------------------------------------------------------ */

export type PointsScope = 'selected' | 'on-duty' | 'lunch' | 'dinner' | 'everyone';

export const POINTS_SCOPE_LABELS: Record<PointsScope, string> = {
  selected: 'Selected brothers',
  'on-duty': 'Everyone on duty',
  lunch: 'Lunch rotation',
  dinner: 'Dinner rotation',
  everyone: 'Everyone on the roster (exempt too)',
};

async function scopeMembers(scope: PointsScope, ids: string[]) {
  const all = await db
    .select({
      id: members.id,
      name: members.name,
      points: members.points,
      rotation: members.rotation,
      exempt: members.exempt,
    })
    .from(members)
    .where(eq(members.active, true))
    .orderBy(asc(members.name));
  switch (scope) {
    case 'selected': {
      const want = new Set(ids);
      return all.filter((m) => want.has(m.id));
    }
    case 'on-duty':
      return all.filter((m) => !m.exempt);
    case 'lunch':
    case 'dinner':
      return all.filter((m) => !m.exempt && m.rotation === scope);
    case 'everyone':
      return all;
  }
}

export async function previewPoints(
  scope: PointsScope,
  ids: string[],
  op: PointOp,
  amount: number,
): Promise<{ ok: boolean; message: string; plan?: PointsPlan }> {
  const bad = checkAmount(op, amount);
  if (bad) return { ok: false, message: bad };
  const people = await scopeMembers(scope, ids);
  if (!people.length) return { ok: false, message: 'Nobody is in that group.' };
  const plan = planPoints(people, op, amount);
  return {
    ok: true,
    message: plan.changes.length
      ? `${plural(plan.changes.length, 'brother')} would change.`
      : 'That would not change anybody.',
    plan,
  };
}

export async function applyPoints(
  actor: string,
  scope: PointsScope,
  ids: string[],
  op: PointOp,
  amount: number,
  reason: string,
): Promise<RosterResult> {
  const why = reason.trim().slice(0, 200);
  if (!why) return { ok: false, message: 'Say why - it goes on everyone’s record.' };
  const preview = await previewPoints(scope, ids, op, amount);
  if (!preview.plan) return preview;
  const { changes, rebasedBy } = preview.plan;
  if (!changes.length) return { ok: true, message: 'Nothing to change.' };

  const what = describeOp(op, amount, rebasedBy);
  db.transaction((tx) => {
    for (const c of changes) {
      tx.update(members).set({ points: c.after }).where(eq(members.id, c.id)).run();
      logIn(
        tx,
        actor,
        'roster.points_adjusted',
        c.id,
        `${actor} changed ${c.name}'s points ${formatPoints(c.before)} → ${formatPoints(c.after)} - ${why}`,
        { before: c.before, after: c.after, op, amount, reason: why },
      );
    }
    if (changes.length > 1) {
      logIn(
        tx,
        actor,
        'roster.points_bulk',
        null,
        `${actor} ${what} for ${plural(changes.length, 'brother')} (${POINTS_SCOPE_LABELS[scope].toLowerCase()}) - ${why}`,
        { scope, op, amount, rebasedBy, reason: why, count: changes.length },
      );
    }
  });

  return {
    ok: true,
    message:
      changes.length === 1
        ? `${changes[0].name}: ${formatPoints(changes[0].before)} → ${formatPoints(changes[0].after)}.`
        : `Done: ${what} for ${plural(changes.length, 'brother')}.`,
  };
}

/** One brother, plus or minus. */
export async function adjustPoints(actor: string, id: string, delta: number, reason: string): Promise<RosterResult> {
  if (delta === 0) return { ok: false, message: 'Enter an amount.' };
  return applyPoints(actor, 'selected', [id], delta > 0 ? 'add' : 'subtract', Math.abs(delta), reason);
}

export async function setMakeupDebt(actor: string, id: string, debt: number): Promise<RosterResult> {
  if (!Number.isInteger(debt) || debt < 0 || debt > 10) {
    return { ok: false, message: 'Make-up shifts owed must be between 0 and 10.' };
  }
  const [m] = await db.select().from(members).where(eq(members.id, id)).limit(1);
  if (!m) return { ok: false, message: 'No such member.' };
  if (m.makeupDebt === debt) return { ok: true, message: 'No change.' };

  db.transaction((tx) => {
    tx.update(members).set({ makeupDebt: debt }).where(eq(members.id, id)).run();
    logIn(tx, actor, 'roster.debt_set', id, `${actor} set ${m.name}'s make-up shifts owed to ${debt} (was ${m.makeupDebt})`, {
      before: m.makeupDebt,
      after: debt,
    });
  });
  return { ok: true, message: `${m.name} owes ${plural(debt, 'make-up shift')}.` };
}

/* ------------------------------------------------------------------ */
/* On and off the roster                                               */
/* ------------------------------------------------------------------ */

/**
 * Off the roster: graduated, moved out, depledged. His history, points and
 * sign-in are kept, and restoring him brings all of it back. Being off the
 * roster also signs him out, because the portal is for people in the house.
 */
export async function setActive(actor: string, ids: string[], active: boolean): Promise<RosterResult> {
  if (!ids.length) return { ok: false, message: 'Nobody selected.' };
  const rows = (await db.select().from(members).where(inArray(members.id, ids))).filter((m) => m.active !== active);
  if (!rows.length) return { ok: true, message: active ? 'Already on the roster.' : 'Already off the roster.' };

  db.transaction((tx) => {
    for (const m of rows) {
      tx.update(members)
        .set(active ? { active } : { active, sessionVersion: m.sessionVersion + 1 })
        .where(eq(members.id, m.id))
        .run();
      logIn(
        tx,
        actor,
        active ? 'roster.reactivated' : 'roster.deactivated',
        m.id,
        `${actor} ${active ? 'put' : 'took'} ${m.name} ${active ? 'back on' : 'off'} the roster`,
      );
    }
  });

  const who = rows.length === 1 ? rows[0].name : plural(rows.length, 'brother');
  return {
    ok: true,
    message: active
      ? `${who} back on the roster.`
      : `${who} off the roster. History and points are kept; restore from "Off roster" at any time.`,
  };
}

export interface NewMemberInput {
  name: string;
  classYear: ClassYear;
  /** Omitted: the default for his class year. */
  duty?: CrewDefault;
  room?: string;
  pledgeClass?: string;
  /** Starting points. Omitted: the lowest on his rotation, so he is not first in line for everything. */
  points?: number;
}

/**
 * Where a newcomer's points start. Zero would put him at the front of the
 * draw for weeks; the lowest current score on his rotation puts him level with
 * whoever has done the least.
 */
async function startingPoints(rotation: Meal): Promise<number> {
  const [row] = await db
    .select({ low: sql<number | null>`MIN(${members.points})` })
    .from(members)
    .where(and(eq(members.active, true), eq(members.exempt, false), eq(members.rotation, rotation)));
  return row?.low ?? 0;
}

export async function addMember(
  actor: string,
  input: NewMemberInput,
): Promise<RosterResult & { id?: string }> {
  const name = normaliseName(input.name);
  const nameError = await checkName(name);
  if (nameError) return { ok: false, message: nameError };
  if (!isClassYear(input.classYear)) return { ok: false, message: 'Pick a class year.' };

  const defaults = await getRosterDefaults();
  const place = placement(input.classYear, input.duty, defaults);
  const points =
    input.points !== undefined && checkAmount('set', input.points) === null
      ? input.points
      : await startingPoints(place.rotation);

  const [row] = await db
    .insert(members)
    .values({
      name,
      classYear: input.classYear,
      rotation: place.rotation,
      exempt: place.exempt,
      exemptReason: place.exemptReason,
      room: input.room?.trim() || null,
      pledgeClass: input.pledgeClass?.trim() || null,
      points,
    })
    .returning({ id: members.id });

  await db.insert(events).values({
    action: 'roster.member_added',
    entityType: 'member',
    entityId: row.id,
    actorRole: 'manager',
    actorName: actor,
    summary: `${actor} added ${name} (${CLASS_YEAR_LABELS[input.classYear].toLowerCase()}, ${dutyLabel(place)}, ${formatPoints(points)} pts)`,
    payload: { classYear: input.classYear, ...place, points },
  });
  return { ok: true, message: `${name} added - ${dutyLabel(place)}, starting on ${formatPoints(points)} points.`, id: row.id };
}

/**
 * Deletes a member outright. Only for a mistake - a typo, a wrong import -
 * so only for someone who has never been scheduled. Anyone with a shift on
 * record comes off the roster instead, which keeps the record intact.
 */
export async function deleteMember(actor: string, id: string): Promise<RosterResult> {
  const [m] = await db.select().from(members).where(eq(members.id, id)).limit(1);
  if (!m) return { ok: false, message: 'No such member.' };
  const [used] = await db
    .select({ n: sql<number>`count(*)` })
    .from(assignments)
    .where(or(eq(assignments.memberId, id), eq(assignments.coveredByMemberId, id)));
  if (used.n > 0) {
    return {
      ok: false,
      message: `${m.name} has shifts on record, so he cannot be deleted - take him off the roster instead.`,
    };
  }

  db.transaction((tx) => {
    tx.delete(members).where(eq(members.id, id)).run();
    logIn(tx, actor, 'roster.member_deleted', null, `${actor} deleted ${m.name} (never scheduled)`, {
      id,
      name: m.name,
    });
  });
  return { ok: true, message: `${m.name} deleted.` };
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

export const MAX_IMPORT_BYTES = 512 * 1024;

export interface ImportPreview {
  ok: boolean;
  message: string;
  intake?: Pick<IntakeResult, 'format' | 'problems' | 'columns'> & { rows: number };
  pledgeClasses?: string[];
  plan?: ImportPlan;
}

async function currentForPlan() {
  return db
    .select({
      id: members.id,
      name: members.name,
      classYear: members.classYear,
      rotation: members.rotation,
      exempt: members.exempt,
      exemptReason: members.exemptReason,
      room: members.room,
      pledgeClass: members.pledgeClass,
      active: members.active,
    })
    .from(members);
}

function cleanOptions(o: ImportOptions): ImportOptions {
  const pledgeYears: ImportOptions['pledgeYears'] = {};
  for (const [k, v] of Object.entries(o.pledgeYears ?? {})) {
    if (v === 'skip' || isClassYear(v)) pledgeYears[k.slice(0, 40)] = v;
  }
  return {
    pledgeYears,
    liveInOnly: !!o.liveInOnly,
    removeMissing: !!o.removeMissing,
    resetCrews: !!o.resetCrews,
  };
}

export async function previewImport(text: string, options: ImportOptions): Promise<ImportPreview> {
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, message: 'That file is too large for a roster.' };
  const intake = readRoster(text);
  if (!intake.rows.length) {
    return {
      ok: false,
      message: intake.problems.length
        ? 'No names could be read. See the lines below.'
        : 'Paste a roster or choose a file first.',
      intake: { format: intake.format, problems: intake.problems, columns: intake.columns, rows: 0 },
    };
  }
  const defaults = await getRosterDefaults();
  const opts = cleanOptions(options);
  const pledgeClasses = pledgeClassesIn(intake);
  // Pledge classes the manager has not mapped this time fall back to last time's answer.
  for (const pc of pledgeClasses) {
    if (!(pc in opts.pledgeYears) && defaults.pledgeYears[pc]) opts.pledgeYears[pc] = defaults.pledgeYears[pc];
  }
  const plan = planImport(intake, await currentForPlan(), defaults, opts);
  return {
    ok: true,
    message: `${plural(intake.rows.length, 'name')} read.`,
    intake: { format: intake.format, problems: intake.problems, columns: intake.columns, rows: intake.rows.length },
    pledgeClasses,
    plan,
  };
}

export interface ImportSelection {
  addKeys: string[];
  updateIds: string[];
  removeIds: string[];
}

/**
 * Applies the parts of the plan the manager ticked. The plan is rebuilt here
 * from the same text against the live roster, so a stale preview cannot write
 * anything the manager did not see.
 */
export async function applyImport(
  actor: string,
  text: string,
  options: ImportOptions,
  selection: ImportSelection,
): Promise<RosterResult> {
  const preview = await previewImport(text, options);
  if (!preview.plan) return preview;
  const plan = preview.plan;

  const addKeys = new Set(selection.addKeys);
  const updateIds = new Set(selection.updateIds);
  const removeIds = new Set(selection.removeIds);
  const adds = plan.add.filter((a) => addKeys.has(a.key));
  const updates = plan.update.filter((u) => updateIds.has(u.id));
  const removes = plan.remove.filter((r) => removeIds.has(r.id));
  if (!adds.length && !updates.length && !removes.length) return { ok: false, message: 'Nothing ticked to import.' };

  const startAt = { lunch: await startingPoints('lunch'), dinner: await startingPoints('dinner') };

  db.transaction((tx) => {
    for (const a of adds) {
      const [row] = tx
        .insert(members)
        .values({
          name: a.name,
          classYear: a.classYear,
          rotation: a.placement.rotation,
          exempt: a.placement.exempt,
          exemptReason: a.placement.exemptReason,
          room: a.room,
          pledgeClass: a.pledgeClass,
          points: startAt[a.placement.rotation],
        })
        .returning({ id: members.id })
        .all();
      logIn(tx, actor, 'roster.member_added', row.id, `${actor} imported ${a.name} (${CLASS_YEAR_LABELS[a.classYear].toLowerCase()}, ${dutyLabel(a.placement)})`, {
        line: a.line,
        classYear: a.classYear,
        ...a.placement,
      });
    }
    for (const u of updates) {
      tx.update(members).set(u.set).where(eq(members.id, u.id)).run();
      logIn(
        tx,
        actor,
        'roster.member_imported',
        u.id,
        `${actor} updated ${u.name} from an import: ` + u.changes.map((c) => `${c.field} ${c.from} → ${c.to}`).join('; '),
        { changes: u.changes },
      );
    }
    for (const r of removes) {
      tx.update(members).set({ active: false, sessionVersion: sql`${members.sessionVersion} + 1` }).where(eq(members.id, r.id)).run();
      logIn(tx, actor, 'roster.deactivated', r.id, `${actor} took ${r.name} off the roster (not in the imported roster)`);
    }
    logIn(
      tx,
      actor,
      'roster.imported',
      null,
      `${actor} imported a roster: ${adds.length} added, ${updates.length} updated, ${removes.length} taken off`,
      { added: adds.length, updated: updates.length, removed: removes.length },
    );
  });

  // Remember how pledge classes were mapped, so next semester's import starts there.
  const defaults = await getRosterDefaults();
  const opts = cleanOptions(options);
  if (Object.keys(opts.pledgeYears).length) {
    await saveRosterDefaults({ ...defaults, pledgeYears: { ...defaults.pledgeYears, ...opts.pledgeYears } });
  }

  const parts = [
    adds.length && `${adds.length} added`,
    updates.length && `${updates.length} updated`,
    removes.length && `${removes.length} taken off the roster`,
  ].filter(Boolean);
  return {
    ok: true,
    message: `Imported: ${parts.join(', ')}.` + (adds.length ? ' New brothers need setup codes - Roster → Not ready.' : ''),
  };
}

/* ------------------------------------------------------------------ */
/* Defaults                                                            */
/* ------------------------------------------------------------------ */

export async function updateCrewDefaults(actor: string, crewForYear: RosterDefaults['crewForYear']): Promise<RosterResult> {
  const current = await getRosterDefaults();
  const next = { ...current.crewForYear };
  for (const y of CLASS_YEARS) {
    const v = crewForYear[y];
    if (v === 'lunch' || v === 'dinner' || v === 'exempt') next[y] = v;
  }
  const changed = CLASS_YEARS.filter((y) => next[y] !== current.crewForYear[y]);
  if (!changed.length) return { ok: true, message: 'No change.' };

  await saveRosterDefaults({ ...current, crewForYear: next });
  await db.insert(events).values({
    action: 'settings.roster_defaults',
    entityType: 'settings',
    actorRole: 'manager',
    actorName: actor,
    summary:
      `${actor} changed roster defaults: ` +
      changed.map((y) => `${CLASS_YEAR_LABELS[y].toLowerCase()} → ${next[y]}`).join(', '),
    payload: { from: current.crewForYear, to: next },
  });
  return { ok: true, message: 'Saved. These apply to people added from now on; nobody already on the roster moves.' };
}

/* ------------------------------------------------------------------ */
/* A brother's own profile                                             */
/* ------------------------------------------------------------------ */

/**
 * The fields a brother keeps up to date himself. Everything that affects the
 * draw - crew, exemption, points - stays with the manager.
 */
export async function updateOwnProfile(
  memberId: string,
  input: { room: string; slackUserId: string },
): Promise<RosterResult> {
  const [m] = await db.select().from(members).where(eq(members.id, memberId)).limit(1);
  if (!m || !m.active) return { ok: false, message: 'You are not on the roster.' };

  const slack = cleanSlackId(input.slackUserId);
  if (slack === 'invalid') {
    return {
      ok: false,
      message: 'That is not a Slack member ID. In Slack: your profile → ⋯ → Copy member ID. It looks like U01ABC23DEF.',
    };
  }
  const next = { room: input.room.trim().slice(0, 20) || null, slackUserId: slack };
  const changed = (['room', 'slackUserId'] as const).filter((k) => (m[k] ?? null) !== next[k]);
  if (!changed.length) return { ok: true, message: 'Nothing changed.' };

  db.transaction((tx) => {
    tx.update(members).set(next).where(eq(members.id, memberId)).run();
    tx.insert(events)
      .values({
        action: 'member.profile_updated',
        entityType: 'member',
        entityId: memberId,
        actorRole: 'brother',
        actorMemberId: memberId,
        actorName: m.name,
        summary: `${m.name} updated his ${changed.map((k) => (k === 'room' ? 'room' : 'Slack ID')).join(' and ')}`,
        payload: Object.fromEntries(changed.map((k) => [k, { from: m[k], to: next[k] }])),
      })
      .run();
  });
  return { ok: true, message: 'Saved.' };
}
