'use client';

import { useState } from 'react';

import {
  SlotEditor,
  SwapBanner,
  type Person,
  type SlotView,
} from './week-controls.tsx';

/**
 * Holds the swap selection across slots.
 *
 * A swap needs two shifts picked in separate cards, so the "who am I
 * swapping" state has to live above them rather than inside either one.
 */
export function ManageDays({
  days,
  roster,
}: {
  days: { date: string; label: string; slots: SlotView[] }[];
  roster: Person[];
}) {
  const [swapSource, setSwapSource] = useState<{ id: string; name: string } | null>(
    null,
  );

  return (
    <>
      <SwapBanner source={swapSource} onCancel={() => setSwapSource(null)} />

      {days.map((day) => (
        <div key={day.date} className="manage-day">
          <h3 className="manage-day-title">{day.label}</h3>
          <div className="manage-day-slots">
            {day.slots.map((slot) => (
              <SlotEditor
                key={slot.slotId}
                slot={slot}
                roster={roster}
                swapSource={swapSource}
                onSwapSource={setSwapSource}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
