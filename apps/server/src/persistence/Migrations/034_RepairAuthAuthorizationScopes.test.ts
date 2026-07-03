import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("034_RepairAuthAuthorizationScopes", (it) => {
  it.effect(
    "repairs databases that recorded shifted migration ids before the auth scope cutover",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        yield* runMigrations({ toMigrationInclusive: 22 });
        yield* sql`
        INSERT INTO auth_sessions (
          session_id,
          subject,
          role,
          method,
          issued_at,
          expires_at
        )
        VALUES (
          'legacy-session',
          'desktop',
          'owner',
          'browser-session-cookie',
          '2026-05-29T00:00:00.000Z',
          '2026-05-29T01:00:00.000Z'
        )
      `;
        yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES
          (31, 'CanonicalizeLegacyModelSelectionOptions'),
          (32, 'CanonicalizeProjectionModelSelectionProviders'),
          (33, 'CanonicalizeProjectionModelSelectionOptions')
      `;

        yield* runMigrations();

        const migrations = yield* sql<{
          readonly migrationId: number;
          readonly name: string;
        }>`
        SELECT migration_id AS "migrationId", name
        FROM effect_sql_migrations
        WHERE migration_id >= 31
        ORDER BY migration_id
      `;
        const pairingColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(auth_pairing_links)
      `;
        const sessionColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(auth_sessions)
      `;
        const sessions = yield* sql<{ readonly sessionId: string }>`
        SELECT session_id AS "sessionId" FROM auth_sessions
      `;

        assert.deepStrictEqual(migrations, [
          {
            migrationId: 31,
            name: "CanonicalizeLegacyModelSelectionOptions",
          },
          {
            migrationId: 32,
            name: "CanonicalizeProjectionModelSelectionProviders",
          },
          {
            migrationId: 33,
            name: "CanonicalizeProjectionModelSelectionOptions",
          },
          {
            migrationId: 34,
            name: "RepairAuthAuthorizationScopes",
          },
        ]);
        assert.isTrue(pairingColumns.some((column) => column.name === "scopes"));
        assert.isTrue(pairingColumns.some((column) => column.name === "proof_key_thumbprint"));
        assert.isFalse(pairingColumns.some((column) => column.name === "role"));
        assert.isTrue(sessionColumns.some((column) => column.name === "scopes"));
        assert.isFalse(sessionColumns.some((column) => column.name === "role"));
        assert.deepStrictEqual(sessions, []);
      }),
  );
});
