/**
 * v2.12.0 — Yetu Sacco portal data hooks (react-query).
 * Keys include every filter so pagination/sorting/search cache correctly.
 */
import { useQuery } from '@tanstack/react-query';
import {
  fetchSaccoSummary,
  fetchSaccoTransactions,
  type SaccoQuery,
  type SaccoSummary,
  type SaccoTransactionPage,
} from './saccoApi';

export const useSaccoSummary = (userid?: string) =>
  useQuery<SaccoSummary>({
    queryKey: ['sacco', 'summary', userid],
    queryFn: () => fetchSaccoSummary(userid as string),
    enabled: !!userid,
    staleTime: 60_000,
    retry: 1,
  });

export const useSaccoTransactions = (userid: string | undefined, query: SaccoQuery) =>
  useQuery<SaccoTransactionPage>({
    queryKey: ['sacco', 'transactions', userid, query],
    queryFn: () => fetchSaccoTransactions(userid as string, query),
    enabled: !!userid,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    retry: 1,
  });
