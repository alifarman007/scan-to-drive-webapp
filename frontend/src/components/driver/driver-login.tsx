"use client";

import { ArrowLeftIcon, CheckCircleIcon, CircleNotchIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Label } from "@/components/ui/input";
import { PinInput } from "@/components/ui/pin-input";
import { ApiError, NETWORK_ERROR, api } from "@/lib/api";

type Step = "login" | "choose" | "confirm" | "done";
type LoginResponse = { driver: { id: number; employee_id: string; name: string } };

const LAST_ID_KEY = "s2d.lastEmployeeId";

const noSubscribe = () => () => {};

function readLastId(): string {
  try {
    return localStorage.getItem(LAST_ID_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberId(id: string) {
  try {
    localStorage.setItem(LAST_ID_KEY, id);
  } catch {
    /* private mode: fine, just not remembered */
  }
}

/**
 * Driver sign-in. Step 1: employee ID + PIN. If the driver has no PIN yet (new driver, or the admin reset it),
 * steps 2 and 3 ask for a new PIN twice. Success stores the session cookie (done by the backend) and opens `next`.
 */
export function DriverLogin({ next }: { next: string }) {
  const t = useTranslations("driverAuth");
  const router = useRouter();

  const [step, setStep] = useState<Step>("login");
  // The ID used last time on this phone is filled in (handy after signing out). null = not typed yet.
  const lastId = useSyncExternalStore(noSubscribe, readLastId, () => "");
  const [typedId, setTypedId] = useState<string | null>(null);
  const employeeId = typedId ?? lastId;
  const [pin, setPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const [name, setName] = useState("");

  function fail(message: string, clear: "pin" | "new" | "none" = "pin") {
    setError(message);
    setShake((n) => n + 1);
    if (clear === "pin") setPin("");
    if (clear === "new") {
      setNewPin("");
      setConfirmPin("");
    }
  }

  function messageFor(err: unknown): string {
    if (!(err instanceof ApiError)) return t("errServer");
    if (err.code === NETWORK_ERROR) return t("errNetwork");
    if (err.code === "WEAK_PIN") return t("errWeak");
    if (err.status === 401) return t("errWrong");
    if (err.status === 429) return t("errLocked");
    if (err.status === 409) return t("errAlreadySet");
    return t("errServer");
  }

  function succeed(res: LoginResponse) {
    rememberId(res.driver.employee_id);
    setName(res.driver.name);
    setStep("done");
    // a short moment for the tick, then into the app
    setTimeout(() => {
      router.replace(next);
      router.refresh();
    }, 650);
  }

  async function signIn(currentPin = pin) {
    const id = employeeId.trim();
    if (!id || currentPin.length !== 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      succeed(await api<LoginResponse>("/auth/driver/login", { json: { employee_id: id, pin: currentPin } }));
    } catch (err) {
      if (err instanceof ApiError && err.code === "PIN_NOT_SET") {
        setPin("");
        setStep("choose");
      } else {
        fail(messageFor(err));
      }
    } finally {
      setBusy(false);
    }
  }

  function chosen(value: string) {
    setError(null);
    setNewPin(value);
    setStep("confirm");
  }

  async function savePin(again = confirmPin) {
    if (again.length !== 4 || busy) return;
    if (again !== newPin) {
      fail(t("errMismatch"), "new");
      setStep("choose");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      succeed(
        await api<LoginResponse>("/auth/driver/set-pin", { json: { employee_id: employeeId.trim(), pin: newPin } }),
      );
    } catch (err) {
      fail(messageFor(err), "new");
      if (err instanceof ApiError && err.status === 409) setStep("login");
      else if (!(err instanceof ApiError) || err.code !== NETWORK_ERROR) setStep("choose");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <AnimatePresence mode="wait" initial={false}>
        {step === "login" ? (
          <Panel key="login">
            <Heading title={t("signInTitle")} lead={t("signInLead")} />
            <form
              className="flex flex-col gap-5"
              onSubmit={(e) => {
                e.preventDefault();
                void signIn();
              }}
            >
              <Field label={t("employeeId")} htmlFor="employee-id">
                <Input
                  id="employee-id"
                  mono
                  autoFocus
                  autoCapitalize="characters"
                  autoComplete="username"
                  spellCheck={false}
                  placeholder={t("employeeIdPlaceholder")}
                  value={employeeId}
                  onChange={(e) => setTypedId(e.target.value)}
                />
              </Field>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pin">{t("pin")}</Label>
                <PinInput
                  id="pin"
                  label={t("pin")}
                  value={pin}
                  onChange={(v) => {
                    setPin(v);
                    if (error) setError(null);
                  }}
                  onComplete={(v) => void signIn(v)}
                  invalid={Boolean(error)}
                  disabled={busy}
                  shakeKey={shake}
                />
                <p className="text-sm text-muted">{t("firstTimeHint")}</p>
              </div>
              <ErrorLine message={error} />
              <SubmitButton busy={busy} disabled={!employeeId.trim() || pin.length !== 4}>
                {t("signIn")}
              </SubmitButton>
            </form>
          </Panel>
        ) : null}

        {step === "choose" ? (
          <Panel key="choose">
            <BackButton label={t("back")} onClick={() => setStep("login")} />
            <Heading title={t("choosePinTitle")} lead={t("choosePinLead")} />
            <PinInput
              id="new-pin"
              label={t("newPin")}
              value={newPin}
              onChange={(v) => {
                setNewPin(v);
                if (error) setError(null);
              }}
              onComplete={chosen}
              invalid={Boolean(error)}
              shakeKey={shake}
              autoFocus
            />
            <ErrorLine message={error} />
          </Panel>
        ) : null}

        {step === "confirm" ? (
          <Panel key="confirm">
            <BackButton
              label={t("back")}
              onClick={() => {
                setConfirmPin("");
                setNewPin("");
                setStep("choose");
              }}
            />
            <Heading title={t("confirmPinTitle")} lead={t("confirmPinLead")} />
            <form
              className="flex flex-col gap-5"
              onSubmit={(e) => {
                e.preventDefault();
                void savePin();
              }}
            >
              <PinInput
                id="confirm-pin"
                label={t("confirmPin")}
                value={confirmPin}
                onChange={setConfirmPin}
                onComplete={(v) => void savePin(v)}
                disabled={busy}
                autoFocus
              />
              <ErrorLine message={error} />
              <SubmitButton busy={busy} disabled={confirmPin.length !== 4}>
                {t("savePin")}
              </SubmitButton>
            </form>
          </Panel>
        ) : null}

        {step === "done" ? (
          <Panel key="done">
            <div className="flex flex-col items-center gap-3 py-8 text-center" role="status">
              <motion.span
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 420, damping: 18 }}
                className="text-ok-dot"
              >
                <CheckCircleIcon size={72} weight="fill" />
              </motion.span>
              <p className="font-display text-2xl font-semibold text-title">{t("welcome", { name })}</p>
            </div>
          </Panel>
        ) : null}
      </AnimatePresence>

      {step === "login" ? <p className="text-center text-sm text-muted">{t("forgotPin")}</p> : null}
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      className="flex flex-col gap-5"
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -24 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

function Heading({ title, lead }: { title: string; lead: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="font-display text-2xl font-bold text-title">{title}</h1>
      <p className="text-sm text-muted">{lead}</p>
    </div>
  );
}

function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-ml-1 inline-flex h-10 w-fit items-center gap-1.5 rounded-lg px-1 text-sm font-bold text-accent"
    >
      <ArrowLeftIcon size={16} weight="bold" />
      {label}
    </button>
  );
}

function ErrorLine({ message }: { message: string | null }) {
  return (
    <AnimatePresence initial={false}>
      {message ? (
        <motion.p
          role="alert"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="flex items-start gap-2 overflow-hidden text-sm font-semibold text-bad-fg"
        >
          <WarningCircleIcon size={18} weight="fill" className="mt-px shrink-0" />
          {message}
        </motion.p>
      ) : null}
    </AnimatePresence>
  );
}

function SubmitButton({ busy, disabled, children }: { busy: boolean; disabled: boolean; children: React.ReactNode }) {
  return (
    <Button type="submit" size="xl" lift disabled={disabled || busy} aria-busy={busy}>
      {busy ? <CircleNotchIcon size={22} weight="bold" className="animate-spin" /> : children}
    </Button>
  );
}
