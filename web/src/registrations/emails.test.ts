// Tests first (email-reminders-web.md): W-EM9 the words for kinds and statuses, W-EM3 the
// uuid check that keeps bad ids from sending a request.
import { emailKindLabel, emailStatusLabel, isUuid } from "./emails";

describe("W-EM9: emailKindLabel", () => {
  it.each([
    ["ticket", "Ticket"],
    ["promotion", "Promotion"],
    ["reminder", "Reminder"],
    ["reschedule", "Reschedule"],
    ["event_cancelled", "Event cancelled"],
  ])("%s is %s", (kind, word) => {
    expect(emailKindLabel(kind)).toBe(word);
  });

  it("an unknown kind is shown as received", () => {
    expect(emailKindLabel("newsletter")).toBe("newsletter");
    expect(emailKindLabel("")).toBe("");
  });
});

describe("W-EM9: emailStatusLabel", () => {
  it.each([
    ["pending", "Pending"],
    ["sent", "Sent"],
    ["error_sending", "Sending failed"],
  ])("%s is %s", (status, word) => {
    expect(emailStatusLabel(status)).toBe(word);
  });

  it("an unknown status is shown as received", () => {
    expect(emailStatusLabel("bounced")).toBe("bounced");
  });

  it("does not take inherited object keys as words", () => {
    expect(emailStatusLabel("toString")).toBe("toString");
    expect(emailKindLabel("constructor")).toBe("constructor");
  });
});

describe("W-EM3: isUuid", () => {
  it.each([
    "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    "3F2B1C4D-5E6F-4A7B-8C9D-0E1F2A3B4C5D",
    "00000000-0000-0000-0000-000000000000",
  ])("%s is a uuid (any case)", (value) => {
    expect(isUuid(value)).toBe(true);
  });

  it.each([
    "",
    "me",
    "abc",
    "3f2b1c4d5e6f4a7b8c9d0e1f2a3b4c5d",
    "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5",
    "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d0",
    " 3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5g",
  ])("%j is not a uuid", (value) => {
    expect(isUuid(value)).toBe(false);
  });
});
