import { RAuthGrantClaims, type RAuthGrantRole } from "@t3tools/contracts";
import { Data, DateTime, Effect, Schema } from "effect";

import {
  base64UrlDecodeUtf8,
  base64UrlEncode,
  signPayload,
  timingSafeEqualBase64Url,
} from "../utils.ts";

const RAuthGrantHeader = Schema.Struct({
  alg: Schema.Literal("HS256"),
  typ: Schema.Literal("t3-grant"),
});
const decodeRAuthGrantHeader = Schema.decodeUnknownEffect(Schema.fromJsonString(RAuthGrantHeader));
const decodeRAuthGrantClaims = Schema.decodeUnknownEffect(Schema.fromJsonString(RAuthGrantClaims));

export type VerifiedRAuthGrant = {
  readonly subject: string;
  readonly role: RAuthGrantRole;
  readonly issuer: string;
  readonly audience: string;
  readonly environmentId: string;
  readonly issuedAt: DateTime.Utc;
  readonly expiresAt: DateTime.Utc;
};

export class RAuthGrantVerificationError extends Data.TaggedError("RAuthGrantVerificationError")<{
  readonly message: string;
  readonly kind:
    | "malformed-credential"
    | "invalid-signature"
    | "unexpected-issuer"
    | "unexpected-audience"
    | "expired";
  readonly cause?: unknown;
}> {}

export interface RAuthGrantVerificationShape {
  readonly verify: (
    credential: string,
    expectedEnvironmentId: string,
  ) => Effect.Effect<VerifiedRAuthGrant, RAuthGrantVerificationError>;
}

export function issueRAuthGrantCredential(input: {
  readonly issuer: string;
  readonly audience: string;
  readonly subject: string;
  readonly role: RAuthGrantRole;
  readonly email?: string;
  readonly name?: string;
  readonly issuedAt: DateTime.Utc;
  readonly expiresAt: DateTime.Utc;
  readonly secret: Uint8Array;
}): string {
  const encodedHeader = base64UrlEncode(
    JSON.stringify({
      alg: "HS256",
      typ: "t3-grant",
    }),
  );
  const encodedClaims = base64UrlEncode(
    JSON.stringify({
      v: 1,
      iss: input.issuer,
      aud: input.audience,
      sub: input.subject,
      role: input.role,
      email: input.email ?? "user@example.com",
      name: input.name ?? "",
      iat: Math.floor(input.issuedAt.epochMilliseconds / 1000),
      exp: Math.floor(input.expiresAt.epochMilliseconds / 1000),
    }),
  );
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const signature = signPayload(signingInput, input.secret);
  return `${signingInput}.${signature}`;
}

export function issueRAuthClaimProof(input: {
  readonly audience: string;
  readonly environmentId: string;
  readonly label: string;
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
  readonly issuedAt: DateTime.Utc;
  readonly expiresAt: DateTime.Utc;
  readonly secret: Uint8Array;
}): string {
  const encodedHeader = base64UrlEncode(
    JSON.stringify({
      alg: "HS256",
      typ: "t3-claim-proof",
    }),
  );
  const encodedClaims = base64UrlEncode(
    JSON.stringify({
      v: 1,
      iss: input.environmentId,
      aud: input.audience,
      environmentId: input.environmentId,
      label: input.label,
      httpBaseUrl: input.httpBaseUrl,
      wsBaseUrl: input.wsBaseUrl,
      iat: Math.floor(input.issuedAt.epochMilliseconds / 1000),
      exp: Math.floor(input.expiresAt.epochMilliseconds / 1000),
    }),
  );
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const signature = signPayload(signingInput, input.secret);
  return `${signingInput}.${signature}`;
}

export const verifyRAuthGrantCredential = (
  credential: string,
  input: {
    readonly expectedIssuer: string;
    readonly expectedSharedSecret: Uint8Array;
    readonly expectedEnvironmentId: string;
    readonly now: DateTime.Utc;
  },
): Effect.Effect<VerifiedRAuthGrant, RAuthGrantVerificationError> =>
  Effect.gen(function* () {
    const segments = credential.split(".");
    const [encodedHeader, encodedClaims, signature] = segments;
    if (segments.length !== 3 || !encodedHeader || !encodedClaims || !signature) {
      return yield* new RAuthGrantVerificationError({
        message: "Malformed r-auth grant credential.",
        kind: "malformed-credential",
      });
    }

    const signingInput = `${encodedHeader}.${encodedClaims}`;
    const expectedSignature = signPayload(signingInput, input.expectedSharedSecret);
    if (!timingSafeEqualBase64Url(signature, expectedSignature)) {
      return yield* new RAuthGrantVerificationError({
        message: "Invalid r-auth grant signature.",
        kind: "invalid-signature",
      });
    }

    yield* decodeRAuthGrantHeader(base64UrlDecodeUtf8(encodedHeader)).pipe(
      Effect.mapError(
        (cause) =>
          new RAuthGrantVerificationError({
            message: "Malformed r-auth grant credential.",
            kind: "malformed-credential",
            cause,
          }),
      ),
    );

    const claims = yield* decodeRAuthGrantClaims(base64UrlDecodeUtf8(encodedClaims)).pipe(
      Effect.mapError(
        (cause) =>
          new RAuthGrantVerificationError({
            message: "Malformed r-auth grant credential.",
            kind: "malformed-credential",
            cause,
          }),
      ),
    );

    if (claims.iss !== input.expectedIssuer) {
      return yield* new RAuthGrantVerificationError({
        message: "Unexpected r-auth grant issuer.",
        kind: "unexpected-issuer",
      });
    }

    if (claims.aud !== input.expectedEnvironmentId) {
      return yield* new RAuthGrantVerificationError({
        message: "Unexpected r-auth grant audience.",
        kind: "unexpected-audience",
      });
    }

    const nowSeconds = Math.floor(input.now.epochMilliseconds / 1000);
    if (claims.exp <= nowSeconds) {
      return yield* new RAuthGrantVerificationError({
        message: "r-auth grant expired.",
        kind: "expired",
      });
    }

    return {
      subject: claims.sub,
      role: claims.role,
      issuer: claims.iss,
      audience: claims.aud,
      environmentId: claims.aud,
      issuedAt: DateTime.makeUnsafe(claims.iat * 1000),
      expiresAt: DateTime.makeUnsafe(claims.exp * 1000),
    };
  });
