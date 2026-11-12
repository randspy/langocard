import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-md border border-line bg-white px-3 text-sm placeholder:text-muted focus-visible:outline-2 focus-visible:outline-accent aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "min-h-20 w-full rounded-md border border-line bg-white px-3 py-2 text-sm placeholder:text-muted focus-visible:outline-2 focus-visible:outline-accent aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn("h-9 rounded-md border border-line bg-white px-2 text-sm focus-visible:outline-2 focus-visible:outline-accent", className)}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("text-sm font-medium", className)} {...props} />;
}
