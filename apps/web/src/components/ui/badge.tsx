import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-lg px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", {
  variants: {
    tone: {
      neutral: "bg-line/70 text-ink",
      due: "bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200",
      scheduled: "bg-emerald-50 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-200",
      new: "bg-sky-50 text-sky-900 dark:bg-sky-400/15 dark:text-sky-200",
      paused: "bg-orange-100 text-orange-900 dark:bg-orange-400/15 dark:text-orange-200",
      suspended: "bg-stone-200 text-stone-700 line-through decoration-stone-400 dark:bg-stone-400/15 dark:text-stone-300 dark:decoration-stone-500",
      danger: "bg-red-100 text-red-900 dark:bg-red-400/15 dark:text-red-200",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...props }: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
