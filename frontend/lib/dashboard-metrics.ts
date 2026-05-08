import "server-only";
import { queryPostgres } from "./postgres-server";
import { encodeCallRef } from "./operations-data";

export type DateRangeKey = "today" | "7d" | "30d" | "all";

type MetricRow = {
  total_calls: string | number | null;
  confirmed_bookings: string | number | null;
  failed_calls: string | number | null;
  avg_duration_seconds: string | number | null;
  repeat_callers: string | number | null;
};

type LanguageUsageRow = {
  language_bucket: string | null;
  calls: string | number | null;
};

type PeakHourRow = {
  call_hour: string | number | null;
  calls: string | number | null;
};

type RecentBookingRow = {
  call_id: string;
  appointment_time: string | null;
  status: string | null;
  sms_sent: boolean | null;
  phone_number: string | null;
  caller_name: string | null;
};

type TrendRow = {
  bucket: string | Date | null;
  total_calls: string | number | null;
  confirmed_bookings: string | number | null;
};

export type LanguageUsageMetric = {
  label: string;
  calls: number;
};

export type PeakHourMetric = {
  hour: number;
  calls: number;
};

export type RecentBookingMetric = {
  callId: string;
  callRef: string;
  appointmentTime: string | null;
  status: string;
  smsSent: boolean;
  phoneNumber: string;
  callerName: string;
};

export type TrendMetric = {
  label: string;
  totalCalls: number;
  confirmedBookings: number;
  bookingRate: number;
};

export type DashboardMetrics = {
  totalCalls: number;
  bookingRate: number;
  avgDurationSeconds: number;
  failedCalls: number;
  confirmedBookings: number;
  repeatCallers: number;
  languageUsage: LanguageUsageMetric[];
  peakCallHours: PeakHourMetric[];
  trends: TrendMetric[];
  recentBookings: RecentBookingMetric[];
  dateRange: DateRangeKey;
  configured: boolean;
  error?: string;
};

