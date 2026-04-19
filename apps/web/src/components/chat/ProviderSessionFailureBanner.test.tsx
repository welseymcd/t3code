import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProviderSessionFailureBanner } from "./ProviderSessionFailureBanner";

describe("ProviderSessionFailureBanner", () => {
  it("renders a backend failure title, guidance, and raw reason", () => {
    const markup = renderToStaticMarkup(
      <ProviderSessionFailureBanner
        failure={{
          provider: "codex",
          title: "Codex backend stopped unexpectedly",
          description:
            "The backend stopped before the active turn finished. Restart the session or send again when ready.",
          reason: "codex app-server exited (code=null, signal=SIGBUS).",
        }}
      />,
    );

    expect(markup).toContain("Codex backend stopped unexpectedly");
    expect(markup).toContain(
      "The backend stopped before the active turn finished. Restart the session or send again when ready.",
    );
    expect(markup).toContain("codex app-server exited (code=null, signal=SIGBUS).");
  });

  it("renders nothing when there is no failure", () => {
    expect(renderToStaticMarkup(<ProviderSessionFailureBanner failure={null} />)).toBe("");
  });
});
