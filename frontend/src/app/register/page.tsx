"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { register, steamLoginUrl } from "../../lib/api/auth";

function RegisterInner() {
  const router = useRouter();
  void router;
  const sp = useSearchParams();

  const nextUrl = useMemo(() => {
    const n = sp.get("next");
    return n && n.startsWith("/") ? n : "/";
  }, [sp]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  return (
    <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "#0b1220", color: "#f7f0df" }}>
      <div style={{ width: "min(520px, 100%)", border: "1px solid #3a2a1a", borderRadius: 12, padding: 16, background: "rgba(0,0,0,0.25)" }}>
        <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 10 }}>Register</div>

        {error && (
          <div style={{ marginBottom: 10, padding: 10, borderRadius: 10, background: "rgba(122,42,42,0.25)", border: "1px solid #7a2a2a" }}>
            {error}
          </div>
        )}

        {done ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ padding: 10, borderRadius: 10, background: "rgba(0,0,0,0.15)", border: "1px solid #1f2a40" }}>
              Account created. You can now login.
            </div>
            <Link href={`/login?next=${encodeURIComponent(nextUrl)}`} style={{ color: "#caa24d", fontWeight: 900, textDecoration: "none" }}>
              Go to login
            </Link>
          </div>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);

              const e1 = email.trim().toLowerCase();
              if (!e1) {
                setError("Email is required");
                return;
              }
              if (password.length < 8) {
                setError("Password must be at least 8 characters");
                return;
              }
              if (password !== password2) {
                setError("Passwords do not match");
                return;
              }

              setIsSubmitting(true);
              try {
                await register(e1, password);
                setDone(true);
              } catch (err: any) {
                setError(err?.message ? String(err.message) : "Register failed");
              } finally {
                setIsSubmitting(false);
              }
            }}
            style={{ display: "flex", flexDirection: "column", gap: 10 }}
          >
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontWeight: 800, fontSize: 12, opacity: 0.9 }}>Email</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                autoComplete="email"
                required
                style={{ padding: 10, borderRadius: 10, border: "1px solid #1f2a40", background: "#1a2438", color: "#f7f0df" }}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontWeight: 800, fontSize: 12, opacity: 0.9 }}>Password</span>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                autoComplete="new-password"
                required
                style={{ padding: 10, borderRadius: 10, border: "1px solid #1f2a40", background: "#1a2438", color: "#f7f0df" }}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontWeight: 800, fontSize: 12, opacity: 0.9 }}>Confirm password</span>
              <input
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                type="password"
                autoComplete="new-password"
                required
                style={{ padding: 10, borderRadius: 10, border: "1px solid #1f2a40", background: "#1a2438", color: "#f7f0df" }}
              />
            </label>

            <button
              disabled={isSubmitting}
              type="submit"
              style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #caa24d", background: "#2b1a12", color: "#f7f0df", fontWeight: 900, cursor: "pointer" }}
            >
              {isSubmitting ? "Creating..." : "Create account"}
            </button>
          </form>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          <a
            href={steamLoginUrl()}
            style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(247,240,223,0.25)", background: "rgba(202,162,77,0.18)", color: "#f7f0df", fontWeight: 900, textDecoration: "none" }}
          >
            Register / Login with Steam
          </a>
          <Link href={`/login?next=${encodeURIComponent(nextUrl)}`} style={{ color: "#caa24d", fontWeight: 900, textDecoration: "none", padding: "10px 0" }}>
            I already have an account
          </Link>
          <Link href={nextUrl} style={{ color: "#caa24d", fontWeight: 900, textDecoration: "none", padding: "10px 0" }}>
            Back
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterInner />
    </Suspense>
  );
}
