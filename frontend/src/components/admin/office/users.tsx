"use client";

import {
  CheckIcon,
  CircleNotchIcon,
  CopyIcon,
  EyeIcon,
  EyeSlashIcon,
  KeyIcon,
  LockKeyIcon,
  PlusIcon,
  PowerIcon,
  ShieldCheckIcon,
  SparkleIcon,
  UserCircleGearIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useAdminUser } from "@/components/admin/admin-shell";
import { Avatar, PageHeader, Segmented, useFlash } from "@/components/admin/fleet/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Reveal } from "@/components/ui/reveal";
import { ApiError } from "@/lib/api";
import { useNowSeconds } from "@/lib/hooks";
import { adminApi, isSignedOut, toSignIn, type AdminAccount, type AdminUser } from "@/lib/admin-api";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------------------------------------ */
/*  passwords                                                                                        */
/* ------------------------------------------------------------------------------------------------ */

const WORDS_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** A random password that is easy to read out: three groups of four, no look-alike letters (0/O, 1/l). */
export function makePassword() {
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => WORDS_ALPHABET[b % WORDS_ALPHABET.length]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)].map((g) => g.join("")).join("-");
}

/** 0-4: length, mixed letters, digits, symbols. Enough to steer people away from "password1". */
function strength(pw: string) {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  if (/^(.)\1+$/.test(pw) || /^(password|12345678|qwerty)/i.test(pw)) score = 0;
  return Math.min(4, score);
}

function StrengthBar({ password }: { password: string }) {
  const t = useTranslations("users.password");
  const s = strength(password);
  const colour = ["bg-border", "bg-bad-dot", "bg-wait-dot", "bg-ok-dot", "bg-ok-dot"][s];
  return (
    <div className="flex items-center gap-3" aria-live="polite">
      <div className="grid flex-1 grid-cols-4 gap-1">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className="h-1.5 overflow-hidden rounded-full bg-border">
            <motion.span className={cn("block h-full rounded-full", colour)} initial={false} animate={{ width: s >= i ? "100%" : "0%" }} transition={{ duration: 0.25 }} />
          </span>
        ))}
      </div>
      <span className="w-20 text-right text-xs font-semibold text-muted">{password ? t(`strength${s}`) : ""}</span>
    </div>
  );
}

