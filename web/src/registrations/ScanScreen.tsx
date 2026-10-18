// The organizer scan screen /registrations/scan (registration-web.md W-R28-W-R37).
// Inside the scan entry (W-R28). The camera starts on a click only; the screen asks for
// it itself (so the error name is kept, W-R30) and hands the video to scanner.ts. Every
// code, scanned or typed, goes through one submit path that sends one request per code
// (W-R33). No role eyebrow (RE1).
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type Ref } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { BackLink } from "../events/EventParts";
import { formatDateTime } from "../events/format";
import { isAuthError, onApiError, useEvents } from "../events/queries";
import { Badge, type Tone } from "../events/StatusBadge";
import type { CheckInResult } from "./api";
import { ArrivalsCounter } from "./ArrivalsCounter";
import { cameraState, type CameraProblem } from "./camera";
import { EventSelect, useChosenEvent } from "./EventSelect";
import { useCheckIn } from "./queries";
import { hasCamera, startScanner } from "./scanner";
import { normalizeTyped, parseTicketCode } from "./ticketCode";

const NEW_EVENT = "/organizer/events/new";

type Camera = "idle" | "asking" | "active" | CameraProblem;

type Check =
  | { kind: "idle" }
  | { kind: "pending"; code: string }
  | { kind: "result"; result: CheckInResult }
  | { kind: "failed"; code: string };

const CAMERA_TEXT: Record<CameraProblem, string> = {
  denied:
    "Camera access is blocked. Allow the camera in your browser settings, or enter the code below.",
  none: "No camera found. Enter the code below.",
  insecure: "The camera needs a secure connection (https or localhost). Enter the code below.",
  other: "Could not start the camera.",
};

const CODE_ERROR = "Enter a valid ticket code: 10 characters, A-Z without I and O, and 2-9.";

type Props = {
  // The check-in call; by default POST /checkin (W-R33). Tests may give a stub.
  submitCode?: (code: string) => Promise<CheckInResult>;
};

