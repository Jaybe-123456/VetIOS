import React, { useState } from "react";

type Props = {
  // Optionally pass the edge function URL as a prop. If not provided, the component
  // will fallback to an environment variable: REACT_APP_EDGE_URL (create-react-app) or NEXT_PUBLIC_EDGE_URL for Next.
  edgeUrl?: string;
};

type FormState = {
  email: string;
  password: string;
  confirmPassword: string;
};

export default function SignupForm({ edgeUrl }: Props) {
  const fallbackUrl =
    // prefer Next-style env var, then CRA-style
    (process.env.NEXT_PUBLIC_EDGE_URL as string | undefined) ||
    (process.env.REACT_APP_EDGE_URL as string | undefined) ||
    "<EDGE_FUNCTION_URL>";
  const endpoint = edgeUrl ?? fallbackUrl;

  const [form, setForm] = useState<FormState>({
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const validate = () => {
    if (!form.email) return "Email is required";
    // simple email regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(form.email)) return "Invalid email";
    if (form.password.length < 8)
      return "Password must be at least 8 characters";
    if (form.password !== form.confirmPassword)
      return "Passwords do not match";
    return null;
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const v = validate();
    if (v) {
      setError(v);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const message =
          (data && (data.error || data.message)) ||
          `Request failed with status ${res.status}`;
        setError(message);
        setLoading(false);
        return;
      }

      // success
      setSuccessMessage(
        "Account created. Check your inbox for confirmation (if enabled)."
      );
      setForm({ email: "", password: "", confirmPassword: "" });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={onSubmit} aria-live="polite" style={{ maxWidth: 420 }}>
      <h2>Create account</h2>

      {error && (
        <div
          role="alert"
          style={{
            background: "#ffe6e6",
            color: "#800",
            padding: "8px 12px",
            borderRadius: 6,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      {successMessage && (
        <div
          role="status"
          style={{
            background: "#e6ffef",
            color: "#064",
            padding: "8px 12px",
            borderRadius: 6,
            marginBottom: 12,
          }}
        >
          {successMessage}
        </div>
      )}

      <label style={{ display: "block", marginBottom: 8 }}>
        <div style={{ fontSize: 14, marginBottom: 6 }}>Email</div>
        <input
          name="email"
          type="email"
          value={form.email}
          onChange={onChange}
          required
          style={{
            width: "100%",
            padding: "10px",
            borderRadius: 6,
            border: "1px solid #ddd",
          }}
        />
      </label>

      <label style={{ display: "block", marginBottom: 8 }}>
        <div style={{ fontSize: 14, marginBottom: 6 }}>Password</div>
        <input
          name="password"
          type="password"
          value={form.password}
          onChange={onChange}
          required
          minLength={8}
          style={{
            width: "100%",
            padding: "10px",
            borderRadius: 6,
            border: "1px solid #ddd",
          }}
        />
      </label>

      <label style={{ display: "block", marginBottom: 12 }}>
        <div style={{ fontSize: 14, marginBottom: 6 }}>Confirm password</div>
        <input
          name="confirmPassword"
          type="password"
          value={form.confirmPassword}
          onChange={onChange}
          required
          minLength={8}
          style={{
            width: "100%",
            padding: "10px",
            borderRadius: 6,
            border: "1px solid #ddd",
          }}
        />
      </label>

      <button
        type="submit"
        disabled={loading}
        style={{
          display: "inline-block",
          padding: "10px 16px",
          borderRadius: 6,
          background: "#2563eb",
          color: "white",
          border: "none",
          cursor: "pointer",
        }}
      >
        {loading ? "Creating…" : "Create account"}
      </button>

      <div style={{ marginTop: 12, fontSize: 13, color: "#666" }}>
        By creating an account you agree to the terms.
      </div>
    </form>
  );
}
