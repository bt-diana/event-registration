import { useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import type { ReactNode, Ref } from "react";
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
      {/* Does not close the menu: a failed log out shows its error in the open panel (HR17). */}
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

type MenuHandle = { escape: () => void };

// The Menu (burger) button and the panel it opens (header-responsive.md D66, HR6, HR11-HR17).
// The panel is always rendered; CSS hides it at 640 px and below while data-open is "false"
// and always shows it above 640 px, where the button is hidden (HR18-HR20).
function NavMenu({
  look,
  children,
  ref,
}: {
  look: Me["role"];
  children: ReactNode;
  ref: Ref<MenuHandle>;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { key } = useLocation();

  // Escape anywhere in the header closes an open menu and gives the focus back (HR15).
  useImperativeHandle(
    ref,
    () => ({
      escape: () => {
        if (!open) return;
        setOpen(false);
        buttonRef.current?.focus();
      },
    }),
    [open],
  );

  // Every new location closes it: a panel link, the logo, Back or Forward. The key, not the
  // pathname, so the link of the current page closes it too (HR16).
  useEffect(() => {
    setOpen(false);
  }, [key]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="nav-toggle"
        data-role={look}
        aria-label="Menu"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <svg aria-hidden="true" focusable="false" width="24" height="24" viewBox="0 0 24 24">
          <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <div className="site-header-end" id={panelId} data-open={open} data-role={look}>
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
  const organizerPage = pathname.startsWith("/organizer");
  // A logged-in organizer keeps the organizer look on every screen, also on / and /event/:id (W-E22).
  const organizerLook = me.data?.role === "organizer" || organizerPage;
  const icon = organizerLook ? "/icon-organizer.svg" : "/icon-attendee.svg";

  // The tab icon follows the role of the page: green for attendees, purple for organizers.
  useEffect(() => {
    document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.setAttribute("href", icon);
  }, [icon]);

  return (
    <header
      className="site-header"
      onKeyDown={(event) => {
        if (event.key === "Escape") menu.current?.escape();
      }}
    >
      {/* The way to the events list for everyone and in every state, also while me loads
          (header-events-link.md HB1-HB5, D64). */}
      <Link to="/" className="logo" aria-current={pathname === "/" ? "page" : undefined}>
        <img className="logo-icon" src={icon} alt="" width="32" height="32" />
        <span className="logo-text">Event Registration</span>
      </Link>
      {/* Nothing while me is loading, so a logged-in person never sees the login links flash.
          The key starts the menu closed again after login and logout (HR17). */}
      {!me.isPending && (
        <NavMenu
          key={me.data ? "in" : "out"}
          ref={menu}
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
