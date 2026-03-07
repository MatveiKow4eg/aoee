"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { login, steamLoginUrl } from "../../lib/api/auth";

function LoginInner() {
  const router = useRouter();
  const sp = useSearchParams();

  const nextUrl = useMemo(() => {
    const n = sp.get("next");
    return n && n.startsWith("/") ? n : "/";
  }, [sp]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "#0b1220", color: "#f7f0df" }}>
      <div style={{ width: "min(520px, 100%)", border: "1px solid #3a2a1a", borderRadius: 12, padding: 16, background: "rgba(0,0,0,0.25)" }}>
        <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 10 }}>Login</div>

        {error && (
          <div style={{ marginBottom: 10, padding: 10, borderRadius: 10, background: "rgba(122,42,42,0.25)", border: "1px solid #7a2a2a" }}>
            {error}
          </div>
        )}

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            setIsSubmitting(true);
            try {
              await login(email.trim().toLowerCase(), password);
              router.push(nextUrl);
            } catch (err: any) {
              setError(err?.message ? String(err.message) : "Login failed");
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
              autoComplete="current-password"
              required
              style={{ padding: 10, borderRadius: 10, border: "1px solid #1f2a40", background: "#1a2438", color: "#f7f0df" }}
            />
          </label>

          <button
            disabled={isSubmitting}
            type="submit"
            style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #caa24d", background: "#2b1a12", color: "#f7f0df", fontWeight: 900, cursor: "pointer" }}
          >
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          <a
            href={steamLoginUrl()}
            style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(247,240,223,0.25)", background: "rgba(202,162,77,0.18)", color: "#f7f0df", fontWeight: 900, textDecoration: "none" }}
          >
            Login with Steam
          </a>
          <Link href={`/register?next=${encodeURIComponent(nextUrl)}`} style={{ color: "#caa24d", fontWeight: 900, textDecoration: "none", padding: "10px 0" }}>
            Create account
          </Link>
          <Link href={nextUrl} style={{ color: "#caa24d", fontWeight: 900, textDecoration: "none", padding: "10px 0" }}>
            Back
          </Link>
        </div>

        <div style={{ marginTop: 10, opacity: 0.75, fontSize: 12, lineHeight: 1.35 }}>
          Session is cookie-based (no tokens in localStorage). For Steam login this page redirects to backend.
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
