/**
 * v2.12.3 — Yetu Sacco portal data hooks (react-query).
 * Keys include every filter so pagination/sorting/search cache correctly.
 *
 * Live refresh: the portal must reflect new webhook deposits without the
 * member pressing refresh. We poll every 20s (foreground + online only) and
 * refetch on window focus / reconnect. Short polling is used deliberately —
 * the backend is a plain Express app behind Apache and WebView 51 has no
 * reliable WebSocket story.
 */
import { useQuery } from '@tanstack/react-query';
import {
  fetchSaccoSummary,
  fetchSaccoTransactions,
  type SaccoQuery,
  type SaccoSummary,
  type SaccoTransactionPage,
} from './saccoApi';

const LIVE_POLL_MS = 20_000;

/** Poll only while the device is online; react-query pauses in background. */
const livePoll = () => (navigator.onLine ? LIVE_POLL_MS : false);

export const useSaccoSummary = (userid?: string) =>
  useQuery<SaccoSummary>({
    queryKey: ['sacco', 'summary', userid],
    queryFn: () => fetchSaccoSummary(userid as string),
    enabled: !!userid,
    staleTime: 10_000,
    retry: 1,
    refetchInterval: livePoll,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

export const useSaccoTransactions = (userid: string | undefined, query: SaccoQuery) =>
  useQuery<SaccoTransactionPage>({
    queryKey: ['sacco', 'transactions', userid, query],
    queryFn: () => fetchSaccoTransactions(userid as string, query),
    enabled: !!userid,
    staleTime: 10_000,
    placeholderData: (prev) => prev,
    retry: 1,
    refetchInterval: livePoll,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