/** Password box with show / hide, and optionally "Make one" and "Copy". */
function PasswordInput({
  id,
  value,
  onChange,
  invalid,
  autoComplete,
  generate,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  autoComplete: string;
  generate?: boolean;
  autoFocus?: boolean;
}) {
  const t = useTranslations("users.password");
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Input
          id={id}
          type={shown ? "text" : "password"}
          value={value}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          spellCheck={false}
          maxLength={72}
          invalid={invalid}
          onChange={(e) => onChange(e.target.value)}
          className={cn("pr-24", shown && "font-mono tracking-wide")}
        />
        <div className="absolute inset-y-0 right-1.5 flex items-center gap-0.5">
          {value && generate ? (
            <button
              type="button"
              aria-label={t("copy")}
              title={t("copy")}
              onClick={() => {
                void navigator.clipboard?.writeText(value);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="inline-flex size-10 items-center justify-center rounded-full text-muted hover:bg-soft hover:text-title"
            >
              {copied ? <CheckIcon size={18} weight="bold" className="text-ok-dot" /> : <CopyIcon size={18} />}
            </button>
          ) : null}
          <button
            type="button"
            aria-label={shown ? t("hide") : t("show")}
            aria-pressed={shown}
            onClick={() => setShown((s) => !s)}
            className="inline-flex size-10 items-center justify-center rounded-full text-muted hover:bg-soft hover:text-title"
          >
            {shown ? <EyeSlashIcon size={18} /> : <EyeIcon size={18} />}
          </button>
        </div>
      </div>
      {generate ? (
        <button
          type="button"
          onClick={() => {
            onChange(makePassword());
            setShown(true);
          }}
          className="inline-flex w-fit items-center gap-1.5 text-sm font-bold text-accent hover:underline"
        >
          <SparkleIcon size={15} weight="fill" />
          {t("make")}
        </button>
      ) : null}
    </div>
  );
}

function passwordError(t: (k: string) => string, pw: string) {
  if (pw.length < 8) return t("password.tooShort");
  if (new TextEncoder().encode(pw).length > 72) return t("password.tooLong");
  if (!pw.trim()) return t("password.tooShort");
  return null;
}

function errorText(t: (k: string) => string, err: unknown) {
  if (err instanceof ApiError) {
    if (["USERNAME_TAKEN", "CANNOT_CHANGE_SELF", "LAST_ADMIN", "WRONG_PASSWORD"].includes(err.code)) return t(`errors.${err.code}`);
    if (err.status === 422) return t("errors.check");
    if (err.status === 0 || err.code === "BACKEND_DOWN") return t("errors.network");
  }
  return t("errors.generic");
}

/* ------------------------------------------------------------------------------------------------ */
/*  page                                                                                             */
/* ------------------------------------------------------------------------------------------------ */

/**
 * Users: your own account (change your password) for everyone; for admins, every account with its role and
 * last sign-in: add one, change the role, set a new password, turn off.
 */
export function UsersView({ accounts }: { accounts: AdminAccount[] | null }) {
  const t = useTranslations("users");
  const user = useAdminUser();
  const router = useRouter();
  const [flash, showFlash] = useFlash();
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<{ username: string; password: string; role: AdminUser["role"] } | null>(null);

  const saved = (text: string) => {
    showFlash(text);
    router.refresh();
  };

  const active = accounts?.filter((a) => a.status === "active").length ?? 0;

  return (
    <div className="flex flex-col gap-section">
      <Reveal>
        <PageHeader title={t("title")} summary={accounts ? t("summary", { active, total: accounts.length }) : t("summaryViewer")}>
          {accounts ? (
            <Button size="md" lift onClick={() => setAdding(true)}>
              <PlusIcon size={18} weight="bold" />
              {t("add")}
            </Button>
          ) : null}
        </PageHeader>
      </Reveal>

      <div className="grid gap-section lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-section">
          {accounts ? (
            <Reveal delay={0.05}>
              <Card className="flex flex-col p-2 sm:p-3">
                <ul className="flex flex-col">
                  {accounts.map((a, i) => (
                    <motion.li
                      key={a.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.03 * i }}
                      className={cn(i > 0 && "border-t border-border")}
                    >
                      <AccountRow account={a} onSaved={saved} />
                    </motion.li>
                  ))}
                </ul>
              </Card>
            </Reveal>
          ) : null}
          <Reveal delay={0.08}>
            <RolesExplained />
          </Reveal>
        </div>
        <Reveal delay={0.1}>
          <MyAccount me={user} onChanged={() => showFlash(t("me.changed"))} />
        </Reveal>
      </div>

      <Modal open={adding} onOpenChange={setAdding} title={t("form.title")} description={t("form.hint")}>
        {adding ? (
          <AddAccountForm
            taken={accounts?.map((a) => a.username.toLowerCase()) ?? []}
            onDone={(c) => {
              setAdding(false);
              setCreated(c);
              router.refresh();
            }}
          />
        ) : null}
      </Modal>
      <Modal open={created !== null} onOpenChange={(o) => !o && setCreated(null)} title={t("created.title")} description={t("created.hint")}>
        {created ? <CreatedCard {...created} onClose={() => setCreated(null)} /> : null}
      </Modal>
      {flash}
    </div>
  );
}

function RoleChip({ role }: { role: AdminUser["role"] }) {
  const t = useTranslations("adminAuth");
  return (
    <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-bold", role === "admin" ? "bg-trip-bg text-trip-fg" : "bg-off-bg text-off-fg")}>
      {role === "admin" ? t("roleAdmin") : t("roleViewer")}
    </span>
  );
}

