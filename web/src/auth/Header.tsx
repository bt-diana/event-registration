import { useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, Ref, RefObject } from "react";
import { Link, useLocation } from "react-router";
import type { Me } from "./api";
import { useLogout, useMe } from "./session";

const ROLE_NAME: Record<Me["role"], string> = { user: "Attendee", organizer: "Organizer" };

// One main link per role (registration-web.md W-R14): attendees their tickets, organizers their events.
const REGISTRATIONS_LINK: Record<Me["role"], { to: string; text: string }> = {
  user: { to: "/registrations/me", text: "My registrations" },
  organizer: { to: "/organizer", text: "My events" },
};

function Account({ me }: { me: Me }) {
  const logout = useLogout();
  const link = REGISTRATIONS_LINK[me.role];
  return (
    <div className="site-account" data-role={me.role}>
      <nav aria-label="Main" className="site-nav">
        <Link to={link.to}>{link.text}</Link>
      </nav>
      {/* Name and role stay together; a name cut by the layout is still readable in title
          (header-responsive.md HR2, HR3). */}
      <div className="account-info">
        <span className="account-name" title={me.name}>
          {me.name}
        </span>
        <span className="account-role">{ROLE_NAME[me.role]}</span>
      </div>
      {/* Does not close the menu: a failed log out shows its error in the open drawer (HR17). */}
      <button
        type="button"
        className="button-secondary"
        disabled={logout.isPending}
        onClick={() => {
          if (!logout.isPending) logout.mutate(me.role);
        }}
      >
        {logout.isPending ? "Logging out..." : "Log out"}
      </button>
      {logout.isError && (
        <p className="field-error" role="alert">
          Could not log out. Try again.
        </p>
      )}
    </div>
  );
}

type MenuHandle = { escape: () => void; open: (target: EventTarget) => void };

// The Menu button is display: none above 640 px; then nothing opens the drawer (HR26, HR35).
function notDisplayed(element: HTMLElement | null): boolean {
  return !element || getComputedStyle(element).display === "none";
}

