import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-9 w-full min-w-0 rounded-md border-0 bg-card px-3 py-1 text-sm shadow-(--shadow-control) outline-none transition-shadow duration-150 placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:opacity-50 aria-invalid:ring-2 aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn("flex min-h-16 w-full rounded-md border-0 bg-card px-3 py-2 text-sm shadow-(--shadow-control) outline-none transition-shadow duration-150 placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:opacity-50", className)}
      {...props}
    />
  );
}

export { Input, Textarea };
