import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrmCallDetail } from "../../../lib/operations-data";

export const dynamic = "force-dynamic";

type CrmDetailPageProps = {
  params: Promise<{
    callId: string;
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

function formatSpeaker(value: string) {
  if (value === "assistant") {
    return "Agent";
  }
  if (value === "user") {
    return "Caller";
  }
  return value;
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

export default async function CrmDetailPage({ params }: CrmDetailPageProps) {
  const { callId } = await params;
  const result = await getCrmCallDetail(callId);

  if (!result.row && !result.error) {
    notFound();
  }

  const call = result.row;

  return (
    <section className="min-h-screen px-5 py-6 sm:px-8 lg:px-10">
      <div className="mx-auto max-w-5xl">
        <div className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
          <div>
            <Link href="/crm" className="text-sm font-medium text-neutral-500 hover:text-neutral-950">
              Back to CRM
            </Link>
            <h1 className="mt-3 text-4xl font-semibold tracking-normal text-neutral-950">Call Transcript</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-600">
              Full turn-by-turn transcript, booking state, caller history, language mode, and recording link for operator
              review.
            </p>
          </div>
          {call ? (
            <div className="mt-5 inline-flex rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
              {formatDateTime(call.startTime)}
            </div>
          ) : null}
        </div>

        {result.error ? (
          <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {result.error}
          </div>
        ) : null}

        {call ? (
          <>
            <div className="mt-6 grid gap-4 md:grid-cols-4">
              <article className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase text-neutral-500">Caller</p>
                <p className="mt-2 font-medium text-neutral-950">{call.callerName}</p>
                <p className="mt-1 text-sm text-neutral-500">{call.phoneNumber}</p>
              </article>
              <article className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase text-neutral-500">Call</p>
                <p className="mt-2 text-sm text-neutral-700">{formatDuration(call.duration)}</p>
                <p className="mt-2">
                  <span className={`rounded-md border px-2 py-1 text-xs font-medium ${statusClass(call.status)}`}>
                    {call.status}
                  </span>
                </p>
              </article>
              <article className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase text-neutral-500">Booking</p>
                <p className="mt-2">
                  <span
                    className={`rounded-md border px-2 py-1 text-xs font-medium ${statusClass(call.bookingStatus)}`}
                  >
                    {call.bookingStatus}
                  </span>
                </p>
                <p className="mt-2 text-sm text-neutral-500">
                  {call.smsSent === null ? "No SMS" : `SMS ${call.smsSent ? "sent" : "pending"}`}
                </p>
              </article>
              <article className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase text-neutral-500">Language</p>
                <p className="mt-2 font-medium text-neutral-950">{call.languageLabel}</p>
                <p className="mt-1 text-sm text-neutral-500">{call.repeatCount} total caller calls</p>
              </article>
            </div>

            <section className="mt-6 rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-medium text-neutral-500">Operator summary</p>
              <p className="mt-2 text-sm leading-6 text-neutral-700">{call.summary}</p>
              {call.recordingUrl ? (
                <a
                  href={call.recordingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-800 hover:border-neutral-950"
                >
                  Open recording
                </a>
              ) : null}
            </section>

            <section className="mt-6 rounded-2xl border border-neutral-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
                <div>
                  <p className="text-sm font-semibold text-neutral-500">Transcript viewer</p>
                  <h2 className="mt-1 text-lg font-semibold text-neutral-950">Conversation timeline</h2>
                </div>
                <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-600">
                  {call.transcript.length} turns
                </span>
              </div>
              <div className="grid gap-4 p-5">
                {call.transcript.map((turn, index) => (
                  <div
                    key={`${turn.timestamp}-${index}`}
                    className={[
                      "grid gap-2",
                      turn.speaker === "assistant" ? "justify-items-end" : "justify-items-start"
                    ].join(" ")}
                  >
                    <div className="max-w-3xl">
                      <p className="text-sm font-semibold text-neutral-950">{formatSpeaker(turn.speaker)}</p>
                      <p className="mt-1 text-xs text-neutral-500">{formatDateTime(turn.timestamp)}</p>
                      <p
                        className={[
                          "mt-2 rounded-2xl px-4 py-3 text-sm leading-6",
                          turn.speaker === "assistant"
                            ? "bg-neutral-950 text-white"
                            : "border border-neutral-200 bg-neutral-50 text-neutral-800"
                        ].join(" ")}
                      >
                        {turn.text}
                      </p>
                    </div>
                  </div>
                ))}
                {call.transcript.length === 0 ? (
                  <p className="px-5 py-10 text-center text-sm text-neutral-500">No transcript recorded.</p>
                ) : null}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </section>
  );
}
