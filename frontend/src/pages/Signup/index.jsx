import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import paths from "@/utils/paths";
import Signup from "@/models/signup";
import { AUTH_TOKEN, AUTH_USER } from "@/utils/constants";
import { APP_NAME } from "@/utils/brand";
import Button from "@/components/ui/21st/Button";
import Field from "@/components/ui/21st/Field";
import Card from "@/components/ui/21st/Card";
import useLogo from "@/hooks/useLogo";
import System from "@/models/system";

export default function SignupPage() {
  const { loginLogo, isCustomLogo } = useLogo();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState(null);
  const [customAppName, setCustomAppName] = useState("");

  useEffect(() => {
    Promise.all([Signup.enabled(), System.fetchCustomAppName()])
      .then(([isEnabled, { appName }]) => {
        setEnabled(isEnabled);
        setCustomAppName(appName || "");
      })
      .finally(() => setChecking(false));
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(event.target);
    const payload = Object.fromEntries(form.entries());
    const { valid, user, token, message } = await Signup.create(payload);
    if (valid && token && user) {
      window.localStorage.setItem(AUTH_USER, JSON.stringify(user));
      window.localStorage.setItem(AUTH_TOKEN, token);
      window.location = paths.userOnboarding();
      return;
    }
    setError(message || "Could not create your workspace.");
    setLoading(false);
  };

  if (checking) {
    return (
      <div className="fixed inset-0 bg-zinc-950 light:bg-slate-50 flex items-center justify-center" />
    );
  }

  return (
    <div className="fixed inset-0 bg-zinc-950 light:bg-slate-50 flex flex-col items-center justify-center overflow-y-auto px-4 py-10">
      <img
        src={loginLogo}
        alt="Logo"
        className={`max-h-[80px] mb-6 ${isCustomLogo ? "rounded-lg" : ""}`}
        style={{ objectFit: "contain" }}
      />
      <Card
        title={`Create your ${customAppName || APP_NAME} workspace`}
        description="Sign up with your work email. You will be the admin of a new isolated organization."
        className="w-full max-w-[420px] bg-zinc-900/60 light:bg-white border-zinc-800 light:border-slate-200"
      >
        {!enabled ? (
          <p className="text-sm text-theme-text-secondary">
            Public signup is currently disabled. Ask an admin for an invite.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <Field
              label="Work email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@company.com"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="First name"
                name="firstName"
                type="text"
                required
                autoComplete="given-name"
              />
              <Field
                label="Last name"
                name="lastName"
                type="text"
                required
                autoComplete="family-name"
              />
            </div>
            <Field
              label="Company name"
              name="companyName"
              type="text"
              required
              autoComplete="organization"
              placeholder="Acme Inc"
            />
            <Field
              label="Password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              hint="At least 8 characters."
            />
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <Button
              type="submit"
              loading={loading}
              disabled={loading}
              className="w-full mt-1"
            >
              Create workspace
            </Button>
          </form>
        )}
        <p className="text-sm text-theme-text-secondary text-center">
          Already have an account?{" "}
          <Link
            to={paths.login()}
            className="text-sky-300 light:text-sky-600 font-semibold hover:underline"
          >
            Sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}
