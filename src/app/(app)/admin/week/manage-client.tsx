'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { SlotEditor, type Person, type SlotView } from './week-controls.tsx';
import { adminEnableSlot } from '../../../actions/week-admin-actions.ts';

export function ManageDays({
  weekId,
  days,
  roster,
}: {
  weekId: string;
  days: { date: string; label: string; isPast: boolean; slots: SlotView[] }[];
  roster: Person[];
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function enable(date: string, meal: 'lunch' | 'dinner') {
    startTransition(async () => {
      await adminEnableSlot(weekId, date, meal);
      router.refresh();
    });
  }

  const meals: ('lunch' | 'dinner')[] = ['lunch', 'dinner'];

  return (
    <>
      {days.map((day) => {
        return (
          <div key={day.date} className="manage-day">
            <h3 className="manage-day-title">
              {day.label}
              {day.isPast && <span className="tag locked">attendance</span>}
            </h3>
            <div className="manage-day-slots">
              {meals.map((meal) => {
                const slot = day.slots.find((s) => s.meal === meal);
                if (slot) {
                  return (
                    <SlotEditor
                      key={slot.slotId}
                      slot={slot}
                      roster={roster}
                      isPast={day.isPast}
                    />
                  );
                }
                return (
                  <div key={meal} className="slot-editor empty-service-slot">
                    <div className="slot-editor-head">
                      <span className="slot-editor-meal">
                        {meal === 'lunch' ? 'Lunch' : 'Dinner'}
                      </span>
                      <span className="tag locked">No Service</span>
                      <button
                        className="btn gold sm"
                        style={{ marginLeft: 'auto', fontSize: 11, padding: '3px 8px' }}
                        disabled={pending}
                        onClick={() => enable(day.date, meal)}
                      >
                        + Enable Service
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}