function AccountRow({ account, onSaved }: { account: AdminAccount; onSaved: (text: string) => void }) {
  const t = useTranslations("users");
  const format = useFormatter();
  const nowSec = useNowSeconds();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const off = account.status === "inactive";

  async function change(changes: { role?: AdminUser["role"]; status?: "active" | "inactive" }, text: string) {
    setBusy(true);
    setError(null);
    try {
      await adminApi.updateUser(account.id, changes);
      onSaved(text);
    } catch (err) {
      if (isSignedOut(err)) return toSignIn();
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("flex flex-col gap-3 rounded-2xl p-3 transition-colors sm:p-4", off && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Avatar name={account.username} size={46} dim={off} />
        <div className="flex min-w-[11rem] flex-1 basis-[11rem] flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-display text-lg font-semibold text-title">{account.username}</span>
            {account.is_me ? <span className="rounded-full bg-soft px-2 py-0.5 text-xs font-bold text-accent">{t("you")}</span> : null}
            {off ? <span className="rounded-full bg-off-bg px-2 py-0.5 text-xs font-bold text-off-fg">{t("off")}</span> : null}
          </div>
          <span className="text-xs text-muted">
            {account.last_sign_in
              ? t("lastSignIn", {
                  // relative time only in the browser (the server's clock would not match the page's first paint)
                  time:
                    nowSec === null
                      ? format.dateTime(new Date(account.last_sign_in), { day: "numeric", month: "short" })
                      : format.relativeTime(new Date(account.last_sign_in), new Date(nowSec * 1000)),
                })
              : t("neverSignedIn")}
          </span>
        </div>
        <Segmented
          id={`role-${account.id}`}
          label={t("roleLabel", { name: account.username })}
          value={account.role}
          onChange={(role) => void change({ role }, t("roleSaved", { name: account.username }))}
          options={[
            { value: "admin", label: t("roles.admin") },
            { value: "viewer", label: t("roles.viewer") },
          ]}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-0 sm:pl-[3.875rem]">
        <Button variant="ghost" size="sm" onClick={() => setResetting(true)} disabled={busy}>
          <KeyIcon size={15} weight="bold" />
          {account.is_me ? t("changeMine") : t("setPassword")}
        </Button>
        {!account.is_me ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void change({ status: off ? "active" : "inactive" }, off ? t("onSaved", { name: account.username }) : t("offSaved", { name: account.username }))}
            disabled={busy}
            className={off ? "" : "text-bad-fg hover:bg-bad-bg"}
          >
            {busy ? <CircleNotchIcon size={15} className="animate-spin" /> : <PowerIcon size={15} weight="bold" />}
            {off ? t("turnOn") : t("turnOff")}
          </Button>
        ) : null}
        <AnimatePresence>
          {error ? (
            <motion.span initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-1.5 text-sm font-semibold text-bad-fg">
              <WarningCircleIcon size={16} weight="fill" />
              {error}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>
      <Modal
        open={resetting}
        onOpenChange={setResetting}
        title={t("reset.title", { name: account.username })}
        description={account.is_me ? t("reset.mineHint") : t("reset.hint")}
      >
        {resetting ? (
          account.is_me ? (
            <ChangeMyPassword onDone={() => { setResetting(false); onSaved(t("me.changed")); }} />
          ) : (
            <ResetForm account={account} onDone={() => { setResetting(false); onSaved(t("reset.done", { name: account.username })); }} />
          )
        ) : null}
      </Modal>
    </div>
  );
}

function ResetForm({ account, onDone }: { account: AdminAccount; onDone: () => void }) {
  const t = useTranslations("users");
  const [pw, setPw] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bad = passwordError(t, pw);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (bad || busy) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.resetPassword(account.id, pw);
      onDone();
    } catch (err) {
      if (isSignedOut(err)) return toSignIn();
      setError(errorText(t, err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field label={t("password.new")} htmlFor="reset-pw" error={tried && bad ? bad : undefined}>
        <PasswordInput id="reset-pw" value={pw} onChange={setPw} invalid={Boolean(tried && bad)} autoComplete="new-password" generate autoFocus />
      </Field>
      <StrengthBar password={pw} />
      <p className="text-sm text-muted">{t("reset.tell")}</p>
      {error ? <p role="alert" className="text-sm font-semibold text-bad-fg">{error}</p> : null}
      <Button type="submit" size="lg" lift disabled={busy}>
        {busy ? <CircleNotchIcon size={18} className="animate-spin" /> : t("reset.save")}
      </Button>
    </form>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/*  my account                                                                                       */
/* ------------------------------------------------------------------------------------------------ */

function MyAccount({ me, onChanged }: { me: AdminUser; onChanged: () => void }) {
  const t = useTranslations("users");
  const ta = useTranslations("adminAuth");
  const [open, setOpen] = useState(false);
  return (
    <Card className="relative flex flex-col gap-4 overflow-hidden p-5">
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-16 bg-gradient-to-r from-navy to-epic" />
      <div className="relative flex items-start gap-3 pt-6">
        <span className="rounded-full bg-card p-1 shadow-md">
          <Avatar name={me.username} size={60} />
        </span>
        <div className="flex min-w-0 flex-col gap-1 pt-11">
          <span className="truncate font-display text-xl font-semibold text-title">{me.username}</span>
          <RoleChip role={me.role} />
        </div>
      </div>
      <p className="text-sm text-muted">{me.role === "admin" ? ta("roleAdminHint") : ta("roleViewerHint")}</p>
      <AnimatePresence initial={false} mode="wait">
        {open ? (
          <motion.div key="form" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="-mx-1 overflow-hidden px-1 pb-1">
            <ChangeMyPassword
              onDone={() => {
                setOpen(false);
                onChanged();
              }}
              onCancel={() => setOpen(false)}
            />
          </motion.div>
        ) : (
          <motion.div key="btn" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Button variant="secondary" size="md" className="w-full" onClick={() => setOpen(true)}>
              <LockKeyIcon size={18} weight="bold" />
              {t("me.change")}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

function ChangeMyPassword({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const t = useTranslations("users");
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bad = passwordError(t, pw);
  const mismatch = again !== pw;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!current || bad || mismatch || busy) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.changeMyPassword(current, pw);
      onDone();
    } catch (err) {
      // a wrong current password is a 401 from this call, not a lost session
      setError(errorText(t, err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <Field label={t("password.current")} htmlFor="my-current" error={tried && !current ? t("password.needed") : undefined}>
        <PasswordInput id="my-current" value={current} onChange={setCurrent} invalid={tried && !current} autoComplete="current-password" autoFocus />
      </Field>
      <Field label={t("password.new")} htmlFor="my-new" error={tried && bad ? bad : undefined}>
        <PasswordInput id="my-new" value={pw} onChange={setPw} invalid={Boolean(tried && bad)} autoComplete="new-password" />
      </Field>
      <StrengthBar password={pw} />
      <Field label={t("password.again")} htmlFor="my-again" error={tried && mismatch ? t("password.mismatch") : undefined}>
        <PasswordInput id="my-again" value={again} onChange={setAgain} invalid={tried && mismatch} autoComplete="new-password" />
      </Field>
      {error ? <p role="alert" className="text-sm font-semibold text-bad-fg">{error}</p> : null}
      <div className={cn("grid gap-2", onCancel ? "grid-cols-[1fr_2fr]" : "grid-cols-1")}>
        {onCancel ? (
          <Button variant="ghost" size="md" onClick={onCancel} disabled={busy}>
            {t("me.cancel")}
          </Button>
        ) : null}
        <Button type="submit" size="md" lift disabled={busy}>
          {busy ? <CircleNotchIcon size={18} className="animate-spin" /> : t("me.save")}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/*  add an account                                                                                   */
/* ------------------------------------------------------------------------------------------------ */

function AddAccountForm({ taken, onDone }: { taken: string[]; onDone: (c: { username: string; password: string; role: AdminUser["role"] }) => void }) {
  const t = useTranslations("users");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<AdminUser["role"]>("viewer");
  const [pw, setPw] = useState(() => makePassword());
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameOk = /^[A-Za-z0-9._-]{3,60}$/.test(username);
  const nameTaken = taken.includes(username.toLowerCase());
  const bad = passwordError(t, pw);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!nameOk || nameTaken || bad || busy) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.addUser({ username, role, password: pw });
      onDone({ username, password: pw, role });
    } catch (err) {
      if (isSignedOut(err)) return toSignIn();
      setError(errorText(t, err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field
        label={t("form.username")}
        htmlFor="new-user"
        hint={t("form.usernameHint")}
        error={tried && !nameOk ? t("form.usernameBad") : nameTaken ? t("errors.USERNAME_TAKEN") : undefined}
      >
        <Input
          id="new-user"
          autoFocus
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          maxLength={60}
          placeholder="mary.akter"
          invalid={(tried && !nameOk) || nameTaken}
          onChange={(e) => setUsername(e.target.value.replace(/\s/g, ""))}
        />
      </Field>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-text">{t("form.role")}</span>
        <div role="radiogroup" aria-label={t("form.role")} className="grid gap-2 sm:grid-cols-2">
          {(["viewer", "admin"] as const).map((r) => {
            const on = role === r;
            const Icon = r === "admin" ? ShieldCheckIcon : EyeIcon;
            return (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setRole(r)}
                className={cn(
                  "relative flex items-start gap-3 rounded-2xl border-[1.5px] p-3.5 text-left transition-[border-color,background-color,box-shadow]",
                  on ? "border-accent bg-soft shadow-[0_0_0_4px_var(--ring-soft)]" : "border-border-strong hover:bg-bay",
                )}
              >
                <span className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-xl", on ? "bg-accent text-white" : "bg-soft text-accent")}>
                  <Icon size={18} weight="duotone" />
                </span>
                <span className="flex flex-col">
                  <span className="font-semibold text-title">{t(`roles.${r}`)}</span>
                  <span className="text-xs text-muted">{t(`roles.${r}Hint`)}</span>
                </span>
                {on ? (
                  <motion.span layoutId="role-tick" className="absolute top-2.5 right-2.5 text-accent">
                    <CheckIcon size={16} weight="bold" />
                  </motion.span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
      <Field label={t("form.password")} htmlFor="new-pw" error={tried && bad ? bad : undefined}>
        <PasswordInput id="new-pw" value={pw} onChange={setPw} invalid={Boolean(tried && bad)} autoComplete="new-password" generate />
      </Field>
      <StrengthBar password={pw} />
      {error ? <p role="alert" className="text-sm font-semibold text-bad-fg">{error}</p> : null}
      <Button type="submit" size="lg" lift disabled={busy}>
        {busy ? <CircleNotchIcon size={18} className="animate-spin" /> : t("form.add")}
      </Button>
    </form>
  );
}

/** Shown once after adding an account: what to send to the person (the password is not shown again). */
function CreatedCard({ username, password, role, onClose }: { username: string; password: string; role: AdminUser["role"]; onClose: () => void }) {
  const t = useTranslations("users.created");
  const [copied, setCopied] = useState(false);
  const text = t("message", { url: typeof window === "undefined" ? "" : `${window.location.origin}/admin/login`, username, password });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-2xl bg-bay p-4">
        <div className="flex items-center gap-3">
          <Avatar name={username} size={44} />
          <div className="flex flex-col">
            <span className="font-display text-lg font-semibold text-title">{username}</span>
            <RoleChip role={role} />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-card px-3 py-2.5">
          <span className="text-xs font-semibold text-muted">{t("password")}</span>
          <span className="font-mono text-base font-bold tracking-wide text-title select-all">{password}</span>
        </div>
      </div>
      <p className="flex items-start gap-2 text-sm text-muted">
        <UserCircleGearIcon size={18} weight="duotone" className="mt-px shrink-0 text-accent" />
        {t("tip")}
      </p>
      <div className="grid grid-cols-[1fr_2fr] gap-2">
        <Button variant="ghost" size="lg" onClick={onClose}>
          {t("done")}
        </Button>
        <Button
          size="lg"
          lift
          onClick={() => {
            void navigator.clipboard?.writeText(text);
            setCopied(true);
          }}
        >
          {copied ? <CheckIcon size={18} weight="bold" /> : <CopyIcon size={18} weight="bold" />}
          {copied ? t("copied") : t("copy")}
        </Button>
      </div>
    </div>
  );
}

function RolesExplained() {
  const t = useTranslations("users.roles");
  return (
    <Card className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
      {(["admin", "viewer"] as const).map((r) => (
        <div key={r} className="flex items-start gap-3">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-soft text-accent">
            {r === "admin" ? <ShieldCheckIcon size={20} weight="duotone" /> : <EyeIcon size={20} weight="duotone" />}
          </span>
          <div className="flex flex-col gap-0.5">
            <span className="font-semibold text-title">{t(r)}</span>
            <span className="text-sm text-muted">{t(`${r}Long`)}</span>
          </div>
        </div>
      ))}
    </Card>
  );
}
