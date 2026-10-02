"use client";
import * as React from "react";
import { Dialog as SheetPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;

function SheetContent({
  className,
  children,
  side = "right",
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & { side?: "right" | "left" }) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-black/35 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 motion-reduce:animate-none" />
      <SheetPrimitive.Content
        className={cn(
          "fixed inset-y-0 z-50 flex h-full flex-col gap-0 bg-popover text-popover-foreground shadow-(--shadow-pop) ease-[cubic-bezier(0.32,0.72,0,1)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:duration-300 data-[state=closed]:duration-200 motion-reduce:animate-none",
          side === "right"
            ? "right-0 w-full sm:max-w-xl data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right"
            : "left-0 w-72 data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left",
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="pressable absolute top-2.5 right-2.5 flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring outline-none sm:size-9">
          <X aria-hidden className="size-4" />
          <span className="sr-only">Cerrar</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1 border-b border-(--hairline) px-5 py-4 pr-12", className)} {...props} />;
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title className={cn("text-[17px] font-semibold tracking-[-0.02em]", className)} {...props} />;
}

function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return <SheetPrimitive.Description className={cn("text-[13px] leading-snug text-muted-foreground", className)} {...props} />;
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetDescription };
