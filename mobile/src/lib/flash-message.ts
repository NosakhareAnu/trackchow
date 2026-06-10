// Module-level one-shot flash message store.
// setFlash is called before navigating away; consumeFlash reads and clears it once.
// Using a module variable (not AsyncStorage) keeps it in-memory and ephemeral —
// the message lives only until the destination screen consumes it.

export type FlashType = 'online' | 'offline';

type FlashPayload = {
  msg: string;
  type: FlashType;
  date?: string; // YYYY-MM-DD — if set, Diary switches to this date on arrival
};

let pending: FlashPayload | null = null;

export function setFlash(msg: string, type: FlashType = 'online', date?: string): void {
  pending = { msg, type, date };
}

export function consumeFlash(): FlashPayload | null {
  const val = pending;
  pending = null;
  return val;
}
