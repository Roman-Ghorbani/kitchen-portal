'use server';

/**
 * The manager's roster controls. Each one checks the manager session, hands
 * the work to lib/roster-service.ts, and refreshes the pages that show it.
 */

import { revalidatePath } from 'next/cache';

import { requireAdmin } from '../../lib/session.ts';
import * as roster from '../../lib/roster-service.ts';
import type { PointOp } from '../../lib/points-ops.ts';
import type { ImportOptions, RosterDefaults } from '../../lib/roster-plan.ts';
import type { RosterResult, Duty, PointsScope, ProfileInput, NewMemberInput, ImportSelection } from '../../lib/roster-service.ts';

export type { RosterResult } from '../../lib/roster-service.ts';

function refresh(memberId?: string) {
  revalidatePath('/admin/roster');
  revalidatePath('/admin');
  revalidatePath('/standings');
  if (memberId) revalidatePath(`/admin/member/${memberId}`);
}

async function as<T extends { ok: boolean }>(work: (actor: string) => Promise<T>, memberId?: string): Promise<T> {
  const admin = await requireAdmin();
  const res = await work(admin.name);
  if (res.ok) refresh(memberId);
  return res;
}

export async function updateMemberProfile(id: string, input: ProfileInput): Promise<RosterResult> {
  return as((a) => roster.updateProfile(a, id, input), id);
}

export async function setDuty(ids: string[], duty: Duty): Promise<RosterResult> {
  return as((a) => roster.setDuty(a, ids, duty), ids.length === 1 ? ids[0] : undefined);
}

export async function adjustPoints(id: string, delta: number, reason: string): Promise<RosterResult> {
  return as((a) => roster.adjustPoints(a, id, delta, reason), id);
}

export async function previewBulkPoints(scope: PointsScope, ids: string[], op: PointOp, amount: number) {
  await requireAdmin();
  return roster.previewPoints(scope, ids, op, amount);
}

export async function applyBulkPoints(
  scope: PointsScope,
  ids: string[],
  op: PointOp,
  amount: number,
  reason: string,
): Promise<RosterResult> {
  return as((a) => roster.applyPoints(a, scope, ids, op, amount, reason));
}

export async function setMakeupDebt(id: string, debt: number): Promise<RosterResult> {
  return as((a) => roster.setMakeupDebt(a, id, debt), id);
}

export async function setActive(ids: string[], active: boolean): Promise<RosterResult> {
  return as((a) => roster.setActive(a, ids, active), ids.length === 1 ? ids[0] : undefined);
}

export async function addMember(input: NewMemberInput): Promise<RosterResult & { id?: string }> {
  return as((a) => roster.addMember(a, input));
}

export async function deleteMember(id: string): Promise<RosterResult> {
  return as((a) => roster.deleteMember(a, id));
}

export async function previewRosterImport(text: string, options: ImportOptions) {
  await requireAdmin();
  return roster.previewImport(text, options);
}

export async function applyRosterImport(
  text: string,
  options: ImportOptions,
  selection: ImportSelection,
): Promise<RosterResult> {
  return as((a) => roster.applyImport(a, text, options, selection));
}

export async function saveCrewDefaults(crewForYear: RosterDefaults['crewForYear']): Promise<RosterResult> {
  const res = await as((a) => roster.updateCrewDefaults(a, crewForYear));
  revalidatePath('/admin/settings');
  return res;
}
