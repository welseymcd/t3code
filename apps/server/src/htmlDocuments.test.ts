import { ProjectId, ThreadId } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";

import {
  makeHtmlDocumentPublishingInfo,
  resolveHtmlDocumentProjectScope,
  resolveHtmlDocumentThreadScope,
} from "./htmlDocuments.ts";

describe("htmlDocuments", () => {
  it("resolves isolated project document scope paths and URLs", () => {
    const scope = resolveHtmlDocumentProjectScope({
      rootDirectory: "/tmp/t3/.docs",
      baseUrl: "http://127.0.0.1:3773",
      tailscaleBaseUrl: "https://desktop.tail.ts.net/",
      projectId: ProjectId.make("project/with spaces"),
    });

    assert.equal(scope.directory, "/tmp/t3/.docs/projects/project%2Fwith%20spaces");
    assert.equal(scope.url, "http://127.0.0.1:3773/documents/projects/project%2Fwith%20spaces/");
    assert.equal(
      scope.tailscaleUrl,
      "https://desktop.tail.ts.net/documents/projects/project%2Fwith%20spaces/",
    );
  });

  it("resolves isolated thread document scopes under project scopes", () => {
    const scope = resolveHtmlDocumentThreadScope({
      rootDirectory: "/tmp/t3/.docs",
      baseUrl: "http://127.0.0.1:3773",
      projectId: ProjectId.make("project-1"),
      threadId: ThreadId.make("thread/1"),
    });

    assert.equal(scope.directory, "/tmp/t3/.docs/projects/project-1/threads/thread%2F1");
    assert.equal(
      scope.url,
      "http://127.0.0.1:3773/documents/projects/project-1/threads/thread%2F1/",
    );
    assert.equal(scope.tailscaleUrl, undefined);
  });

  it("publishes templates for agents to fill with encoded project and thread IDs", () => {
    const publishingInfo = makeHtmlDocumentPublishingInfo({
      rootDirectory: "/tmp/t3/.docs",
      baseUrl: "http://127.0.0.1:3773",
      tailscaleBaseUrl: "https://desktop.tail.ts.net/",
    });

    assert.equal(publishingInfo.rootUrl, "http://127.0.0.1:3773/documents/");
    assert.equal(publishingInfo.projectDirectoryTemplate, "/tmp/t3/.docs/projects/{projectId}");
    assert.equal(
      publishingInfo.projectUrlTemplate,
      "http://127.0.0.1:3773/documents/projects/{projectId}/",
    );
    assert.equal(
      publishingInfo.threadDirectoryTemplate,
      "/tmp/t3/.docs/projects/{projectId}/threads/{threadId}",
    );
    assert.equal(
      publishingInfo.threadUrlTemplate,
      "http://127.0.0.1:3773/documents/projects/{projectId}/threads/{threadId}/",
    );
    assert.equal(
      publishingInfo.tailscaleProjectUrlTemplate,
      "https://desktop.tail.ts.net/documents/projects/{projectId}/",
    );
    assert.equal(
      publishingInfo.tailscaleThreadUrlTemplate,
      "https://desktop.tail.ts.net/documents/projects/{projectId}/threads/{threadId}/",
    );
  });
});
