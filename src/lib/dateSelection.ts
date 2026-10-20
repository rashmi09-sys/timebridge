/**
 * Which date (in the guest's calendar) the booking page should show. Pure, so every
 * rule is unit-tested. Dates are YYYY-MM-DD keys in the guest's zone.
 *
 * 1. A time the guest already chose (still bookable) wins: its date in the guest's
 *    current zone, so changing zones keeps the same meeting instant.
 * 2. Otherwise a date the guest picked is kept while it still has open times.
 * 3. Otherwise the nearest open date on or after it (or after today, on first load).
 * 4. Nothing open in this month: null (the caller looks in the next month).
 */
export function chooseDate(args: {
  monthDays: readonly string[];
  isOpen: (key: string) => boolean;
  todayKey: string;
  current: string | null;
  chosenDateKey: string | null;
}): { date: string | null; moved: boolean } {
  const { monthDays, isOpen, todayKey, current, chosenDateKey } = args;
  // "Moved" means the guest's date lost all its times, not merely that a chosen time sits on another day.
  const currentOpen = current != null && monthDays.includes(current) && isOpen(current);
  const pick = (date: string | null) => ({ date, moved: current != null && !currentOpen && date != null && date !== current });

  if (chosenDateKey && monthDays.includes(chosenDateKey) && isOpen(chosenDateKey)) return pick(chosenDateKey);
  if (currentOpen) return pick(current);

  const open = monthDays.filter((d) => d >= todayKey && isOpen(d));
  const from = current ?? todayKey;
  return pick(open.find((d) => d >= from) ?? open[0] ?? null);
}
