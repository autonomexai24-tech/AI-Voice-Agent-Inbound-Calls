import Link from "next/link";
import { getConfirmedBookings } from "../../lib/operations-data";

export const dynamic = "force-dynamic";

type CalendarPageProps = {
  searchParams?: Promise<{
    from?: string;
    to?: string;
    page?: string;
  }>;
};

function formatAppointment(value: string | null) {
  if (!value) {
    return { date: "Not set", time: "Not set" };
  }

  const date = new Date(value);

  return {
    date: new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(date),
    time: new Intl.DateTimeFormat("en-IN", { timeStyle: "short" }).format(date)
  };
}

function buildPageHref(params: Awaited<CalendarPageProps["searchParams"]>, page: number) {
  const nextParams = new URLSearchParams();
  for (const key of ["from", "to"] as const) {
    const value = params?.[key];
    if (value) {
      nextParams.set(key, value);
    }
  }
  nextParams.set("page", String(page));
  return `/calendar?${nextParams.toString()}`;
}

export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  const params = await searchParams;
  const result = await getConfirmedBookings(params);
  const firstRow = result.totalRows === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const lastRow = Math.min(result.totalRows, result.page * result.pageSize);

  return (
    <section className="min-h-screen px-5 py-6 sm:px-8 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 border-b border-neutral-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-neutral-500">Confirmed bookings</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-neutral-950">Appointment Calendar</h1>
          </div>
          <div className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-600">
            {firstRow}-{lastRow} of {result.totalRows.toLocaleString("en-US")} bookings
          </div>
        </div>

        <form className="mt-6 grid gap-3 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm sm:grid-cols-[1fr_1fr_auto]">
          <label className="grid gap-1">
            <span className="text-xs font-medium uppercase text-neutral-500">Appointment from</span>
            <input
              name="from"
              type="date"
              defaultValue={params?.from ?? ""}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-950 outline-none focus:border-neutral-950"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium uppercase text-neutral-500">Appointment to</span>
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
                    Date
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Time
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Caller
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3">
                    SMS
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Review
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {result.rows.map((row) => {
                  const appointment = formatAppointment(row.appointmentTime);

                  return (
                    <tr key={`${row.callId}-${row.appointmentTime}`} className="align-top">
                      <td className="whitespace-nowrap px-4 py-4 font-medium text-neutral-950">{appointment.date}</td>
                      <td className="whitespace-nowrap px-4 py-4 text-neutral-600">{appointment.time}</td>
                      <td className="whitespace-nowrap px-4 py-4 text-neutral-600">
                        <div className="font-medium text-neutral-950">{row.callerName}</div>
                        <div className="mt-1 text-neutral-500">{row.phoneNumber}</div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4">
                        <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800">
                          {row.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-neutral-600">
                        {row.smsSent ? "Sent" : "Pending"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4">
                        <Link
                          href={`/crm/${row.callId}`}
                          className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-800 hover:border-neutral-950"
                        >
                          Transcript
                        </Link>
                      </td>
                    </tr>
                  );
                })}
                {result.rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-neutral-500">
                      No confirmed appointments found.
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