export function ScanScreen({ submitCode }: Props) {
  const queryClient = useQueryClient();
  const events = useEvents();
  const [chosen, choose] = useChosenEvent(events.data);
  const checkIn = useCheckIn();
  const submit = submitCode ?? checkIn.mutateAsync;

  const [camera, setCamera] = useState<Camera>("idle");
  const [check, setCheck] = useState<Check>({ kind: "idle" });
  const [notTicket, setNotTicket] = useState(false);
  const [typed, setTyped] = useState("");
  const [fieldError, setFieldError] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Bumped on every release, so a late answer of an old camera request is dropped.
  const attemptRef = useRef(0);
  // Set at the first accepted code, cleared by "Scan next" (W-R33).
  const busyRef = useRef(false);
  const sendingRef = useRef(false);
  const mountedRef = useRef(true);

  // Stops the camera tracks; the scanner itself stops in its effect below (W-R35).
  function release() {
    attemptRef.current += 1;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      release();
    };
  }, []);

  async function startCamera() {
    release();
    const attempt = attemptRef.current;
    const devices = window.isSecureContext ? navigator.mediaDevices : undefined;
    if (!devices || typeof devices.getUserMedia !== "function") {
      setCamera(cameraState(undefined));
      return;
    }
    setCamera("asking");
    const found = await hasCamera().catch(() => true);
    if (attempt !== attemptRef.current) return;
    if (!found) {
      setCamera("none");
      return;
    }
    try {
      const stream = await devices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      if (attempt !== attemptRef.current) {
        // Left the screen (or changed the event) while asking: stop the late stream.
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      setCamera("active");
    } catch (error) {
      if (attempt === attemptRef.current) setCamera(cameraState(error));
    }
  }

  // The scanner reads only while the preview is active; leaving "active" or the screen
  // stops it (W-R35).
  const onScanRef = useRef<(text: string) => void>(() => undefined);
  onScanRef.current = onScan;
  useEffect(() => {
    if (camera !== "active") return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    return startScanner(video, (text) => onScanRef.current(text));
  }, [camera]);

  // Focus moves to the result heading (W-R34).
  useEffect(() => {
    if (check.kind === "result" || check.kind === "failed") resultHeadingRef.current?.focus();
  }, [check]);

  async function send(code: string) {
    if (sendingRef.current) return;
    sendingRef.current = true;
    busyRef.current = true;
    setCheck({ kind: "pending", code });
    try {
      const result = await submit(code);
      if (mountedRef.current) setCheck({ kind: "result", result });
    } catch (error) {
      // 401/403: me is checked again and the guard decides; no text of our own (W-R13).
      onApiError(queryClient, error);
      if (!mountedRef.current) return;
      if (isAuthError(error)) {
        busyRef.current = false;
        setCheck({ kind: "idle" });
      } else {
        setCheck({ kind: "failed", code });
      }
    } finally {
      sendingRef.current = false;
    }
  }

  function accept(code: string) {
    if (busyRef.current) return;
    setNotTicket(false);
    setFieldError(false);
    void send(code);
  }

  // W-R31: decoded texts are checked first; while a code is pending or its result is
  // shown every text is dropped (W-R33).
  function onScan(text: string) {
    if (busyRef.current) return;
    const code = parseTicketCode(text);
    if (code === null) {
      setNotTicket(true);
      return;
    }
    accept(code);
  }

  function onManual(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    const code = parseTicketCode(normalizeTyped(typed));
    if (code === null) {
      setFieldError(true);
      inputRef.current?.focus();
      return;
    }
    accept(code);
  }

  function scanNext() {
    busyRef.current = false;
    setCheck({ kind: "idle" });
    setNotTicket(false);
    setTyped("");
    setFieldError(false);
  }

  function changeEvent(id: string) {
    release();
    setCamera("idle");
    scanNext();
    choose(id);
  }

  // DA46: the back link goes to the chosen event's registrations, else to the list.
  const backTo =
    chosen === null ? "/registrations" : `/registrations?event=${encodeURIComponent(chosen.id)}`;

  if (events.isPending || (events.isError && (events.isFetching || isAuthError(events.error)))) {
    return (
      <Shell backTo={backTo}>
        <p role="status" className="status status-gap">
          Loading...
        </p>
      </Shell>
    );
  }

  if (events.isError) {
    return (
      <Shell backTo={backTo}>
        {/* design-alignment.md DA14: the error box and a secondary Retry. */}
        <p role="alert" className="error-box">
          Could not load events
        </p>
        <p className="intro">Check your connection and try again.</p>
        <button type="button" className="button-secondary" onClick={() => void events.refetch()}>
          Retry
        </button>
      </Shell>
    );
  }

  if (chosen === null) {
    return (
      <Shell backTo={backTo}>
        <p className="intro">You have no events yet.</p>
        <Link to={NEW_EVENT} className="button-link">
          Create event
        </Link>
      </Shell>
    );
  }

  const pending = check.kind === "pending";

  return (
    <Shell backTo={backTo}>
      <EventSelect events={events.data} value={chosen.id} onChange={changeEvent} />
      {/* checkin-web.md W-C3: in every camera state; a 200 check-in reads it again (W-C11). */}
      <ArrivalsCounter eventId={chosen.id} />

      <div className="scan-camera">
        <CameraArea camera={camera} videoRef={videoRef} onStart={() => void startCamera()} />
        {/* DA19: inside the camera card, under the preview; scanning goes on. */}
        {notTicket && (
          <p role="alert" className="error-box">
            This is not a ticket code.
          </p>
        )}
      </div>

      {(check.kind === "result" || check.kind === "failed") && (
        <ResultCard
          check={check}
          headingRef={resultHeadingRef}
          onNext={scanNext}
          onRetry={() => {
            if (check.kind === "failed") void send(check.code);
          }}
        />
      )}

      <ManualForm
        typed={typed}
        onType={setTyped}
        error={fieldError}
        pending={pending}
        inputRef={inputRef}
        onSubmit={onManual}
      />
    </Shell>
  );
}

function Shell({ backTo, children }: { backTo: string; children: ReactNode }) {
  return (
    <section className="scan-page" data-role="organizer">
      <BackLink to={backTo} name="registrations" />
      <h1>Check in</h1>
      {children}
    </section>
  );
}

