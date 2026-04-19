import { CircleAlertIcon } from "lucide-react";
import { memo } from "react";

import type { ProviderSessionFailure } from "../ChatView.logic";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";

export const ProviderSessionFailureBanner = memo(function ProviderSessionFailureBanner({
  failure,
}: {
  failure: ProviderSessionFailure | null;
}) {
  if (!failure) {
    return null;
  }

  return (
    <div className="mx-auto max-w-3xl pt-3">
      <Alert variant="error">
        <CircleAlertIcon />
        <AlertTitle>{failure.title}</AlertTitle>
        <AlertDescription>
          <p>{failure.description}</p>
          <p className="font-mono text-xs text-muted-foreground" title={failure.reason}>
            {failure.reason}
          </p>
        </AlertDescription>
      </Alert>
    </div>
  );
});
