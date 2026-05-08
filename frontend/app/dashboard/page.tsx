import Link from "next/link";
import { dateRangeOptions, getDashboardMetrics, type TrendMetric } from "../../lib/dashboard-metrics";

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

function formatAppointment(value: string | null) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function dateRangeLabel(value: string) {
  return dateRangeOptions.find((option) => option.value === value)?.label ?? "Last 30 days";
}

function MetricCard({
  label,
  value,
  note,
  eyebrow,
  tone = "neutral"
}: {
  label: string;
  value: string;
  note: string;
  eyebrow?: string;
  tone?: "neutral" | "dark" | "success" | "warning";
}) {
  const toneClass = {
    neutral: "border-neutral-200 bg-white text-neutral-950",
    dark: "border-neutral-950 bg-neutral-950 text-white",
    success: "border-emerald-200 bg-emerald-50 text-emerald-950",
    warning: "border-amber-200 bg-amber-50 text-amber-950"
  }[tone];

  return (
    <article className={`rounded-xl border p-5 shadow-sm ${toneClass}`}>
      {eyebrow ? (
        <p className={tone === "dark" ? "text-xs font-semibold uppercase text-neutral-400" : "text-xs font-semibold uppercase text-neutral-500"}>
          {eyebrow}
        </p>
      ) : null}
      <p className={["text-sm font-medium", eyebrow ? "mt-2" : "", tone === "dark" ? "text-neutral-300" : "text-neutral-500"].join(" ")}>
        {label}
      </p>
      <p className="mt-3 text-3xl font-semibold tracking-normal">{value}</p>
      <p className={tone === "dark" ? "mt-3 text-sm text-neutral-300" : "mt-3 text-sm text-neutral-500"}>{note}</p>
    </article>
  );
}

