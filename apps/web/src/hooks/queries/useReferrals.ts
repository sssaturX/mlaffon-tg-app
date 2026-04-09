import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getToken } from "../../api";
import { fetchReferrals } from "../../query/fetchers";
import { queryKeys } from "../../query/queryKeys";

const STALE_REFERRALS = 1000 * 60 * 5;

export function useReferrals() {
  return useQuery({
    queryKey: queryKeys.referrals.list(),
    queryFn: fetchReferrals,
    enabled: Boolean(getToken()),
    staleTime: STALE_REFERRALS,
  });
}

export function useInvalidateReferrals() {
  const qc = useQueryClient();
  return () =>
    void qc.invalidateQueries({ queryKey: queryKeys.referrals.list() });
}
