// Single source of truth for "can this wallet back this meme right now?"
//
// Before this module, the same gate logic was hand-rolled in three
// places (submitBacking, confirmBack, MemeActionPanel.allOpenSlotsFilled).
// The duplication is exactly what caused the GO incident on 2026-06-11:
// the API's slot-assignment shipped fixed, the lock-card check shipped
// fixed, the submitBacking pre-check shipped fixed — but the confirmBack
// pre-check sat with the old `activeBackings >= openSlots` math and kept
// rejecting public backers. A real user would have walked away.
//
// Every UI surface that needs to ask "is the public bucket full?" or
// "can this wallet sign?" calls the helpers here. There is no second
// copy to drift.
//
// IMPORTANT: this module mirrors the SERVER-side decision in
// src/app/api/backings/route.ts. The API is the ultimate source of
// truth — these checks are pre-flight UX to avoid making the user
// sign a tx that's going to be rejected and refunded. If the server
// logic ever changes, update both.

export type SlotNumber = number | null | undefined;
export interface BackingRowLite {
  slot_number?: SlotNumber;
  status?: string | null;
}

export interface MemeSlotShape {
  total_slots: number;
  reserved_slots?: number | null;
}

// Counts only PUBLIC-bucket fills — backings sitting in slot numbers
// 1..openSlots, with active status. This is the correct denominator
// for "are there any public slots left?". Team backings live in
// slot_number > openSlots (the reserved bucket) and are NOT counted
// here. Withdrawn rows are excluded.
export function countPublicBucketFilled(
  backings: BackingRowLite[],
  openSlots: number,
): number {
  return backings.filter((b) =>
    b.status !== 'withdrawn'
    && b.slot_number != null
    && Number(b.slot_number) <= openSlots,
  ).length;
}

// Counts RESERVED-bucket fills — backings in slot_number > openSlots.
// Used by the meme dashboard to show "TEAM 2/3" style breakdowns.
export function countReservedBucketFilled(
  backings: BackingRowLite[],
  openSlots: number,
): number {
  return backings.filter((b) =>
    b.status !== 'withdrawn'
    && b.slot_number != null
    && Number(b.slot_number) > openSlots,
  ).length;
}

export type Eligibility =
  | { canBack: true }
  | {
      canBack: false;
      reason: 'all-slots-filled' | 'team-round' | 'public-bucket-filled' | 'reserved-bucket-filled-for-team';
      message: string;
    };

// THE gate function. Returns a plain decision: can this wallet sign
// a backing tx right now, or is something blocking?
//
// args.isAllowlisted is REQUIRED — callers must check the allowlist
// before calling. If the meme has reserved_slots > 0 and isAllowlisted
// is `undefined`, the helper assumes false (safer to under-grant than
// over-grant).
export function computeBackingEligibility(args: {
  meme: MemeSlotShape;
  backings: BackingRowLite[];
  isAllowlisted: boolean;
}): Eligibility {
  const { meme, backings, isAllowlisted } = args;
  const totalSlots = Number(meme.total_slots) || 8;
  const reservedSlots = Number(meme.reserved_slots) || 0;
  const openSlots = Math.max(0, totalSlots - reservedSlots);
  const active = backings.filter((b) => b.status !== 'withdrawn').length;

  if (active >= totalSlots) {
    return {
      canBack: false,
      reason: 'all-slots-filled',
      message: 'All backer slots are filled.',
    };
  }

  if (reservedSlots > 0 && !isAllowlisted) {
    if (openSlots === 0) {
      return {
        canBack: false,
        reason: 'team-round',
        message: `This is a TEAM ROUND — all ${totalSlots} slots are reserved for declared wallets. Public can't back.`,
      };
    }
    const publicFilled = countPublicBucketFilled(backings, openSlots);
    if (publicFilled >= openSlots) {
      return {
        canBack: false,
        reason: 'public-bucket-filled',
        message: `All ${openSlots} open slots are filled. The remaining ${reservedSlots} are reserved for allowlisted wallets.`,
      };
    }
  }

  // Allowlisted backer: only blocked if reserved bucket is full AND open is full.
  // The `active >= totalSlots` check at the top already catches that.
  // No further gate needed — slot-assignment in the API will find them a spot.

  return { canBack: true };
}

// Convenience: "is the public bucket completely full?" — used by the
// lock-card UI to flip non-allowlisted backers into the gated view.
export function isPublicBucketFull(
  backings: BackingRowLite[],
  meme: MemeSlotShape,
): boolean {
  const totalSlots = Number(meme.total_slots) || 8;
  const reservedSlots = Number(meme.reserved_slots) || 0;
  const openSlots = Math.max(0, totalSlots - reservedSlots);
  if (openSlots === 0) return true;
  return countPublicBucketFilled(backings, openSlots) >= openSlots;
}
