import { dateRangeOptions, getDashboardMetrics } from "../../lib/dashboard-metrics";

export const dynamic = "force-dynamic";

type DashboardPageProps = {
  searchParams?: Promise<{
    range?: string;
  }>;
};

function formatDuration(totalSeconds: number) {
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function formatHour(hour: number) {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: true }).format(date);
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams;
  const metrics = await getDashboardMetrics(params?.range);
  const metricCards = [
    {
      label: "Total Calls",
      value: metrics.totalCalls.toLocaleString("en-US"),
      note: "Logged inbound calls"
    },
    {
      label: "Booked Appointments",
      value: metrics.confirmedBookings.toLocaleString("en-US"),
      note: "Confirmed bookings"
    },
    {
      label: "Booking Rate",
      value: `${metrics.bookingRate.toFixed(1)}%`,
      note: "Confirmed bookings / total calls"
    },
    {
      label: "Avg Duration",
      value: formatDuration(metrics.avgDurationSeconds),
      note: "Mean completed call length"
    },
    {
      label: "Failed Calls",
      value: metrics.failedCalls.toLocaleString("en-US"),
      note: "Failed, missed, or errored calls"
    },
    {
      label: "Repeat Callers",
      value: metrics.repeatCallers.toLocaleString("en-US"),
      note: "Phone numbers with 2+ calls"
    }
  ];

  const maxLanguageCalls = Math.max(1, ...metrics.languageUsage.map((item) => item.calls));
  const maxPeakCalls = Math.max(1, ...metrics.peakCallHours.map((item) => item.calls));

  return (
    <section className="min-h-screen px-5 py-6 sm:px-8 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 border-b border-neutral-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-neutral-500">Live operations</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-neutral-950">Analytics Dashboard</h1>
          </div>
          <form className="flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-600">
            <label htmlFor="range" className="font-medium text-neutral-700">
              Range
            </label>
            <select
              id="range"
              name="range"
              defaultValue={metrics.dateRange}
              className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-950"
            >
              {dateRangeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded-md bg-neutral-950 px-3 py-1 text-sm font-medium text-white">
              Apply
            </button>
          </form>
        </div>

        {metrics.error ? (
          <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {metrics.error}
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {metricCards.map((metric) => (
            <article key={metric.label} className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-medium text-neutral-500">{metric.label}</p>
              <p className="mt-4 text-3xl font-semibold tracking-normal text-neutral-950">{metric.value}</p>
              <p className="mt-3 text-sm text-neutral-500">{metric.note}</p>
            </article>
          ))}
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-neutral-500">Language usage</p>
                <h2 className="mt-1 text-lg font-semibold text-neutral-950">Calls by configured language</h2>
              </div>
            </div>
            <div className="mt-5 grid gap-3">
              {metrics.languageUsage.map((item) => (
                <div key={item.label} className="grid gap-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-neutral-700">{item.label}</span>
                    <span className="text-neutral-500">{item.calls.toLocaleString("en-US")}</span>
                  </div>
                  <div className="h-2 rounded-full bg-neutral-100">
                    <div
                      className="h-2 rounded-full bg-neutral-950"
                      style={{ width: `${Math.max(4, (item.calls / maxLanguageCalls) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
              {metrics.languageUsage.length === 0 ? (
                <p className="text-sm text-neutral-500">No language data for this range.</p>
              ) : null}
            </div>
          </section>

          <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-neutral-500">Peak call hours</p>
            <h2 className="mt-1 text-lg font-semibold text-neutral-950">Busiest hours in IST</h2>
            <div className="mt-5 grid gap-3">
              {metrics.peakCallHours.map((item) => (
                <div key={item.hour} className="grid gap-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-neutral-700">{formatHour(item.hour)}</span>
                    <span className="text-neutral-500">{item.calls.toLocaleString("en-US")}</span>
                  </div>
                  <div className="h-2 rounded-full bg-neutral-100">
                    <div
                      className="h-2 rounded-full bg-neutral-950"
                      style={{ width: `${Math.max(4, (item.calls / maxPeakCalls) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
              {metrics.peakCallHours.length === 0 ? (
                <p className="text-sm text-neutral-500">No call-hour data for this range.</p>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
