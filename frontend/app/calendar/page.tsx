import { getConfirmedBookings } from "../../lib/operations-data";

export const dynamic = "force-dynamic";

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

export default async function CalendarPage() {
  const result = await getConfirmedBookings();

  return (
    <section className="min-h-screen px-5 py-6 sm:px-8 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 border-b border-neutral-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-neutral-500">Confirmed bookings</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-neutral-950">Appointment Calendar</h1>
          </div>
          <div className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-600">
            Next 50 confirmed entries
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
                    Date
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Time
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Phone Number
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3">
                    SMS
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
                      <td className="whitespace-nowrap px-4 py-4 text-neutral-600">{row.phoneNumber}</td>
                      <td className="whitespace-nowrap px-4 py-4">
                        <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800">
                          {row.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-neutral-600">
                        {row.smsSent ? "Sent" : "Pending"}
                      </td>
                    </tr>
                  );
                })}
                {result.rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-neutral-500">
                      No confirmed appointments found.
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
