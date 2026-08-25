import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Wide tables scroll inside their own container, never the page body. */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="w-full overflow-x-auto">{children}</div>;
}

export function Table({ children }: { children: ReactNode }) {
  return <table className="w-full min-w-[42rem] border-collapse text-sm">{children}</table>;
}

export function Th({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-border-base bg-surface-muted px-4 py-2.5 text-left text-[11px] font-semibold tracking-wide text-muted uppercase",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <td className={cn("border-b border-border-base px-4 py-3 align-middle", className)}>
      {children}
    </td>
  );
}

export function Tr({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <tr className={cn("hover:bg-surface-muted/60", className)}>{children}</tr>;
}

export function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-subtle">
        {message}
      </td>
    </tr>
  );
}
