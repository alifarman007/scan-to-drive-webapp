"use client";

import { CheckIcon, CircleNotchIcon, EyeIcon, EyeSlashIcon, LockKeyIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useAnimate } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { ApiError, NETWORK_ERROR, api } from "@/lib/api";

type LoginResponse = { user: { id: number; username: string; role: "admin" | "viewer" } };

/** Username + password for the transport office. Success sets the 8-hour session cookie (backend) and opens `next`. */
export function AdminLogin({ next, expired }: { next: string; expired: boolean }) {
  const t = useTranslations("adminAuth");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [scope, animate] = useAnimate();

  useEffect(() => {
    if (shake > 0 && scope.current) animate(scope.current, { x: [0, -10, 10, -7, 7, -3, 3, 0] }, { duration: 0.42 });
  }, [shake, animate, scope]);

  function messageFor(err: unknown) {
    if (!(err instanceof ApiError)) return t("errServer");
    if (err.code === NETWORK_ERROR || err.code === "BACKEND_DOWN") return t("errNetwork");
    if (err.status === 401) return t("errWrong");
    if (err.status === 429) return t("errLocked");
    if (err.status === 422) return t("errEmpty");
    return t("errServer");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || done) return;
    if (!username.trim() || !password) {
      setError(t("errEmpty"));
      setShake((n) => n + 1);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api<LoginResponse>("/auth/admin/login", { json: { username: username.trim(), password } });
      setDone(true);
      // a full page load: the admin pages are read fresh with the new session
      setTimeout(() => window.location.replace(next), 550);
    } catch (err) {
      setError(messageFor(err));
      setPassword("");
      setShake((n) => n + 1);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-3xl font-bold text-title">{t("title")}</h1>
        <p className="text-muted">{t("lead")}</p>
      </div>

      {expired ? (
        <p className="flex items-start gap-2.5 rounded-2xl bg-wait-bg px-4 py-3 text-sm font-semibold text-wait-fg">
          <LockKeyIcon size={18} weight="fill" className="mt-px shrink-0" />
          {t("expired")}
        </p>
      ) : null}

      <div ref={scope} className="flex flex-col gap-4">
        <Field label={t("username")} htmlFor="a-user">
          <Input
            id="a-user"
            autoFocus
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setError(null);
            }}
            invalid={Boolean(error)}
            maxLength={60}
          />
        </Field>
        <Field label={t("password")} htmlFor="a-pass">
          <div className="relative">
            <Input
              id="a-pass"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              invalid={Boolean(error)}
              maxLength={72}
              className="pr-14"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? t("hidePassword") : t("showPassword")}
              aria-pressed={show}
              className="absolute top-1/2 right-1.5 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-[0.65rem] text-muted transition-colors hover:bg-soft hover:text-title"
            >
              {show ? <EyeSlashIcon size={20} /> : <EyeIcon size={20} />}
            </button>
          </div>
        </Field>
      </div>

      <AnimatePresence initial={false}>
        {error ? (
          <motion.p
            role="alert"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-start gap-2 overflow-hidden text-sm font-semibold text-bad-fg"
          >
            <WarningCircleIcon size={18} weight="fill" className="mt-px shrink-0" />
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>

      <Button type="submit" size="xl" lift disabled={busy || done} aria-busy={busy}>
        <AnimatePresence mode="wait" initial={false}>
          {done ? (
            <motion.span key="done" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="inline-flex items-center gap-2">
              <CheckIcon size={22} weight="bold" />
              {t("welcome")}
            </motion.span>
          ) : busy ? (
            <motion.span key="busy" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <CircleNotchIcon size={22} className="animate-spin" />
            </motion.span>
          ) : (
            <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              {t("signIn")}
            </motion.span>
          )}
        </AnimatePresence>
      </Button>

      <p className="text-sm text-muted">{t("sessionNote")}</p>
    </form>
  );
}
