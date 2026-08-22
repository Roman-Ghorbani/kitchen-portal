'use client';

import { SlotEditor, type Person, type SlotView } from './week-controls.tsx';

/** Renders the week as day cards, each with its two editable meal slots. */
export function ManageDays({
  days,
  roster,
}: {
  days: { date: string; label: string; isPast: boolean; slots: SlotView[] }[];
  roster: Person[];
}) {
  return (
    <>
      {days.map((day) => (
        <div key={day.date} className="manage-day">
          <h3 className="manage-day-title">
            {day.label}
            {day.isPast && <span className="tag locked">attendance</span>}
          </h3>
          <div className="manage-day-slots">
            {day.slots.map((slot) => (
              <SlotEditor
                key={slot.slotId}
                slot={slot}
                roster={roster}
                isPast={day.isPast}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
