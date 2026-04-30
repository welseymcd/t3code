import { createFileRoute } from "@tanstack/react-router";

import { DevServersSettingsPanel } from "../components/settings/SettingsPanels";

export const Route = createFileRoute("/settings/dev-servers")({
  component: DevServersSettingsPanel,
});
