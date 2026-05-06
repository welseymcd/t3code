import { DateTime, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  RAuthAuthorizedEnvironment,
  RAuthClaimProof,
  RAuthGrantCredentialResult,
  RAuthGrantClaims,
  RAuthGrantRequest,
  RAuthIdentity,
  RAuthSessionState,
  ServerAuthBootstrapMethod,
} from "./auth.ts";

const decodeGrantClaims = Schema.decodeUnknownSync(RAuthGrantClaims);
const decodeGrantRequest = Schema.decodeUnknownSync(RAuthGrantRequest);
const decodeGrantCredentialResult = Schema.decodeUnknownSync(RAuthGrantCredentialResult);
const decodeAuthorizedEnvironment = Schema.decodeUnknownSync(RAuthAuthorizedEnvironment);
const decodeSessionState = Schema.decodeUnknownSync(RAuthSessionState);
const decodeIdentity = Schema.decodeUnknownSync(RAuthIdentity);
const decodeClaimProof = Schema.decodeUnknownSync(RAuthClaimProof);

describe("r-auth auth contracts", () => {
  it("includes r-auth grants as a bootstrap method", () => {
    expect(ServerAuthBootstrapMethod.literals).toContain("r-auth-grant");
  });

  it("decodes a centralized grant claim payload", () => {
    const parsed = decodeGrantClaims({
      v: 1,
      iss: "https://auth.example.com",
      aud: "environment-123",
      sub: "user-123",
      role: "client",
      email: "julius@example.com",
      name: "Julius",
      iat: 1_747_000_000,
      exp: 1_747_000_060,
    });

    expect(parsed.aud).toBe("environment-123");
    expect(parsed.role).toBe("client");
    expect(parsed.email).toBe("julius@example.com");
  });

  it("decodes an authorized environment record", () => {
    const parsed = decodeAuthorizedEnvironment({
      environmentId: "environment-123",
      label: "Production backend",
      role: "owner",
      reachable: true,
    });

    expect(parsed.label).toBe("Production backend");
    expect(parsed.reachable).toBe(true);
  });

  it("decodes a claim-proof payload", () => {
    const parsed = decodeClaimProof({
      environmentId: "environment-123",
      audience: "https://auth.example.com",
      issuedAt: DateTime.makeUnsafe("2026-05-06T00:00:00.000Z"),
      expiresAt: DateTime.makeUnsafe("2026-05-06T00:15:00.000Z"),
      proof: "proof-token",
    });

    expect(parsed.environmentId).toBe("environment-123");
    expect(parsed.audience).toBe("https://auth.example.com");
  });

  it("decodes r-auth session and grant bridge payloads", () => {
    const identity = decodeIdentity({
      subject: "user-123",
      email: "julius@example.com",
      displayName: "Julius",
    });
    const session = decodeSessionState({
      authenticated: true,
      identity,
      authorizedEnvironments: [],
      expiresAt: DateTime.makeUnsafe("2026-05-07T00:00:00.000Z"),
    });
    const request = decodeGrantRequest({
      environmentId: "environment-123",
    });
    const result = decodeGrantCredentialResult({
      credential: "grant-token",
      expiresAt: DateTime.makeUnsafe("2026-05-07T00:00:00.000Z"),
    });

    expect(session.authenticated).toBe(true);
    expect(session.identity?.subject).toBe("user-123");
    expect(request.environmentId).toBe("environment-123");
    expect(result.credential).toBe("grant-token");
  });
});
