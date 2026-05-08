import "server-only";
import { queryPostgres } from "./postgres-server";

const PAGE_SIZE = 25;
const MAX_PAGE = 500;

type CallLogRow = {
  id: string;
  phone_number: string | null;
  caller_name: string | null;
  start_time: string | null;
  duration: number | null;
  status: string | null;
  outcome: string | null;
  summary: string | null;
  language_code: string | null;
  mixed_language_enabled: boolean | null;
  recording_url: string | null;
  repeat_count?: string | number | null;
};

type TranscriptRow = {
  call_id: string;
  speaker: string | null;
  text: string | null;
  timestamp: string | null;
};

type BookingRow = {
  call_id: string;
  caller_name?: string | null;
  caller_phone?: string | null;
  appointment_time: string | null;
  status: string | null;
  sms_sent?: boolean | null;
};

type CountRow = {
  count: string | number | null;
};

export type CrmFilters = {
  query?: string | null;
  from?: string | null;
  to?: string | null;
  booking?: string | null;
  language?: string | null;
  repeat?: string | null;
  page?: string | number | null;
};

export type CalendarFilters = {
  query?: string | null;
  from?: string | null;
  to?: string | null;
  status?: string | null;
  page?: string | number | null;
};

export type CrmCallRow = {
  id: string;
  callRef: string;
  phoneNumber: string;
  callerName: string;
  startTime: string | null;
  duration: number | null;
  status: string;
  outcome: string;
  summary: string;
  transcriptSummary: string;
  bookingStatus: string;
  appointmentTime: string | null;
  smsSent: boolean | null;
  languageLabel: string;
  repeatCount: number;
  recordingUrl: string | null;
};

export type CalendarBookingRow = {
  callId: string;
  callRef: string;
  phoneNumber: string;
  callerName: string;
  appointmentTime: string | null;
  status: string;
  smsSent: boolean;
};

export type TranscriptDetailTurn = {
  speaker: string;
  text: string;
  timestamp: string | null;
};

export type CrmCallDetail = CrmCallRow & {
  transcript: TranscriptDetailTurn[];
};

export type OperationsResult<T> = {
  rows: T[];
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  error?: string;
};

export type DetailResult<T> = {
  row: T | null;
  error?: string;
};

function emptyResult<T>(error?: string, page = 1): OperationsResult<T> {
  return {
    rows: [],
    page,
    pageSize: PAGE_SIZE,
    totalRows: 0,
    hasNextPage: false,
    hasPreviousPage: false,
    error
  };
}

function normalizePage(value: string | number | null | undefined) {
  const parsed = Number(value ?? 1);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.min(MAX_PAGE, Math.max(1, Math.floor(parsed)));
}

