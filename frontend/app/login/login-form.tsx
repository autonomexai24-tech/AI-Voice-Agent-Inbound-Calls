"use client";

import { useActionState } from "react";
import { loginAction, type LoginActionState } from "./actions";

const initialState: LoginActionState = {
  status: "idle",
  message: ""
};

export function LoginForm({ nextPath }: { nextPath: string }) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="mt-6 grid gap-4">
      <input type="hidden" name="next" value={nextPath} />

      {state.status === "error" ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
          {state.message}
        </div>
      ) : null}

      <label className="grid gap-2">
        <span className="text-sm font-medium text-neutral-700">Dashboard Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
          className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-950 outline-none transition-colors focus:border-neutral-950"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-400"
      >
        {pending ? "Checking..." : "Sign in"}
      </button>
    </form>
  );
}
