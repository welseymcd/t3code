import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { DateTime, Effect, Layer } from "effect";

import { issueRAuthGrantCredential, verifyRAuthGrantCredential } from "./RAuthGrantVerification.ts";

const TEST_SECRET = new TextEncoder().encode("test-r-auth-grant-secret");

it.layer(NodeServices.layer)("verifyRAuthGrantCredential", (it) => {
  it.effect("verifies a signed grant for the expected environment", () =>
    Effect.gen(function* () {
      const now = DateTime.makeUnsafe("2026-05-06T00:00:00.000Z");
      const credential = issueRAuthGrantCredential({
        issuer: "https://auth.example.com",
        audience: "environment-123",
        subject: "user-123",
        role: "client",
        issuedAt: now,
        expiresAt: DateTime.makeUnsafe("2026-05-06T00:05:00.000Z"),
        secret: TEST_SECRET,
      });

      const verified = yield* verifyRAuthGrantCredential(credential, {
        expectedIssuer: "https://auth.example.com",
        expectedSharedSecret: TEST_SECRET,
        expectedEnvironmentId: "environment-123",
        now,
      });

      expect(verified.subject).toBe("user-123");
      expect(verified.role).toBe("client");
      expect(verified.environmentId).toBe("environment-123");
      expect(verified.issuer).toBe("https://auth.example.com");
    }).pipe(Effect.provide(Layer.empty)),
  );

  it.effect("rejects malformed grant credentials", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        verifyRAuthGrantCredential("not-a-grant", {
          expectedIssuer: "https://auth.example.com",
          expectedSharedSecret: TEST_SECRET,
          expectedEnvironmentId: "environment-123",
          now: DateTime.makeUnsafe("2026-05-06T00:00:00.000Z"),
        }),
      );

      expect(error.kind).toBe("malformed-credential");
      expect(error.message).toContain("Malformed");
    }).pipe(Effect.provide(Layer.empty)),
  );

  it.effect("rejects grants signed with the wrong secret", () =>
    Effect.gen(function* () {
      const credential = issueRAuthGrantCredential({
        issuer: "https://auth.example.com",
        audience: "environment-123",
        subject: "user-123",
        role: "client",
        issuedAt: DateTime.makeUnsafe("2026-05-06T00:00:00.000Z"),
        expiresAt: DateTime.makeUnsafe("2026-05-06T00:05:00.000Z"),
        secret: TEST_SECRET,
      });

      const error = yield* Effect.flip(
        verifyRAuthGrantCredential(credential, {
          expectedIssuer: "https://auth.example.com",
          expectedSharedSecret: new TextEncoder().encode("wrong-secret"),
          expectedEnvironmentId: "environment-123",
          now: DateTime.makeUnsafe("2026-05-06T00:00:00.000Z"),
        }),
      );

      expect(error.kind).toBe("invalid-signature");
      expect(error.message).toContain("signature");
    }).pipe(Effect.provide(Layer.empty)),
  );

  it.effect("rejects grants issued for a different issuer", () =>
    Effect.gen(function* () {
      const credential = issueRAuthGrantCredential({
        issuer: "https://auth.example.com",
        audience: "environment-123",
        subject: "user-123",
        role: "client",
        issuedAt: DateTime.makeUnsafe("2026-05-06T00:00:00.000Z"),
        expiresAt: DateTime.makeUnsafe("2026-05-06T00:05:00.000Z"),
        secret: TEST_SECRET,
      });

      const error = yield* Effect.flip(
        verifyRAuthGrantCredential(credential, {
          expectedIssuer: "https://different.example.com",
          expectedSharedSecret: TEST_SECRET,
          expectedEnvironmentId: "environment-123",
          now: DateTime.makeUnsafe("2026-05-06T00:00:00.000Z"),
        }),
      );

      expect(error.kind).toBe("unexpected-issuer");
      expect(error.message).toContain("issuer");
    }).pipe(Effect.provide(Layer.empty)),
  );

  it.effect("rejects expired grants", () =>
    Effect.gen(function* () {
      const credential = issueRAuthGrantCredential({
        issuer: "https://auth.example.com",
        audience: "environment-123",
        subject: "user-123",
        role: "owner",
        issuedAt: DateTime.makeUnsafe("2026-05-06T00:00:00.000Z"),
        expiresAt: DateTime.makeUnsafe("2026-05-06T00:01:00.000Z"),
        secret: TEST_SECRET,
      });

      const error = yield* Effect.flip(
        verifyRAuthGrantCredential(credential, {
          expectedIssuer: "https://auth.example.com",
          expectedSharedSecret: TEST_SECRET,
          expectedEnvironmentId: "environment-123",
          now: DateTime.makeUnsafe("2026-05-06T00:02:00.000Z"),
        }),
      );

      expect(error.kind).toBe("expired");
      expect(error.message).toContain("expired");
    }).pipe(Effect.provide(Layer.empty)),
  );
});
