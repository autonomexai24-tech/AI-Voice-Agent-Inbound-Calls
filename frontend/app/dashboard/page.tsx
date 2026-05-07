import { getDashboardMetrics } from "../../lib/dashboard-metrics";

export const dynamic = "force-dynamic";

function formatDuration(totalSeconds: number) {
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export default async function DashboardPage() {
  const metrics = await getDashboardMetrics();
  const metricCards = [
    {
      label: "Total Calls",
      value: metrics.totalCalls.toLocaleString("en-US"),
      note: "All logged inbound calls"
    },
    {
      label: "Booking Rate",
      value: `${metrics.bookingRate.toFixed(1)}%`,
      note: `${metrics.confirmedBookings.toLocaleString("en-US")} confirmed bookings`
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
    }
  ];

  return (
    <section className="min-h-screen px-5 py-6 sm:px-8 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 border-b border-neutral-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-neutral-500">Live operations</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-neutral-950">Analytics Dashboard</h1>
          </div>
          <div className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-600">
            Supabase service role server fetch
          </div>
        </div>

        {metrics.error ? (
          <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {metrics.error}
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {metricCards.map((metric) => (
            <article key={metric.label} className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-medium text-neutral-500">{metric.label}</p>
              <p className="mt-4 text-3xl font-semibold tracking-normal text-neutral-950">{metric.value}</p>
              <p className="mt-3 text-sm text-neutral-500">{metric.note}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