export const dateRangeOptions: Array<{ label: string; value: DateRangeKey }> = [
  { label: "Today", value: "today" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
  { label: "All time", value: "all" }
];

const emptyMetrics: DashboardMetrics = {
  totalCalls: 0,
  bookingRate: 0,
  avgDurationSeconds: 0,
  failedCalls: 0,
  confirmedBookings: 0,
  repeatCallers: 0,
  languageUsage: [],
  peakCallHours: [],
  trends: [],
  recentBookings: [],
  dateRange: "30d",
  configured: false
};

function normalizeDateRange(value?: string | null): DateRangeKey {
  return dateRangeOptions.some((option) => option.value === value) ? (value as DateRangeKey) : "30d";
}

function dateRangeCondition(columnName: string, dateRange: DateRangeKey) {
  if (dateRange === "today") {
    return `${columnName} >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')`;
  }
  if (dateRange === "7d") {
    return `${columnName} >= now() - interval '7 days'`;
  }
  if (dateRange === "30d") {
    return `${columnName} >= now() - interval '30 days'`;
  }
  return "true";
}

function toNumber(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function languageLabel(bucket: string | null) {
  if (bucket === "mixed") {
    return "Mixed";
  }
  if (bucket === "hi-IN") {
    return "Hindi";
  }
  if (bucket === "kn-IN") {
    return "Kannada";
  }
  return "English";
}

function trendBucketExpression(dateRange: DateRangeKey) {
  if (dateRange === "today") {
    return "date_trunc('hour', c.start_time at time zone 'Asia/Kolkata')";
  }
  return "date_trunc('day', c.start_time at time zone 'Asia/Kolkata')";
}

function trendLimit(dateRange: DateRangeKey) {
  if (dateRange === "today") {
    return 24;
  }
  if (dateRange === "7d") {
    return 7;
  }
  if (dateRange === "30d") {
    return 30;
  }
  return 30;
}

function formatTrendLabel(value: string | Date | null, dateRange: DateRangeKey) {
  if (!value) {
    return "Unknown";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  if (dateRange === "today") {
    return new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: true }).format(date);
  }

  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short" }).format(date);
}

export async function getDashboardMetrics(range?: string | null): Promise<DashboardMetrics> {
  const dateRange = normalizeDateRange(range);
  const callDateFilter = dateRangeCondition("start_time", dateRange);
  const trendDateFilter = dateRangeCondition("c.start_time", dateRange);
  const trendBucket = trendBucketExpression(dateRange);
  const trendRows = trendLimit(dateRange);

  try {
    const [metricsResult, languageResult, peakHourResult, trendResult, recentBookingsResult] = await Promise.all([
      queryPostgres<MetricRow>(
        `
        with filtered_calls as (
          select id, phone_number, duration, status
          from call_logs
          where ${callDateFilter}
        )
        select
          count(*) as total_calls,
          (
            select count(*)
            from bookings b
            join filtered_calls c on c.id = b.call_id
            where b.status = 'confirmed'
          ) as confirmed_bookings,
          count(*) filter (where lower(coalesce(status, '')) in ('failed', 'missed', 'error')) as failed_calls,
          coalesce(round(avg(duration) filter (where duration is not null and duration > 0)), 0) as avg_duration_seconds,
          (
            select count(*)
            from (
              select phone_number
              from filtered_calls
              where phone_number is not null and phone_number <> 'unknown'
              group by phone_number
              having count(*) > 1
            ) repeat_callers
          ) as repeat_callers
        from filtered_calls
        `
      ),
      queryPostgres<LanguageUsageRow>(
        `
        select
          case when mixed_language_enabled then 'mixed' else coalesce(language_code, 'en-IN') end as language_bucket,
          count(*) as calls
        from call_logs
        where ${callDateFilter}
        group by language_bucket
        order by calls desc, language_bucket asc
        `
      ),
      queryPostgres<PeakHourRow>(
        `
        select extract(hour from start_time at time zone 'Asia/Kolkata')::int as call_hour, count(*) as calls
        from call_logs
        where ${callDateFilter}
        group by call_hour
        order by calls desc, call_hour asc
        limit 3
        `
      ),
      queryPostgres<TrendRow>(
        `
        select *
        from (
          select
            ${trendBucket} as bucket,
            count(*) as total_calls,
            count(*) filter (where b.status = 'confirmed') as confirmed_bookings
          from call_logs c
          left join bookings b on b.call_id = c.id
          where ${trendDateFilter}
          group by bucket
          order by bucket desc
          limit ${trendRows}
        ) series
        order by bucket asc
        `
      ),
      queryPostgres<RecentBookingRow>(
        `
        select
          b.call_id,
          b.appointment_time,
          b.status,
          b.sms_sent,
          coalesce(b.caller_phone, c.phone_number) as phone_number,
          coalesce(b.caller_name, c.caller_name) as caller_name
        from bookings b
        join call_logs c on c.id = b.call_id
        where b.status = 'confirmed'
          and ${dateRangeCondition("c.start_time", dateRange)}
        order by b.appointment_time desc nulls last
        limit 5
        `
      )
    ]);

    const metrics = metricsResult.rows[0];
    const totalCalls = toNumber(metrics?.total_calls);
    const confirmedBookings = toNumber(metrics?.confirmed_bookings);

    return {
      totalCalls,
      bookingRate: totalCalls > 0 ? Math.round((confirmedBookings / totalCalls) * 1000) / 10 : 0,
      avgDurationSeconds: toNumber(metrics?.avg_duration_seconds),
      failedCalls: toNumber(metrics?.failed_calls),
      confirmedBookings,
      repeatCallers: toNumber(metrics?.repeat_callers),
      languageUsage: languageResult.rows.map((row) => ({
        label: languageLabel(row.language_bucket),
        calls: toNumber(row.calls)
      })),
      peakCallHours: peakHourResult.rows.map((row) => ({
        hour: toNumber(row.call_hour),
        calls: toNumber(row.calls)
      })),
      trends: trendResult.rows.map((row) => {
        const total = toNumber(row.total_calls);
        const confirmed = toNumber(row.confirmed_bookings);

        return {
          label: formatTrendLabel(row.bucket, dateRange),
          totalCalls: total,
          confirmedBookings: confirmed,
          bookingRate: total > 0 ? Math.round((confirmed / total) * 1000) / 10 : 0
        };
      }),
      recentBookings: recentBookingsResult.rows.map((row) => ({
        callId: row.call_id,
        callRef: encodeCallRef(row.call_id),
        appointmentTime: row.appointment_time,
        status: row.status ?? "confirmed",
        smsSent: Boolean(row.sms_sent),
        phoneNumber: row.phone_number ?? "Unknown",
        callerName: row.caller_name ?? "Unknown"
      })),
      dateRange,
      configured: true
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load dashboard metrics.";

    return {
      ...emptyMetrics,
      dateRange,
      configured: true,
      error: message
    };
  }
}
