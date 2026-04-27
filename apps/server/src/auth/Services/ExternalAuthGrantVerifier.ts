import { Data, DateTime, Context } from "effect";
import type { Effect } from "effect";

export interface VerifiedExternalAuthGrant {
  readonly subject: string;
  readonly role: "owner" | "client";
  readonly email: string;
  readonly name: string;
  readonly expiresAt: DateTime.Utc;
}

export class ExternalAuthGrantError extends Data.TaggedError("ExternalAuthGrantError")<{
  readonly message: string;
  readonly reason: "not-configured" | "invalid" | "unexpected";
  readonly cause?: unknown;
}> {}

export interface ExternalAuthGrantVerifierShape {
  readonly verify: (
    credential: string,
  ) => Effect.Effect<VerifiedExternalAuthGrant, ExternalAuthGrantError>;
}

export class ExternalAuthGrantVerifier extends Context.Service<
  ExternalAuthGrantVerifier,
  ExternalAuthGrantVerifierShape
>()("t3/auth/Services/ExternalAuthGrantVerifier") {}
