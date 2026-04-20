import { z } from "zod";

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type PaginationParams = z.infer<typeof paginationQuery>;

export function parsePagination(
  query: Record<string, unknown>
): PaginationParams {
  const result = paginationQuery.safeParse(query);
  if (result.success) return result.data;
  return { limit: 50, offset: 0 };
}

export type PaginatedResponse<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};
