import Link from "next/link";
import { getCrmCalls } from "../../lib/operations-data";

export const dynamic = "force-dynamic";

type CrmPageProps = {
  searchParams?: Promise<{
    q?: string;
    from?: string;
    to?: string;
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
  for (const key of ["q", "from", "to"] as const) {
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
  const result = await getCrmCalls(params);
  const firstRow = result.totalRows === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const lastRow = Math.min(result.totalRows, result.page * result.pageSize);

  return (
    <section className="min-h-screen px-5 py-6 sm:px-8 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 border-b border-neutral-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-neutral-500">Customer records</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-neutral-950">CRM Calls</h1>
          </div>
          <div className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-600">
            {firstRow}-{lastRow} of {result.totalRows.toLocaleString("en-US")} calls
          </div>
        </div>

        <form className="mt-6 grid gap-3 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm md:grid-cols-[1.5fr_1fr_1fr_auto]">
          <label className="grid gap-1">
            <span className="text-xs font-medium uppercase text-neutral-500">Phone or name</span>
            <input
              name="q"
              defaultValue={params?.q ?? ""}
              placeholder="Search callers"
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-950 outline-none focus:border-neutral-950"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium uppercase text-neutral-500">From</span>
            <input
              name="from"
              type="date"
              defaultValue={params?.from ?? ""}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-950 outline-none focus:border-neutral-950"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium uppercase text-neutral-500">To</span>
            <input
              name="to"
              type="date"
              defaultValue={params?.to ?? ""}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-950 outline-none focus:border-neutral-950"
            />
          </label>
          <div className="flex items-end">
            <button type="submit" className="w-full rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white">
              Filter
            </button>
          </div>
        </form>

        {result.error ? (
          <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {result.error}
          </div>
        ) : null}

        <div className="mt-6 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 text-left text-sm">
              <thead className="bg-neutral-50 text-xs font-semibold uppercase text-neutral-500">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    Caller
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Started
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Booking
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Language
                  </th>
                  <th scope="col" className="min-w-[320px] px-4 py-3">
                    Summary
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Review
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {result.rows.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-4">
                      <div className="font-medium text-neutral-950">{row.callerName}</div>
                      <div className="mt-1 text-neutral-500">{row.phoneNumber}</div>
                      {row.repeatCount > 1 ? (
                        <div className="mt-2 text-xs font-medium text-neutral-500">{row.repeatCount} calls</div>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-neutral-600">
                      <div>{formatDateTime(row.startTime)}</div>
                      <div className="mt-1 text-xs text-neutral-500">{formatDuration(row.duration)}</div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4">
                      <span className={`rounded-md border px-2 py-1 text-xs font-medium ${statusClass(row.status)}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4">
                      <span
                        className={`rounded-md border px-2 py-1 text-xs font-medium ${statusClass(row.bookingStatus)}`}
                      >
                        {row.bookingStatus}
                      </span>
                      {row.smsSent !== null ? (
                        <div className="mt-2 text-xs text-neutral-500">SMS {row.smsSent ? "sent" : "pending"}</div>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-neutral-600">{row.languageLabel}</td>
                    <td className="px-4 py-4 text-neutral-600">{row.summary}</td>
                    <td className="whitespace-nowrap px-4 py-4">
                      <Link
                        href={`/crm/${row.id}`}
                        className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-800 hover:border-neutral-950"
                      >
                        Transcript
                      </Link>
                    </td>
                  </tr>
                ))}
                {result.rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm text-neutral-500">
                      No call records found.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-neutral-200 px-4 py-3 text-sm text-neutral-600">
            <span>
              Page {result.page} · {result.pageSize} per page
            </span>
            <div className="flex gap-2">
              {result.hasPreviousPage ? (
                <Link
                  href={buildPageHref(params, result.page - 1)}
                  className="rounded-md border border-neutral-300 px-3 py-1 font-medium text-neutral-800"
                >
                  Previous
                </Link>
              ) : null}
              {result.hasNextPage ? (
                <Link
                  href={buildPageHref(params, result.page + 1)}
                  className="rounded-md border border-neutral-300 px-3 py-1 font-medium text-neutral-800"
                >
                  Next
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