function TrendChart({ trends }: { trends: TrendMetric[] }) {
  const maxCalls = Math.max(1, ...trends.map((item) => item.totalCalls));

  if (trends.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500">
        No call volume data for this range.
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      {trends.map((item) => {
        const callWidth = Math.max(4, (item.totalCalls / maxCalls) * 100);
        const bookingWidth = item.totalCalls > 0 ? Math.max(4, (item.confirmedBookings / maxCalls) * 100) : 0;

        return (
          <div key={item.label} className="grid gap-2">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-semibold text-neutral-800">{item.label}</span>
              <span className="text-right text-neutral-500">
                {item.totalCalls.toLocaleString("en-US")} calls / {item.bookingRate.toFixed(1)}%
              </span>
            </div>
            <div className="relative h-5 overflow-hidden rounded-md bg-neutral-100">
              <div className="absolute inset-y-0 left-0 rounded-md bg-neutral-950" style={{ width: `${callWidth}%` }} />
              <div
                className="absolute inset-y-1 left-1 rounded bg-emerald-400"
                style={{ width: `${bookingWidth}%` }}
                title={`${item.confirmedBookings.toLocaleString("en-US")} confirmed bookings`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams;
  const metrics = await getDashboardMetrics(params?.range);
  const activeRangeLabel = dateRangeLabel(metrics.dateRange);
  const maxLanguageCalls = Math.max(1, ...metrics.languageUsage.map((item) => item.calls));
  const maxPeakCalls = Math.max(1, ...metrics.peakCallHours.map((item) => item.calls));

  return (
    <section className="min-h-screen px-5 py-6 sm:px-8 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
          <div className="grid gap-6 p-6 lg:grid-cols-[1fr_320px] lg:p-8">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Operations dashboard</p>
              <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-normal text-neutral-950">Inbound voice performance</h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-neutral-600">
                Call volume, booking conversion, and follow-up signals for the selected reporting range.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <span className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm font-semibold text-neutral-800">
                  Range: {activeRangeLabel}
                </span>
                <Link
                  href="/crm"
                  className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800"
                >
                  Review calls
                </Link>
                <Link
                  href="/agent-config"
                  className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-800 hover:border-neutral-950"
                >
                  Configure agent
                </Link>
              </div>
            </div>
            <form className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
              <label htmlFor="range" className="text-sm font-semibold text-neutral-900">
                Reporting range
              </label>
              <select
                id="range"
                name="range"
                defaultValue={metrics.dateRange}
                className="mt-3 h-10 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-950 outline-none focus:border-neutral-950"
              >
                {dateRangeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button type="submit" className="mt-3 h-10 w-full rounded-md bg-neutral-950 text-sm font-semibold text-white">
                Apply range
              </button>
            </form>
          </div>
        </div>

        {metrics.error ? (
          <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {metrics.error}
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Total calls"
            value={metrics.totalCalls.toLocaleString("en-US")}
            note={`Inbound call records in ${activeRangeLabel.toLowerCase()}`}
          />
          <MetricCard
            label="Booking conversion"
            value={`${metrics.bookingRate.toFixed(1)}%`}
            note="Confirmed bookings / total calls"
            tone="success"
          />
          <MetricCard label="Average duration" value={formatDuration(metrics.avgDurationSeconds)} note="Calls with recorded duration" />
          <MetricCard
            label="Missed / failed"
            value={metrics.failedCalls.toLocaleString("en-US")}
            note="Failed, missed, or errored calls"
            tone={metrics.failedCalls > 0 ? "warning" : "neutral"}
          />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <MetricCard
            tone="dark"
            eyebrow="Business goal"
            label="Booked appointments"
            value={metrics.confirmedBookings.toLocaleString("en-US")}
            note="Confirmed booking records"
          />
          <MetricCard label="Repeat callers" value={metrics.repeatCallers.toLocaleString("en-US")} note="Phone numbers with 2+ calls" />
        </div>

        <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-neutral-500">Call volume and booking success</p>
              <h2 className="mt-1 text-xl font-semibold text-neutral-950">Confirmed bookings over time</h2>
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-semibold">
              <span className="rounded-full bg-neutral-950 px-3 py-1 text-white">Calls</span>
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-900">Confirmed bookings</span>
            </div>
          </div>
          <div className="mt-6">
            <TrendChart trends={metrics.trends} />
          </div>
        </section>

        <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_1fr]">
          <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-neutral-500">Language usage</p>
                <h2 className="mt-1 text-xl font-semibold text-neutral-950">Configured language per call</h2>
              </div>
              <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-600">
                en-IN / hi-IN / kn-IN
              </span>
            </div>
            <div className="mt-6 grid gap-4">
              {metrics.languageUsage.map((item) => (
                <div key={item.label} className="grid gap-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-neutral-800">{item.label}</span>
                    <span className="text-neutral-500">{item.calls.toLocaleString("en-US")} calls</span>
                  </div>
                  <div className="h-3 rounded-full bg-neutral-100">
                    <div
                      className="h-3 rounded-full bg-neutral-950"
                      style={{ width: `${Math.max(5, (item.calls / maxLanguageCalls) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
              {metrics.languageUsage.length === 0 ? (
                <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500">
                  No language data for this range.
                </p>
              ) : null}
            </div>
          </section>

          <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-neutral-500">Peak call hours</p>
                <h2 className="mt-1 text-xl font-semibold text-neutral-950">Busiest hours in IST</h2>
              </div>
              <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-600">
                Top 3
              </span>
            </div>
            <div className="mt-6 grid gap-4">
              {metrics.peakCallHours.map((item) => (
                <div key={item.hour} className="grid gap-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-neutral-800">{formatHour(item.hour)}</span>
                    <span className="text-neutral-500">{item.calls.toLocaleString("en-US")} calls</span>
                  </div>
                  <div className="h-3 rounded-full bg-neutral-100">
                    <div
                      className="h-3 rounded-full bg-neutral-950"
                      style={{ width: `${Math.max(5, (item.calls / maxPeakCalls) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
              {metrics.peakCallHours.length === 0 ? (
                <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500">
                  No call-hour data for this range.
                </p>
              ) : null}
            </div>
          </section>
        </div>

        <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-neutral-500">Booked appointments</p>
              <h2 className="mt-1 text-xl font-semibold text-neutral-950">Latest confirmed bookings</h2>
            </div>
            <Link
              href="/calendar"
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-semibold text-neutral-800 hover:border-neutral-950"
            >
              Open calendar
            </Link>
          </div>
          <div className="mt-5 grid gap-3">
            {metrics.recentBookings.map((booking) => (
              <div
                key={booking.callId}
                className="grid gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center"
              >
                <div>
                  <p className="font-semibold text-neutral-950">{booking.callerName}</p>
                  <p className="mt-1 text-sm text-neutral-500">{booking.phoneNumber}</p>
                </div>
                <div className="text-sm text-neutral-700 sm:text-right">
                  <p className="font-semibold text-neutral-950">{formatAppointment(booking.appointmentTime)}</p>
                  <p className="mt-1 text-xs text-neutral-500">Cal.com confirmed</p>
                </div>
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  <span
                    className={[
                      "rounded-md border px-2 py-1 text-xs font-semibold",
                      booking.smsSent
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-amber-200 bg-amber-50 text-amber-800"
                    ].join(" ")}
                  >
                    SMS {booking.smsSent ? "sent" : "pending"}
                  </span>
                  <Link
                    href={`/crm/${booking.callRef}`}
                    className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs font-semibold text-neutral-800 hover:border-neutral-950"
                  >
                    Transcript
                  </Link>
                </div>
              </div>
            ))}
            {metrics.recentBookings.length === 0 ? (
              <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500">
                No confirmed bookings for this range.
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </section>
  );
}
