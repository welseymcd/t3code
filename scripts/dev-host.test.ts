import { assert, describe, it } from "@effect/vitest";

import {
  parseDotEnv,
  resolveTunnelHostname,
  serializeEnvFile,
  wildcardHostnameForDomain,
} from "./dev-host.ts";

describe("dev-host", () => {
  it("parses simple dotenv files", () => {
    assert.deepStrictEqual(
      parseDotEnv(`
GLOBAL=abc123
EMAIL=user@example.com
# comment
SPACED = value with spaces
`),
      {
        EMAIL: "user@example.com",
        GLOBAL: "abc123",
        SPACED: "value with spaces",
      },
    );
  });

  it("serializes env files in sorted key order", () => {
    assert.equal(
      serializeEnvFile({
        ZED: "last",
        ALPHA: "first",
      }),
      "ALPHA=first\nZED=last\n",
    );
  });

  it("derives the wildcard hostname from the base domain", () => {
    assert.equal(wildcardHostnameForDomain("rmcd.fyi"), "*.rmcd.fyi");
  });

  it("derives the tunnel cname target from the tunnel id", () => {
    assert.equal(
      resolveTunnelHostname("12345678-1234-1234-1234-123456789abc"),
      "12345678-1234-1234-1234-123456789abc.cfargotunnel.com",
    );
  });
});
