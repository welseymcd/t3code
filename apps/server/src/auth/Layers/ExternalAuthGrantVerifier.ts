import { DateTime, Effect, Layer, Schema } from "effect";

import { ServerConfig } from "../../config.ts";
import { ServerEnvironment } from "../../environment/Services/ServerEnvironment.ts";
import { base64UrlDecodeUtf8, signPayload, timingSafeEqualBase64Url } from "../utils.ts";
import {
  ExternalAuthGrantError,
  ExternalAuthGrantVerifier,
  type ExternalAuthGrantVerifierShape,
  type VerifiedExternalAuthGrant,
} from "../Services/ExternalAuthGrantVerifier.ts";

const ExternalGrantClaims = Schema.Struct({
  v: Schema.Literal(1),
  iss: Schema.String,
  aud: Schema.String,
  sub: Schema.String,
  role: Schema.Literals(["owner", "client"]),
  email: Schema.String,
  name: Schema.String,
  iat: Schema.Number,
  exp: Schema.Number,
});

type ExternalGrantClaims = typeof ExternalGrantClaims.Type;

function invalidExternalGrant(message: string, cause?: unknown) {
  return new ExternalAuthGrantError({
    message,
    reason: "invalid",
    cause,
  });
}

export const makeExternalAuthGrantVerifier = Effect.gen(function* () {
  const config = yield* ServerConfig;

  const issuer = config.rAuthIssuer?.trim();
  const sharedSecret = config.rAuthSharedSecret?.trim();
  if (!issuer || !sharedSecret) {
    return {
      verify: () =>
        Effect.fail(
          new ExternalAuthGrantError({
            message: "External auth grant verification is not configured.",
            reason: "not-configured",
          }),
        ),
    } satisfies ExternalAuthGrantVerifierShape;
  }

  const signingSecret = new TextEncoder().encode(sharedSecret);
  const serverEnvironment = yield* ServerEnvironment;
  const environmentId = yield* serverEnvironment.getEnvironmentId;
  const decodeExternalGrantClaims = Schema.decodeUnknownEffect(ExternalGrantClaims);

  const decodeClaims = (encodedClaims: string) =>
    Effect.try({
      try: () => JSON.parse(base64UrlDecodeUtf8(encodedClaims)) as unknown,
      catch: (cause) => invalidExternalGrant("Malformed external auth grant payload.", cause),
    }).pipe(
      Effect.flatMap((raw) =>
        decodeExternalGrantClaims(raw).pipe(
          Effect.mapError((cause) =>
            invalidExternalGrant("Invalid external auth grant payload.", cause),
          ),
        ),
      ),
    );

  const verify: ExternalAuthGrantVerifierShape["verify"] = (credential) =>
    Effect.gen(function* () {
      const [encodedHeader, encodedClaims, signature] = credential.split(".");
      if (!encodedHeader || !encodedClaims || !signature) {
        return yield* invalidExternalGrant("Malformed external auth grant.");
      }

      const expectedSignature = signPayload(`${encodedHeader}.${encodedClaims}`, signingSecret);
      if (!timingSafeEqualBase64Url(signature, expectedSignature)) {
        return yield* invalidExternalGrant("Invalid external auth grant signature.");
      }

      const claims = yield* decodeClaims(encodedClaims);
      if (claims.iss !== issuer) {
        return yield* invalidExternalGrant("Unexpected external auth grant issuer.");
      }
      if (claims.aud !== environmentId) {
        return yield* invalidExternalGrant("External auth grant audience mismatch.");
      }

      const nowSeconds = Math.floor(Date.now() / 1000);
      if (claims.exp <= nowSeconds) {
        return yield* invalidExternalGrant("External auth grant expired.");
      }

      return {
        subject: claims.sub,
        role: claims.role,
        email: claims.email,
        name: claims.name,
        expiresAt: DateTime.makeUnsafe(claims.exp * 1000),
      } satisfies VerifiedExternalAuthGrant;
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof ExternalAuthGrantError
          ? cause
          : new ExternalAuthGrantError({
              message: "Failed to verify external auth grant.",
              reason: "unexpected",
              cause,
            }),
      ),
    );

  return {
    verify,
  } satisfies ExternalAuthGrantVerifierShape;
});

export const ExternalAuthGrantVerifierLive = Layer.effect(
  ExternalAuthGrantVerifier,
  makeExternalAuthGrantVerifier,
);
