# v1.2 Specification Amendment 7 — Existing-Transaction Member Reassignment

**Date:** 17 August 2026

**Status:** Owner-authorized normative clarification

## Scope

This amendment clarifies the member-identity rule for **editing an existing transaction**. It does not change the member-identity model used by transaction creation.

## Normative Rule

`active_member_id` is authoritative **only for transaction creation**.

When creating a new transaction, `createTransaction()` must read the member from the `active_member_id` cookie, validate that the member exists, and stamp that member onto the new database row. A client-supplied member ID must not be used as a fallback for creation.

When **editing an existing transaction**, changing the transaction's `member_id` is an intentional and supported operation. `updateTransaction(id, data)` may accept the edited `member_id` from the transaction-edit payload, provided that:

1. the transaction ID is valid;
2. the supplied member ID is a valid UUID;
3. the member exists in the `members` table; and
4. the mutation remains subject to the application's normal authentication/security boundary.

The edit operation therefore may intentionally reassign an existing transaction from one family member to another. This is not a security or authorization mechanism; it is ordinary transaction data editing.

## Explicit Distinction

```text
CREATE
  active_member_id cookie
        ↓
  validate member exists
        ↓
  stamp new transaction

EDIT
  existing transaction
        ↓
  member_id may be changed intentionally
        ↓
  validate member exists
        ↓
  persist reassignment
```

The creation rule and edit rule must not be conflated. Removing the historical client-supplied `memberId` fallback from `createTransaction()` does **not** prohibit member reassignment during `updateTransaction()`.

## Relationship to SPEC.md

This is a normative clarification of §3.2, §3.2.1 and §7.1. It does not introduce a new feature, database structure, authentication mechanism, or scope expansion. The existing transaction-edit behavior is explicitly authorized and should be preserved.
