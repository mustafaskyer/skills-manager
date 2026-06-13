import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils";

const alertVariants = cva("ui-alert", {
  variants: {
    variant: {
      default: "ui-alert-default",
      warning: "ui-alert-warning",
      destructive: "ui-alert-destructive",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export type AlertProps = React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>;

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="status" className={cn(alertVariants({ variant, className }))} {...props} />
));
Alert.displayName = "Alert";
