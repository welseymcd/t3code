"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { XIcon } from "lucide-react";
import * as React from "react";

import { buttonVariants } from "~/components/ui/button";
import { cn } from "~/lib/utils";

const overlayCloseButtonClassName =
  "absolute end-2 top-2 z-20 pointer-events-auto [-webkit-app-region:no-drag]";

const OverlayCloseButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<"button">
>(function OverlayCloseButton(props, ref) {
  return (
    <button
      {...mergeProps<"button">(props, {
        "aria-label": "Close",
        className: cn(
          buttonVariants({
            size: "icon",
            variant: "ghost",
          }),
          overlayCloseButtonClassName,
        ),
        children: <XIcon />,
        type: "button",
      })}
      ref={ref}
    />
  );
});

OverlayCloseButton.displayName = "OverlayCloseButton";

export { OverlayCloseButton, overlayCloseButtonClassName };
