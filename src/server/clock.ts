export type Clock = () => Date;

const systemClock: Clock = () => new Date();

let clock: Clock = systemClock;

export function now(): Date {
  return new Date(clock().getTime());
}

export function setClock(next: Date | number | Clock): void {
  if (typeof next === "function") {
    clock = next;
    return;
  }
  const ms = next instanceof Date ? next.getTime() : next;
  if (!Number.isFinite(ms)) {
    throw new Error("invalid clock instant");
  }
  clock = () => new Date(ms);
}

export function resetClock(): void {
  clock = systemClock;
}
