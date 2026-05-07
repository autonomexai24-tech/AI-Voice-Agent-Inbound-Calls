import "server-only";
import { createQueryAbortSignal, getSupabaseClient } from "./supabase-server";

type CallLogRow = {
  duration: number | null;
  status: string | null;
};

type BookingRow = {
  call_id: string | null;
};

export type DashboardMetrics = {
  totalCalls: number;
  bookingRate: number;
  avgDurationSeconds: number;
  failedCalls: number;
  confirmedBookings: number;
  configured: boolean;
  error?: string;
};

const emptyMetrics: DashboardMetrics = {
  totalCalls: 0,
  bookingRate: 0,
  avgDurationSeconds: 0,
  failedCalls: 0,
  confirmedBookings: 0,
  configured: false
};

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return {
      ...emptyMetrics,
      error: "Supabase service role environment variables are not configured."
    };
  }

  const timeout = createQueryAbortSignal();

  try {
    const [callsResult, bookingsResult] = await Promise.all([
      supabase.from("call_logs").select("duration,status").abortSignal(timeout.signal),
      supabase.from("bookings").select("call_id").eq("status", "confirmed").abortSignal(timeout.signal)
    ]);

    if (callsResult.error) {
      throw callsResult.error;
    }

    if (bookingsResult.error) {
      throw bookingsResult.error;
    }

    const calls = (callsResult.data ?? []) as CallLogRow[];
    const bookings = (bookingsResult.data ?? []) as BookingRow[];
    const totalCalls = calls.length;
    const confirmedBookings = bookings.length;
    const failedStatuses = new Set(["failed", "missed", "error"]);
    const failedCalls = calls.filter((call) => failedStatuses.has((call.status ?? "").toLowerCase())).length;
    const durations = calls
      .map((call) => Number(call.duration))
      .filter((duration) => Number.isFinite(duration) && duration > 0);
    const avgDurationSeconds =
      durations.length > 0 ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length) : 0;
    const bookingRate = totalCalls > 0 ? Math.round((confirmedBookings / totalCalls) * 1000) / 10 : 0;

    return {
      totalCalls,
      bookingRate,
      avgDurationSeconds,
      failedCalls,
      confirmedBookings,
      configured: true
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load dashboard metrics.";

    return {
      ...emptyMetrics,
      configured: true,
      error: message
    };
  } finally {
    timeout.cancel();
  }
}
