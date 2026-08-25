"use client";

import { Button } from "./button";
import type { Paginated } from "@/types";

export function Pagination<T>({
  page,
  data,
  onPageChange,
}: {
  page: number;
  data: Paginated<T> | null;
  onPageChange: (page: number) => void;
}) {
  if (!data || data.total === 0) return null;

  const from = (data.page - 1) * data.limit + 1;
  const to = Math.min(data.page * data.limit, data.total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-base px-5 py-3">
      <p className="text-xs text-muted tabular">
        {from}–{to} of {data.total}
      </p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          Previous
        </Button>
        <span className="text-xs text-muted tabular">
          Page {data.page} / {data.totalPages}
        </span>
        <Button
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= data.totalPages}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
