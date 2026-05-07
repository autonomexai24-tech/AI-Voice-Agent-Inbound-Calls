import "server-only";
import { queryPostgres } from "./postgres-server";

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
  try {
    const [callsResult, bookingsResult] = await Promise.all([
      queryPostgres<CallLogRow>("select duration, status from call_logs"),
      queryPostgres<BookingRow>("select call_id from bookings where status = $1", ["confirmed"])
    ]);

    const calls = callsResult.rows;
    const bookings = bookingsResult.rows;
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
  }
}
