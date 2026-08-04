/**
 * v2.12.0 — Yetu Sacco portal summary cards.
 * WebView 51 safe: no dvh, no backdrop-filter, margin-based spacing.
 */
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Wallet, CalendarDays, TrendingUp, Clock } from 'lucide-react';
import { formatDateTime, formatMoney, type SaccoSummary } from '../saccoApi';

interface Props {
  summary?: SaccoSummary;
  isLoading: boolean;
}

const Tile = ({
  label,
  value,
  icon,
}: { label: string; value: string; icon: React.ReactNode }) => (
  <Card className="border-border">
    <CardContent className="p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <p className="mt-2 text-lg font-semibold text-foreground break-words">{value}</p>
    </CardContent>
  </Card>
);

export const SummaryCards = ({ summary, isLoading }: Props) => {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="p-1">
            <Skeleton className="h-[86px] w-full rounded-lg" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4">
      <div className="p-1">
        <Tile
          label="Today"
          value={formatMoney(summary?.today_total ?? 0)}
          icon={<Wallet className="h-4 w-4" />}
        />
      </div>

      <div className="p-1">
        <Tile
          label="This month"
          value={formatMoney(summary?.month_total ?? 0)}
          icon={<CalendarDays className="h-4 w-4" />}
        />
      </div>
      <div className="p-1">
        <Tile
          label="This year"
          value={formatMoney(summary?.year_total ?? 0)}
          icon={<TrendingUp className="h-4 w-4" />}
        />
      </div>
      <div className="p-1">
        <Tile
          label="Last deposit"
          value={formatDateTime(summary?.last_deposit_date ?? null)}
          icon={<Clock className="h-4 w-4" />}
        />
      </div>
    </div>
  );
};

export default SummaryCards;
