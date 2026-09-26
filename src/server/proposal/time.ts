export const INSTANT_STEP_MINUTES = 15;

const LOCAL_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type MemberAvailability =
  | { kind: "busy" }
  | { kind: "free"; earliestMinutes: number; latestMinutes: number };

export type TimeWindow = {
  localDate: string;
  startMinutes: number;
  endMinutes: number;
};

export type TimeChoice =
  | { timeBlocked: true }
  | {
      timeBlocked: false;
      localDate: string;
      minutes: number;
      coverage: number;
    };

export function parseLocalMinutes(value: string): number | null {
  const match = LOCAL_TIME.exec(value);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatLocalMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes - hours * 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function asMinutes(value: number | string): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value : null;
  }
  return parseLocalMinutes(value);
}

/** Instants from start, stepping 15 minutes while strictly before end. */
export function windowInstants(
  start: number | string,
  end: number | string,
): number[] {
  const startMinutes = asMinutes(start);
  const endMinutes = asMinutes(end);
  if (startMinutes === null || endMinutes === null) {
    return [];
  }
  const instants: number[] = [];
  for (
    let instant = startMinutes;
    instant < endMinutes;
    instant += INSTANT_STEP_MINUTES
  ) {
    instants.push(instant);
  }
  return instants;
}

export function coversInstant(
  member: MemberAvailability,
  instant: number | string,
): boolean {
  if (member.kind !== "free") {
    return false;
  }
  const minutes = asMinutes(instant);
  if (minutes === null) {
    return false;
  }
  return (
    member.earliestMinutes <= minutes && minutes <= member.latestMinutes
  );
}

export function coverageAt(
  instant: number | string,
  members: readonly MemberAvailability[],
): number {
  let coverage = 0;
  for (const member of members) {
    if (coversInstant(member, instant)) {
      coverage += 1;
    }
  }
  return coverage;
}

function instantIsEarlier(
  date: string,
  minutes: number,
  other: { localDate: string; minutes: number },
): boolean {
  if (date !== other.localDate) {
    return date < other.localDate;
  }
  return minutes < other.minutes;
}

/**
 * Earliest instant of greatest coverage across windows.
 * `members[i][w]` is member i's availability on window w.
 * Coverage 0 is time-blocked and stores no clock time.
 */
export function chooseTime(
  windows: readonly TimeWindow[],
  members: readonly (readonly MemberAvailability[])[],
): TimeChoice {
  let best: Extract<TimeChoice, { timeBlocked: false }> | null = null;

  for (let w = 0; w < windows.length; w++) {
    const window = windows[w];
    if (window === undefined) {
      continue;
    }
    for (const minutes of windowInstants(
      window.startMinutes,
      window.endMinutes,
    )) {
      let coverage = 0;
      for (const member of members) {
        const availability = member[w];
        if (availability !== undefined && coversInstant(availability, minutes)) {
          coverage += 1;
        }
      }
      if (coverage === 0) {
        continue;
      }
      if (
        best === null ||
        coverage > best.coverage ||
        (coverage === best.coverage &&
          instantIsEarlier(window.localDate, minutes, best))
      ) {
        best = {
          timeBlocked: false,
          localDate: window.localDate,
          minutes,
          coverage,
        };
      }
    }
  }

  if (best === null) {
    return { timeBlocked: true };
  }
  return best;
}
