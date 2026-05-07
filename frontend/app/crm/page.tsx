import { getCrmCalls } from "../../lib/operations-data";

export const dynamic = "force-dynamic";

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

  if (normalized === "confirmed" || normalized === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (normalized === "failed" || normalized === "missed" || normalized === "error") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }

  return "border-neutral-200 bg-neutral-50 text-neutral-700";
}

export default async function CrmPage() {
  const result = await getCrmCalls();

  return (
    <section className="min-h-screen px-5 py-6 sm:px-8 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 border-b border-neutral-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-neutral-500">Customer records</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-neutral-950">CRM Calls</h1>
          </div>
          <div className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-600">
            Last 50 call records
          </div>
        </div>

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
                    Duration
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Call Status
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Booking
                  </th>
                  <th scope="col" className="min-w-[320px] px-4 py-3">
                    Transcript Summary
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Outcome
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {result.rows.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-4 font-medium text-neutral-950">{row.phoneNumber}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-neutral-600">{formatDateTime(row.startTime)}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-neutral-600">{formatDuration(row.duration)}</td>
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
                    </td>
                    <td className="px-4 py-4 text-neutral-600">{row.transcriptSummary}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-neutral-600">{row.outcome}</td>
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
        </div>
      </div>
    </section>
  );
}
