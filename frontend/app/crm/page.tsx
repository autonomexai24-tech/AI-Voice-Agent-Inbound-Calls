import Link from "next/link";
import { getCrmCalls } from "../../lib/operations-data";

export const dynamic = "force-dynamic";

type CrmPageProps = {
  searchParams?: Promise<{
    q?: string;
    from?: string;
    to?: string;
    booking?: string;
    language?: string;
    repeat?: string;
    page?: string;
  }>;
};

function formatDateTime(value: string | null) {
  if (!value) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatDuration(value: number | null) {
  if (!value || value <= 0) {
    return "0s";
  }

  const minutes = Math.floor(value / 60);
  const seconds = value % 60;

  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function statusClass(status: string) {
  const normalized = status.toLowerCase();

  if (normalized === "confirmed" || normalized === "completed" || normalized === "booked") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (normalized === "failed" || normalized === "missed" || normalized === "error") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }

  return "border-neutral-200 bg-neutral-50 text-neutral-700";
}

function buildPageHref(params: Awaited<CrmPageProps["searchParams"]>, page: number) {
  const nextParams = new URLSearchParams();
  for (const key of ["q", "from", "to", "booking", "language", "repeat"] as const) {
    const value = params?.[key];
    if (value) {
      nextParams.set(key, value);
    }
  }
  nextParams.set("page", String(page));
  return `/crm?${nextParams.toString()}`;
}

export default async function CrmPage({ searchParams }: CrmPageProps) {
  const params = await searchParams;
  const result = await getCrmCalls({
    query: params?.q,
    from: params?.from,
    to: params?.to,
    booking: params?.booking,
    language: params?.language,
    repeat: params?.repeat,
    page: params?.page
  });
  const firstRow = result.totalRows === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const lastRow = Math.min(result.totalRows, result.page * result.pageSize);

  return (
    <section className="min-h-screen px-5 py-6 sm:px-8 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Operator CRM</p>
              <h1 className="mt-3 text-4xl font-semibold tracking-normal text-neutral-950">Caller history</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-600">
                Search callers, inspect booking outcomes, review transcripts, and spot repeat callers without leaving
                the operations dashboard.
              </p>
            </div>
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
              Showing <span className="font-semibold text-neutral-950">{firstRow}-{lastRow}</span> of{" "}
              <span className="font-semibold text-neutral-950">{result.totalRows.toLocaleString("en-US")}</span> calls
            </div>
          </div>
        </div>

        <form className="mt-6 grid gap-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm xl:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_1fr_auto]">
          <label className="grid gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Phone or caller name</span>
            <input
              name="q"
              defaultValue={params?.q ?? ""}
              placeholder="Search by phone or name"
              className="h-10 rounded-md border border-neutral-300 px-3 text-sm text-neutral-950 outline-none focus:border-neutral-950"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">From</span>
            <input
              name="from"
              type="date"
              defaultValue={params?.from ?? ""}
              className="h-10 rounded-md border border-neutral-300 px-3 text-sm text-neutral-950 outline-none focus:border-neutral-950"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">To</span>
            <input
              name="to"
              type="date"
              defaultValue={params?.to ?? ""}
              className="h-10 rounded-md border border-neutral-300 px-3 text-sm text-neutral-950 outline-none focus:border-neutral-950"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Booking</span>
            <select
              name="booking"
              defaultValue={params?.booking ?? ""}
              className="h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-950 outline-none focus:border-neutral-950"
            >
              <option value="">All outcomes</option>
              <option value="confirmed">Booked</option>
              <option value="pending">Booking issue</option>
              <option value="none">No booking</option>
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Language</span>
            <select
              name="language"
              defaultValue={params?.language ?? ""}
              className="h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-950 outline-none focus:border-neutral-950"
            >
              <option value="">All languages</option>
              <option value="en-IN">English</option>
              <option value="hi-IN">Hindi</option>
              <option value="kn-IN">Kannada</option>
              <option value="mixed">Mixed</option>
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Caller type</span>
            <select
              name="repeat"
              defaultValue={params?.repeat ?? ""}
              className="h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-950 outline-none focus:border-neutral-950"
            >
              <option value="">All callers</option>
              <option value="true">Repeat only</option>
            </select>
          </label>
          <div className="flex items-end">
            <button type="submit" className="h-10 w-full rounded-md bg-neutral-950 px-4 text-sm font-semibold text-white">
              Filter
            </button>
          </div>
        </form>

        {result.error ? (
          <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {result.error}
          </div>
        ) : null}

        <div className="mt-6 grid gap-4">
          {result.rows.map((row) => (
            <article key={row.id} className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
              <div className="grid gap-5 lg:grid-cols-[280px_1fr_220px]">
                <div>
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-950 text-sm font-semibold text-white">
                      {row.callerName.slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <h2 className="font-semibold text-neutral-950">{row.callerName}</h2>
                      <p className="mt-1 text-sm text-neutral-500">{row.phoneNumber}</p>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-neutral-600">
                    <div className="rounded-lg bg-neutral-50 p-3">
                      <p className="uppercase text-neutral-400">Repeat</p>
                      <p className="mt-1 font-semibold text-neutral-900">{row.repeatCount} calls</p>
                    </div>
                    <div className="rounded-lg bg-neutral-50 p-3">
                      <p className="uppercase text-neutral-400">Language</p>
                      <p className="mt-1 font-semibold text-neutral-900">{row.languageLabel}</p>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex flex-wrap gap-2">
                    <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${statusClass(row.status)}`}>
                      Call {row.status}
                    </span>
                    <span
                      className={`rounded-md border px-2 py-1 text-xs font-semibold ${statusClass(row.bookingStatus)}`}
                    >
                      Booking {row.bookingStatus}
                    </span>
                    {row.smsSent !== null ? (
                      <span className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs font-semibold text-neutral-700">
                        SMS {row.smsSent ? "sent" : "pending"}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-4 text-sm leading-6 text-neutral-700">{row.summary}</p>
                  <div className="mt-4 text-xs text-neutral-500">
                    {formatDateTime(row.startTime)} · {formatDuration(row.duration)}
                  </div>
                </div>

                <div className="flex flex-col justify-between gap-3 lg:items-end">
                  {row.recordingUrl ? (
                    <a
                      href={row.recordingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md border border-neutral-300 px-3 py-2 text-center text-sm font-semibold text-neutral-800 hover:border-neutral-950"
                    >
                      Recording
                    </a>
                  ) : null}
                  <Link
                    href={`/crm/${row.id}`}
                    className="rounded-md bg-neutral-950 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-neutral-800"
                  >
                    Open transcript
                  </Link>
                </div>
              </div>
            </article>
          ))}
          {result.rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-4 py-14 text-center text-sm text-neutral-500">
              No call records found.
            </div>
          ) : null}
        </div>

        <div className="mt-6 flex items-center justify-between rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-600 shadow-sm">
          <span>
            Page {result.page} · {result.pageSize} per page
          </span>
          <div className="flex gap-2">
            {result.hasPreviousPage ? (
              <Link href={buildPageHref(params, result.page - 1)} className="rounded-md border border-neutral-300 px-3 py-1 font-semibold text-neutral-800">
                Previous
              </Link>
            ) : null}
            {result.hasNextPage ? (
              <Link href={buildPageHref(params, result.page + 1)} className="rounded-md border border-neutral-300 px-3 py-1 font-semibold text-neutral-800">
                Next
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
