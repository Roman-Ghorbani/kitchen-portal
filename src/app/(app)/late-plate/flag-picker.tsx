'use client';

import { ALLERGENS, DIETARY, OTHER_FLAG_ID } from '../../../lib/dietary.ts';

/** Ticking allergies and dietary needs; used on the Menu page and on Profile. */
export function FlagPicker({
  flags,
  other,
  setFlags,
  setOther,
}: {
  flags: string[];
  other: string;
  setFlags: (f: string[]) => void;
  setOther: (s: string) => void;
}) {
  const toggle = (id: string) =>
    setFlags(flags.includes(id) ? flags.filter((f) => f !== id) : [...flags, id]);

  return (
    <div className="mb-picker">
      <div className="mb-picker-title">Allergies</div>
      <div className="mb-picker-grid">
        {ALLERGENS.map((f) => (
          <label key={f.id} className={`mb-check${flags.includes(f.id) ? ' is-on' : ''}`}>
            <input type="checkbox" checked={flags.includes(f.id)} onChange={() => toggle(f.id)} />
            <span>{f.label}</span>
          </label>
        ))}
      </div>
      <div className="mb-picker-title">Dietary and religious</div>
      <div className="mb-picker-grid">
        {DIETARY.map((f) => (
          <label key={f.id} className={`mb-check${flags.includes(f.id) ? ' is-on' : ''}`}>
            <input type="checkbox" checked={flags.includes(f.id)} onChange={() => toggle(f.id)} />
            <span>{f.label}</span>
          </label>
        ))}
      </div>
      {flags.includes(OTHER_FLAG_ID) && (
        <input
          className="mb-input"
          placeholder="What should the chefs know?"
          value={other}
          maxLength={140}
          onChange={(e) => setOther(e.target.value)}
        />
      )}
      <div className="mb-picker-foot">Saved as yours, so they are ticked next time.</div>
    </div>
  );
}