function normalizeDate(value: string | null | undefined, endOfDay = false) {
  if (!value) {
    return null;
  }

  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+05:30`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toNumber(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function encodeCallRef(callId: string) {
  return Buffer.from(callId, "utf8").toString("base64url");
}

export function decodeCallRef(callRef: string) {
  const decoded = Buffer.from(callRef, "base64url").toString("utf8");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(decoded) ? decoded : callRef;
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

function languageLabel(languageCode: string | null, mixedLanguageEnabled: boolean | null) {
  if (mixedLanguageEnabled) {
    return "Mixed";
  }
  if (languageCode === "hi-IN") {
    return "Hindi";
  }
  if (languageCode === "kn-IN") {
    return "Kannada";
  }
  return "English";
}

function normalizeBookingFilter(value: string | null | undefined) {
  return ["confirmed", "none", "pending"].includes(value ?? "") ? value : null;
}

function normalizeLanguageFilter(value: string | null | undefined) {
  return ["en-IN", "hi-IN", "kn-IN", "mixed"].includes(value ?? "") ? value : null;
}

function normalizeCalendarStatusFilter(value: string | null | undefined) {
  return ["confirmed", "pending", "cancelled", "failed"].includes(value ?? "") ? value : null;
}

function buildCallRow(
  call: CallLogRow,
  transcriptsByCall: Map<string, TranscriptRow[]>,
  bookingByCall: Map<string, BookingRow>
): CrmCallRow {
  const booking = bookingByCall.get(call.id);

  return {
    id: call.id,
    callRef: encodeCallRef(call.id),
    phoneNumber: booking?.caller_phone ?? call.phone_number ?? "Unknown",
    callerName: booking?.caller_name ?? call.caller_name ?? "Unknown",
    startTime: call.start_time,
    duration: call.duration,
    status: call.status ?? "unknown",
    outcome: call.outcome ?? "Not set",
    summary: call.summary || buildTranscriptSummary(transcriptsByCall.get(call.id) ?? []),
    transcriptSummary: buildTranscriptSummary(transcriptsByCall.get(call.id) ?? []),
    bookingStatus: booking?.status ?? "none",
    appointmentTime: booking?.appointment_time ?? null,
    smsSent: typeof booking?.sms_sent === "boolean" ? booking.sms_sent : null,
    languageLabel: languageLabel(call.language_code, call.mixed_language_enabled),
    repeatCount: Math.max(1, toNumber(call.repeat_count)),
    recordingUrl: call.recording_url
  };
}

function addDateFilters(
  conditions: string[],
  values: unknown[],
  columnName: string,
  from?: string | null,
  to?: string | null
) {
  const fromDate = normalizeDate(from);
  const toDate = normalizeDate(to, true);

  if (fromDate) {
    values.push(fromDate);
    conditions.push(`${columnName} >= $${values.length}`);
  }
  if (toDate) {
    values.push(toDate);
    conditions.push(`${columnName} <= $${values.length}`);
  }
}

export async function getCrmCalls(filters: CrmFilters = {}): Promise<OperationsResult<CrmCallRow>> {
  const page = normalizePage(filters.page);
  const offset = (page - 1) * PAGE_SIZE;
  const conditions: string[] = [];
  const values: unknown[] = [];
  const search = String(filters.query ?? "").trim();

  addDateFilters(conditions, values, "start_time", filters.from, filters.to);

  if (search) {
    values.push(`%${search}%`);
    conditions.push(`
      (
        phone_number ilike $${values.length}
        or caller_name ilike $${values.length}
        or exists (
          select 1
          from bookings b
          where b.call_id = call_logs.id
            and (b.caller_phone ilike $${values.length} or b.caller_name ilike $${values.length})
        )
      )
    `);
  }

  const bookingFilter = normalizeBookingFilter(filters.booking);
  if (bookingFilter === "confirmed") {
    conditions.push("exists (select 1 from bookings b where b.call_id = call_logs.id and b.status = 'confirmed')");
  } else if (bookingFilter === "pending") {
    conditions.push("exists (select 1 from bookings b where b.call_id = call_logs.id and b.status <> 'confirmed')");
  } else if (bookingFilter === "none") {
    conditions.push("not exists (select 1 from bookings b where b.call_id = call_logs.id)");
  }

  const languageFilter = normalizeLanguageFilter(filters.language);
  if (languageFilter === "mixed") {
    conditions.push("mixed_language_enabled = true");
  } else if (languageFilter) {
    values.push(languageFilter);
    conditions.push("mixed_language_enabled = false");
    conditions.push(`language_code = $${values.length}`);
  }

  if (filters.repeat === "true") {
    conditions.push(`
      exists (
        select 1
        from call_logs history
        where history.phone_number = call_logs.phone_number
          and history.phone_number is not null
          and history.phone_number <> 'unknown'
          and history.id <> call_logs.id
      )
    `);
  }

  const whereClause = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";

  try {
    const countResult = await queryPostgres<CountRow>(
      `
      select count(*) as count
      from call_logs
      ${whereClause}
      `,
      values
    );

    const totalRows = toNumber(countResult.rows[0]?.count);
    values.push(PAGE_SIZE, offset);

    const callsResult = await queryPostgres<CallLogRow>(
      `
      select
        id,
        phone_number,
        caller_name,
        start_time,
        duration,
        status,
        outcome,
        summary,
        language_code,
        mixed_language_enabled,
        recording_url,
        (
          select count(*)
          from call_logs history
          where history.phone_number = call_logs.phone_number
            and history.phone_number is not null
            and history.phone_number <> 'unknown'
        ) as repeat_count
      from call_logs
      ${whereClause}
      order by start_time desc nulls last
      limit $${values.length - 1}
      offset $${values.length}
      `,
      values
    );
    const calls = callsResult.rows;
    const callIds = calls.map((call) => call.id);

    if (callIds.length === 0) {
      return {
        ...emptyResult<CrmCallRow>(undefined, page),
        totalRows,
        hasPreviousPage: page > 1
      };
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
        select call_id, caller_name, caller_phone, status, appointment_time, sms_sent
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

    const bookingByCall = new Map<string, BookingRow>();
    for (const booking of bookingsResult.rows) {
      bookingByCall.set(booking.call_id, booking);
    }

    return {
      rows: calls.map((call) => buildCallRow(call, transcriptsByCall, bookingByCall)),
      page,
      pageSize: PAGE_SIZE,
      totalRows,
      hasNextPage: page * PAGE_SIZE < totalRows,
      hasPreviousPage: page > 1
    };
  } catch (error) {
    return emptyResult(error instanceof Error ? error.message : "Unable to load call records.", page);
  }
}

export async function getCrmCallDetail(callId: string): Promise<DetailResult<CrmCallDetail>> {
  try {
    const callResult = await queryPostgres<CallLogRow>(
      `
      select
        id,
        phone_number,
        caller_name,
        start_time,
        duration,
        status,
        outcome,
        summary,
        language_code,
        mixed_language_enabled,
        recording_url,
        (
          select count(*)
          from call_logs history
          where history.phone_number = call_logs.phone_number
            and history.phone_number is not null
            and history.phone_number <> 'unknown'
        ) as repeat_count
      from call_logs
      where id = $1
      limit 1
      `,
      [callId]
    );

    const call = callResult.rows[0];
    if (!call) {
      return { row: null };
    }

    const [transcriptsResult, bookingsResult] = await Promise.all([
      queryPostgres<TranscriptRow>(
        `
        select call_id, speaker, text, timestamp
        from transcripts
        where call_id = $1
        order by timestamp asc nulls last
        `,
        [callId]
      ),
      queryPostgres<BookingRow>(
        `
        select call_id, caller_name, caller_phone, appointment_time, status, sms_sent
        from bookings
        where call_id = $1
        limit 1
        `,
        [callId]
      )
    ]);

    const transcriptsByCall = new Map([[callId, transcriptsResult.rows]]);
    const bookingByCall = new Map<string, BookingRow>();
    if (bookingsResult.rows[0]) {
      bookingByCall.set(callId, bookingsResult.rows[0]);
    }

    return {
      row: {
        ...buildCallRow(call, transcriptsByCall, bookingByCall),
        transcript: transcriptsResult.rows.map((turn) => ({
          speaker: turn.speaker ?? "unknown",
          text: turn.text ?? "",
          timestamp: turn.timestamp
        }))
      }
    };
  } catch (error) {
    return {
      row: null,
      error: error instanceof Error ? error.message : "Unable to load call details."
    };
  }
}

export async function getCalendarBookings(
  filters: CalendarFilters = {}
): Promise<OperationsResult<CalendarBookingRow>> {
  const page = normalizePage(filters.page);
  const offset = (page - 1) * PAGE_SIZE;
  const conditions: string[] = [];
  const values: unknown[] = [];
  const search = String(filters.query ?? "").trim();

  addDateFilters(conditions, values, "b.appointment_time", filters.from, filters.to);

  if (search) {
    values.push(`%${search}%`);
    conditions.push(`
      (
        coalesce(b.caller_phone, c.phone_number) ilike $${values.length}
        or coalesce(b.caller_name, c.caller_name) ilike $${values.length}
      )
    `);
  }

  const statusFilter = normalizeCalendarStatusFilter(filters.status);
  if (statusFilter) {
    values.push(statusFilter);
    conditions.push(`b.status = $${values.length}`);
  }

  const whereClause = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";

  try {
    const countResult = await queryPostgres<CountRow>(
      `
      select count(*) as count
      from bookings b
      left join call_logs c on c.id = b.call_id
      ${whereClause}
      `,
      values
    );
    const totalRows = toNumber(countResult.rows[0]?.count);

    values.push(PAGE_SIZE, offset);
    const bookingsResult = await queryPostgres<
      BookingRow & Pick<CallLogRow, "phone_number" | "caller_name">
    >(
      `
      select
        b.call_id,
        b.appointment_time,
        b.status,
        b.sms_sent,
        coalesce(b.caller_phone, c.phone_number) as phone_number,
        coalesce(b.caller_name, c.caller_name) as caller_name
      from bookings b
      left join call_logs c on c.id = b.call_id
      ${whereClause}
      order by b.appointment_time asc nulls last
      limit $${values.length - 1}
      offset $${values.length}
      `,
      values
    );

    return {
      rows: bookingsResult.rows.map((booking) => ({
        callId: booking.call_id,
        callRef: encodeCallRef(booking.call_id),
        phoneNumber: booking.phone_number ?? "Unknown",
        callerName: booking.caller_name ?? "Unknown",
        appointmentTime: booking.appointment_time,
        status: booking.status ?? "confirmed",
        smsSent: Boolean(booking.sms_sent)
      })),
      page,
      pageSize: PAGE_SIZE,
      totalRows,
      hasNextPage: page * PAGE_SIZE < totalRows,
      hasPreviousPage: page > 1
    };
  } catch (error) {
    return emptyResult(error instanceof Error ? error.message : "Unable to load bookings.", page);
  }
}
