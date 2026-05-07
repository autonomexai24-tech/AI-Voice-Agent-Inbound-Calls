import "server-only";
import { createQueryAbortSignal, getSupabaseClient } from "./supabase-server";

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
    error: "Supabase service role environment variables are not configured."
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
  const supabase = getSupabaseClient();

  if (!supabase) {
    return configurationError<CrmCallRow>();
  }

  const timeout = createQueryAbortSignal();

  try {
    const callsResult = await supabase
      .from("call_logs")
      .select("id,phone_number,start_time,duration,status,outcome")
      .order("start_time", { ascending: false, nullsFirst: false })
      .limit(50)
      .abortSignal(timeout.signal);

    if (callsResult.error) {
      throw callsResult.error;
    }

    const calls = (callsResult.data ?? []) as CallLogRow[];
    const callIds = calls.map((call) => call.id);

    if (callIds.length === 0) {
      return { rows: [] };
    }

    const [transcriptsResult, bookingsResult] = await Promise.all([
      supabase
        .from("transcripts")
        .select("call_id,speaker,text,timestamp")
        .in("call_id", callIds)
        .order("timestamp", { ascending: true, nullsFirst: false })
        .abortSignal(timeout.signal),
      supabase.from("bookings").select("call_id,status,appointment_time").in("call_id", callIds).abortSignal(timeout.signal)
    ]);

    if (transcriptsResult.error) {
      throw transcriptsResult.error;
    }

    if (bookingsResult.error) {
      throw bookingsResult.error;
    }

    const transcriptsByCall = new Map<string, TranscriptRow[]>();
    for (const transcript of (transcriptsResult.data ?? []) as TranscriptRow[]) {
      const existing = transcriptsByCall.get(transcript.call_id) ?? [];
      existing.push(transcript);
      transcriptsByCall.set(transcript.call_id, existing);
    }

    const bookingStatusByCall = new Map<string, string>();
    for (const booking of (bookingsResult.data ?? []) as BookingRow[]) {
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
  } finally {
    timeout.cancel();
  }
}

export async function getConfirmedBookings(): Promise<OperationsResult<CalendarBookingRow>> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return configurationError<CalendarBookingRow>();
  }

  const timeout = createQueryAbortSignal();

  try {
    const bookingsResult = await supabase
      .from("bookings")
      .select("call_id,appointment_time,status,sms_sent")
      .eq("status", "confirmed")
      .order("appointment_time", { ascending: true, nullsFirst: false })
      .limit(50)
      .abortSignal(timeout.signal);

    if (bookingsResult.error) {
      throw bookingsResult.error;
    }

    const bookings = (bookingsResult.data ?? []) as BookingRow[];
    const callIds = bookings.map((booking) => booking.call_id);

    if (callIds.length === 0) {
      return { rows: [] };
    }

    const callsResult = await supabase
      .from("call_logs")
      .select("id,phone_number")
      .in("id", callIds)
      .abortSignal(timeout.signal);

    if (callsResult.error) {
      throw callsResult.error;
    }

    const phoneByCall = new Map(
      ((callsResult.data ?? []) as Pick<CallLogRow, "id" | "phone_number">[]).map((call) => [
        call.id,
        call.phone_number ?? "Unknown"
      ])
    );

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
  } finally {
    timeout.cancel();
  }
}