function CameraArea({
  camera,
  videoRef,
  onStart,
}: {
  camera: Camera;
  videoRef: Ref<HTMLVideoElement>;
  onStart: () => void;
}) {
  // design-alignment.md DA17: idle, asking and active show one dark camera box.
  switch (camera) {
    case "idle":
      return (
        <>
          <div className="scan-box">
            <p className="scan-box-text">Camera is off</p>
          </div>
          <button type="button" className="button-primary scan-start" onClick={onStart}>
            Start camera
          </button>
        </>
      );
    case "asking":
      return (
        <div className="scan-box">
          <p role="status" className="scan-box-text">
            Waiting for camera permission...
          </p>
        </div>
      );
    case "active":
      return (
        <div className="scan-box">
          <video
            ref={videoRef}
            className="scan-video"
            aria-label="Camera preview"
            playsInline
            muted
          />
          <div className="scan-frame" aria-hidden="true" />
          <p role="status" className="scan-box-bar">
            Point the camera at the ticket QR code.
          </p>
        </div>
      );
    // The four camera problems are alerts in the error box (design-alignment.md DA18).
    case "other":
      return (
        <>
          <p role="alert" className="error-box">
            {CAMERA_TEXT.other}
          </p>
          <button type="button" className="button-secondary scan-start" onClick={onStart}>
            Try again
          </button>
        </>
      );
    default:
      return (
        <p role="alert" className="error-box">
          {CAMERA_TEXT[camera]}
        </p>
      );
  }
}

const REFUSED_TEXT: Record<
  Exclude<CheckInResult["outcome"], "checked_in" | "already_checked_in">,
  string
> = {
  not_found: "Ticket not found.",
  waitlisted: "On the waiting list, no seat yet.",
  registration_cancelled: "This ticket is cancelled.",
  event_cancelled: "This event is cancelled.",
  invalid_input: "This is not a ticket code.",
};

function ResultCard({
  check,
  headingRef,
  onNext,
  onRetry,
}: {
  check: Extract<Check, { kind: "result" | "failed" }>;
  headingRef: Ref<HTMLHeadingElement>;
  onNext: () => void;
  onRetry: () => void;
}) {
  // DA20: Scan next is the primary button in every result; Try again is secondary.
  const next = (
    <button type="button" className="button-primary scan-next" onClick={onNext}>
      Scan next
    </button>
  );

  if (check.kind === "failed") {
    return (
      <div role="alert" className="scan-result" data-tone="cancelled">
        <h2 ref={headingRef} tabIndex={-1} className="error-box">
          Something went wrong. Try again.
        </h2>
        <div className="scan-result-actions">
          <button type="button" className="button-secondary scan-next" onClick={onRetry}>
            Try again
          </button>
          {next}
        </div>
      </div>
    );
  }

  const { result } = check;
  if (result.outcome === "checked_in" || result.outcome === "already_checked_in") {
    const done = result.outcome === "checked_in";
    const tone: Tone = done ? "open" : "muted";
    return (
      <div role="status" className="scan-result" data-tone={tone}>
        <h2 ref={headingRef} tabIndex={-1}>
          <Badge text={done ? "Checked in" : "Already checked in"} tone={tone} />
        </h2>
        <p className="scan-result-name">{result.attendee_name}</p>
        {result.outcome === "checked_in" && <p className="scan-result-line">{result.event_title}</p>}
        {result.outcome === "already_checked_in" && (
          <p className="scan-result-line">
            {`First check-in: ${formatDateTime(result.checked_in_at)}`}
          </p>
        )}
        <dl className="ticket-code-block">
          <dt>Ticket code</dt>
          <dd className="ticket-code">{result.ticket_code}</dd>
        </dl>
        {next}
      </div>
    );
  }

  return (
    <div role="alert" className="scan-result" data-tone="cancelled">
      <h2 ref={headingRef} tabIndex={-1} className="error-box">
        {REFUSED_TEXT[result.outcome]}
      </h2>
      {next}
    </div>
  );
}

function ManualForm({
  typed,
  onType,
  error,
  pending,
  inputRef,
  onSubmit,
}: {
  typed: string;
  onType: (value: string) => void;
  error: boolean;
  pending: boolean;
  inputRef: Ref<HTMLInputElement>;
  onSubmit: (event: FormEvent) => void;
}) {
  const inputId = useId();
  const errorId = useId();
  return (
    <form className="form scan-manual" onSubmit={onSubmit} noValidate>
      <h2>Or enter the code</h2>
      <div className="field">
        <label htmlFor={inputId}>Ticket code</label>
        <input
          id={inputId}
          ref={inputRef}
          value={typed}
          onChange={(event) => onType(event.target.value)}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        {error && (
          <p id={errorId} role="alert" className="field-error">
            {CODE_ERROR}
          </p>
        )}
      </div>
      <button type="submit" className="button-primary" disabled={pending} aria-busy={pending}>
        {pending ? "Checking..." : "Check in"}
      </button>
    </form>
  );
}
