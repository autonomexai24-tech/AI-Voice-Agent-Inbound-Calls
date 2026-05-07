import "server-only";
import { queryPostgres } from "./postgres-server";

type CallLogRow = {
  id: string;
  phone_number: string | null;
  start_time: string | null;
  duration: number | null;
  status: string | null;
  outcome: string | null;
};

type TranscriptRow = {
  call_id: string;
  speaker: string | null;
  text: string | null;
  timestamp: string | null;
};

type BookingRow = {
  call_id: string;
  appointment_time: string | null;
  status: string | null;
  sms_sent?: boolean | null;
};

export type CrmCallRow = {
  id: string;
  phoneNumber: string;
  startTime: string | null;
  duration: number | null;
  status: string;
  outcome: string;
  transcriptSummary: string;
  bookingStatus: string;
};

export type CalendarBookingRow = {
  callId: string;
  phoneNumber: string;
  appointmentTime: string | null;
  status: string;
  smsSent: boolean;
};

export type OperationsResult<T> = {
  rows: T[];
  error?: string;
};

function configurationError<T>(): OperationsResult<T> {
  return {
    rows: [],
    error: "DATABASE_URL environment variable is not configured."
  };
}

function buildTranscriptSummary(transcripts: TranscriptRow[]) {
  const summary = transcripts
    .sort((left, right) => (left.timestamp ?? "").localeCompare(right.timestamp ?? ""))
    .map((transcript) => {
      const speaker = transcript.speaker ? `${transcript.speaker}: ` : "";
      return `${speaker}${transcript.text ?? ""}`.trim();
    })
    .filter(Boolean)
    .join(" ");

  if (!summary) {
    return "No transcript recorded";
  }

  return summary.length > 180 ? `${summary.slice(0, 177)}...` : summary;
}

export async function getCrmCalls(): Promise<OperationsResult<CrmCallRow>> {
  try {
    const callsResult = await queryPostgres<CallLogRow>(
      `
      select id, phone_number, start_time, duration, status, outcome
      from call_logs
      order by start_time desc nulls last
      limit 50
      `
    );
    const calls = callsResult.rows;
    const callIds = calls.map((call) => call.id);

    if (callIds.length === 0) {
      return { rows: [] };
    }

    const [transcriptsResult, bookingsResult] = await Promise.all([
      queryPostgres<TranscriptRow>(
        `
        select call_id, speaker, text, timestamp
        from transcripts
        where call_id = any($1::uuid[])
        order by timestamp asc nulls last
        `,
        [callIds]
      ),
      queryPostgres<BookingRow>(
        `
        select call_id, status, appointment_time
        from bookings
        where call_id = any($1::uuid[])
        `,
        [callIds]
      )
    ]);

    const transcriptsByCall = new Map<string, TranscriptRow[]>();
    for (const transcript of transcriptsResult.rows) {
      const existing = transcriptsByCall.get(transcript.call_id) ?? [];
      existing.push(transcript);
      transcriptsByCall.set(transcript.call_id, existing);
    }

    const bookingStatusByCall = new Map<string, string>();
    for (const booking of bookingsResult.rows) {
      bookingStatusByCall.set(booking.call_id, booking.status ?? "pending");
    }

    return {
      rows: calls.map((call) => ({
        id: call.id,
        phoneNumber: call.phone_number ?? "Unknown",
        startTime: call.start_time,
        duration: call.duration,
        status: call.status ?? "unknown",
        outcome: call.outcome ?? "Not set",
        transcriptSummary: buildTranscriptSummary(transcriptsByCall.get(call.id) ?? []),
        bookingStatus: bookingStatusByCall.get(call.id) ?? "none"
      }))
    };
  } catch (error) {
    return {
      rows: [],
      error: error instanceof Error ? error.message : "Unable to load call records."
    };
  }
}

export async function getConfirmedBookings(): Promise<OperationsResult<CalendarBookingRow>> {
  try {
    const bookingsResult = await queryPostgres<BookingRow>(
      `
      select call_id, appointment_time, status, sms_sent
      from bookings
      where status = $1
      order by appointment_time asc nulls last
      limit 50
      `,
      ["confirmed"]
    );
    const bookings = bookingsResult.rows;
    const callIds = bookings.map((booking) => booking.call_id);

    if (callIds.length === 0) {
      return { rows: [] };
    }

    const callsResult = await queryPostgres<Pick<CallLogRow, "id" | "phone_number">>(
      "select id, phone_number from call_logs where id = any($1::uuid[])",
      [callIds]
    );

    const phoneByCall = new Map(callsResult.rows.map((call) => [call.id, call.phone_number ?? "Unknown"]));

    return {
      rows: bookings.map((booking) => ({
        callId: booking.call_id,
        phoneNumber: phoneByCall.get(booking.call_id) ?? "Unknown",
        appointmentTime: booking.appointment_time,
        status: booking.status ?? "confirmed",
        smsSent: Boolean(booking.sms_sent)
      }))
    };
  } catch (error) {
    return {
      rows: [],
      error: error instanceof Error ? error.message : "Unable to load confirmed bookings."
    };
  }
}