// The Menu (burger) button, the backdrop and the drawer (header-responsive.md D66-D69, HR6,
// HR11-HR17, HR21-HR35). The drawer is always rendered; at 640 px and below CSS slides it in from
// the right while data-open is "true" and hides it (off-screen and visibility: hidden) while it is
// "false"; above 640 px the button, backdrop, Close and All events are hidden and the drawer is
// the one-row header (HR18-HR20). It is a modal dialog only while open (HR29).
function NavMenu({
  look,
  logoRef,
  children,
  ref,
}: {
  look: Me["role"];
  logoRef: RefObject<HTMLAnchorElement | null>;
  children: ReactNode;
  ref: Ref<MenuHandle>;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Set by Escape, Close menu and the backdrop: the focus goes back to Menu once inert is gone.
  const returnFocus = useRef(false);
  const { key, pathname } = useLocation();

  function close() {
    if (!open) return;
    returnFocus.current = true;
    setOpen(false);
  }

  useImperativeHandle(
    ref,
    () => ({
      // Escape anywhere in the header (HR15).
      escape: close,
      // A click on the header row or the Menu button only opens (HR13, HR21-HR26): never the
      // logo or another link, never inside the drawer or on the backdrop, never on desktop.
      open: (target) => {
        if (open || !(target instanceof Element)) return;
        if (target.closest("a, .site-header-end, .nav-backdrop")) return;
        if (notDisplayed(buttonRef.current)) return;
        setOpen(true);
      },
    }),
    [open],
  );

  // Every new location closes it: a drawer link, All events, Back or Forward. The key, not the
  // pathname, so the link of the current page closes it too. The focus is not moved (HR16).
  useEffect(() => {
    setOpen(false);
  }, [key]);

  // While open: the page behind is inert, the body does not scroll, the focus starts on Close
  // menu. The cleanup runs on every close and on unmount, also after a log out (HR30, HR33, HR34).
  useEffect(() => {
    if (!open) return;
    const behind = [document.querySelector("main"), logoRef.current, buttonRef.current].filter(
      (element): element is HTMLElement => element !== null,
    );
    for (const element of behind) element.setAttribute("inert", "");
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      for (const element of behind) element.removeAttribute("inert");
      document.body.style.overflow = overflow;
    };
  }, [open, logoRef]);

  // Runs after the cleanup above, so Menu is no longer inert when it takes the focus (HR15).
  useEffect(() => {
    if (open || !returnFocus.current) return;
    returnFocus.current = false;
    buttonRef.current?.focus();
  }, [open]);

  // Widening the window to desktop closes it, so no lock, trap or inert stays behind (HR35).
  useEffect(() => {
    if (!open) return;
    function onResize() {
      if (notDisplayed(buttonRef.current)) setOpen(false);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  // Tab and Shift+Tab wrap inside the open drawer (HR31).
  function trapFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (!open || event.key !== "Tab") return;
    // Links and enabled buttons; the disabled check is in code because jsdom does not match
    // button:not(:disabled).
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>("a[href], button"),
    ).filter((element) => !(element instanceof HTMLButtonElement && element.disabled));
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      {/* No onClick: the header handler opens it, so one click is one change (HR24). */}
      <button
        ref={buttonRef}
        type="button"
        className="nav-toggle"
        data-role={look}
        aria-label="Menu"
        aria-expanded={open}
        aria-controls={panelId}
      >
        <svg aria-hidden="true" focusable="false" width="24" height="24" viewBox="0 0 24 24">
          <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      {/* Mouse and touch only; keyboard users have Close menu and Escape (HR32). */}
      <div className="nav-backdrop" aria-hidden="true" onClick={close} />
      <div
        className="site-header-end"
        id={panelId}
        data-open={open}
        data-role={look}
        aria-label="Menu"
        role={open ? "dialog" : undefined}
        aria-modal={open ? true : undefined}
        onKeyDown={trapFocus}
      >
        <button
          ref={closeRef}
          type="button"
          className="nav-close"
          aria-label="Close menu"
          onClick={close}
        >
          <svg aria-hidden="true" focusable="false" width="24" height="24" viewBox="0 0 24 24">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        {/* Only in the drawer; above 640 px the logo is the way to the list (HR27, HR28). */}
        <nav aria-label="Site" className="site-nav site-nav-all">
          <Link to="/" aria-current={pathname === "/" ? "page" : undefined}>
            All events
          </Link>
        </nav>
        {children}
      </div>
    </>
  );
}

// Shown on every screen; reads the me cache, so it changes at once on login and logout (W-A18).
export function Header() {
  const { pathname } = useLocation();
  const me = useMe();
  const menu = useRef<MenuHandle>(null);
  const logo = useRef<HTMLAnchorElement>(null);
  const organizerPage = pathname.startsWith("/organizer");
  // A logged-in organizer keeps the organizer look on every screen, also on / and /event/:id (W-E22).
  const organizerLook = me.data?.role === "organizer" || organizerPage;
  const icon = organizerLook ? "/icon-organizer.svg" : "/icon-attendee.svg";

  // The tab icon follows the role of the page: green for attendees, purple for organizers.
  useEffect(() => {
    document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.setAttribute("href", icon);
  }, [icon]);

  return (
    // The click is a mouse and touch convenience on the header row, not a second button: no
    // role, no tabindex; keyboard users open the menu with the Menu button (HR21, HR25).
    <header
      className="site-header"
      onKeyDown={(event) => {
        if (event.key === "Escape") menu.current?.escape();
      }}
      onClick={(event) => menu.current?.open(event.target)}
    >
      {/* The way to the events list for everyone and in every state, also while me loads
          (header-events-link.md HB1-HB5, D64). */}
      <Link
        ref={logo}
        to="/"
        className="logo"
        aria-current={pathname === "/" ? "page" : undefined}
      >
        <img className="logo-icon" src={icon} alt="" width="32" height="32" />
        <span className="logo-text">Event Registration</span>
      </Link>
      {/* Nothing while me is loading, so a logged-in person never sees the login links flash.
          The key starts the menu closed again after login and logout (HR17). */}
      {!me.isPending && (
        <NavMenu
          key={me.data ? "in" : "out"}
          ref={menu}
          logoRef={logo}
          look={organizerLook ? "organizer" : "user"}
        >
          {me.data ? (
            <Account me={me.data} />
          ) : (
            <nav aria-label="Account" className="site-nav">
              <Link to="/login">Log in</Link>
              <Link to="/signup">Sign up</Link>
              {/* The role switch follows the page role. */}
              {organizerPage ? (
                <Link to="/login">For attendees</Link>
              ) : (
                <Link to="/organizer/login">For organizers</Link>
              )}
            </nav>
          )}
        </NavMenu>
      )}
    </header>
  );
}
