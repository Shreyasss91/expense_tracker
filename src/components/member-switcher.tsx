"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { updateActiveMember } from "@/actions/member";
import { MemberDropdown } from "@/components/shared/member-dropdown";
import type { MemberOption } from "@/components/quick-add/types";

export function MemberSwitcher({
  members,
  activeMemberId,
}: {
  members: MemberOption[];
  activeMemberId: string;
}) {
  const router = useRouter();
  const active = members.find((m) => m.id === activeMemberId) ?? members[0];

  // §3.2 fresh-session bootstrap: the (app) layout only defaults the DISPLAY
  // member when the active_member_id cookie is absent; it does not establish
  // the cookie. Quick Add must never own member identity, so this — the
  // member-selection component — establishes the deterministic default through
  // the existing mechanism (updateActiveMember, the same action used for
  // explicit switches). No new cookie logic, no new state architecture.
  useEffect(() => {
    if (!active) return;
    const hasCookie = document.cookie
      .split(";")
      .some((c) => c.trim().startsWith("active_member_id="));
    if (!hasCookie) {
      void updateActiveMember(active.id);
    }
  }, [active]);

  async function select(memberId: string) {
    await updateActiveMember(memberId);
    router.refresh();
  }

  if (!active) return null;

  // §3.7 — renders through the shared MemberDropdown (was a near-verbatim
  // copy of the two form-local dropdowns); keeps its header styling.
  return (
    <MemberDropdown
      members={members}
      activeMemberId={activeMemberId}
      onSelect={(id) => void select(id)}
      label="Who's using the app?"
      triggerClassName="h-9 gap-1.5 rounded-none px-2 font-medium sm:px-3"
    />
  );
}
