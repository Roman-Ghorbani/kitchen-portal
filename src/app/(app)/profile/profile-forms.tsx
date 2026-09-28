'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { updateMyProfile } from '../../actions/profile-actions.ts';
import { updateMyDietary } from '../../actions/late-plate-actions.ts';
import { FlagPicker } from '../late-plate/flag-picker.tsx';

type Status = { ok: boolean; text: string } | null;

function Msg({ status }: { status: Status }) {
  if (!status) return null;
  return (
    <div className={`form-msg ${status.ok ? 'ok' : 'bad'}`} role={status.ok ? 'status' : 'alert'}>
      {status.text}
    </div>
  );
}

export function ProfileForm({ room, slackUserId, readOnly }: { room: string; slackUserId: string; readOnly: boolean }) {
  const [form, setForm] = useState({ room, slackUserId });
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <form
      className="card card-pad"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await updateMyProfile(form.room, form.slackUserId);
          setStatus({ ok: res.ok, text: res.message });
          if (res.ok) router.refresh();
        });
      }}
    >
      <h2 className="section-title">About you</h2>
      <div className="form-grid">
        <label className="form-field">
          <span>Room</span>
          <input
            className="field"
            value={form.room}
            onChange={(e) => setForm({ ...form, room: e.target.value })}
            maxLength={20}
            disabled={readOnly}
            placeholder="e.g. 204"
          />
        </label>
        <label className="form-field">
          <span>Slack member ID</span>
          <input
            className="field mono"
            value={form.slackUserId}
            onChange={(e) => setForm({ ...form, slackUserId: e.target.value })}
            maxLength={16}
            disabled={readOnly}
            placeholder="U01ABC23DEF"
          />
        </label>
      </div>
      <p className="settings-hint">
        With your Slack ID the day-before reminder @mentions you, so you actually
        get notified. In Slack: your profile → ⋯ → <em>Copy member ID</em>.
      </p>
      {!readOnly && (
        <div className="settings-actions">
          <button className="btn primary sm" type="submit" disabled={pending}>
            Save
          </button>
        </div>
      )}
      <Msg status={status} />
    </form>
  );
}

export function DietaryForm({
  flags: initialFlags,
  other: initialOther,
  summary,
  readOnly,
}: {
  flags: string[];
  other: string;
  summary: string[];
  readOnly: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [flags, setFlags] = useState(initialFlags);
  const [other, setOther] = useState(initialOther);
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <section className="card card-pad settings-card">
      <h2 className="section-title">Allergies and diet</h2>
      <p className="settings-lede">
        {summary.length ? summary.join(' · ') : 'None on file.'} These are printed on
        every late plate you ask for, so the chefs see them without you having to
        remember.
      </p>
      {editing && <FlagPicker flags={flags} other={other} setFlags={setFlags} setOther={setOther} />}
      {!readOnly && (
        <div className="settings-actions">
          {editing ? (
            <>
              <button
                className="btn primary sm"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const res = await updateMyDietary(flags, other);
                    setStatus({ ok: res.ok, text: res.ok ? 'Saved for future plates.' : res.message });
                    if (res.ok) {
                      setEditing(false);
                      router.refresh();
                    }
                  })
                }
              >
                Save
              </button>
              <button className="btn sm alt" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button className="btn sm" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </div>
      )}
      <Msg status={status} />
    </section>
  );
}
