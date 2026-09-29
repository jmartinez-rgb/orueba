"use client";
import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-[22px] w-10 shrink-0 items-center rounded-full border border-transparent transition-colors duration-200 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-[18px] rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] ring-0 transition-transform duration-200 ease-out data-[state=checked]:translate-x-[19px] data-[state=unchecked]:translate-x-px" />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
