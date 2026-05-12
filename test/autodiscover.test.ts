import { describe, expect, it } from "vitest";
import { matchMxProvider, parseAutoconfigXml } from "../src/auth/autodiscover.js";

const FASTMAIL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<clientConfig version="1.1">
  <emailProvider id="fastmail.com">
    <identity />
    <domain>fastmail.com</domain>
    <displayName>Fastmail</displayName>
    <displayShortName>Fastmail</displayShortName>
    <incomingServer type="imap">
      <hostname>imap.fastmail.com</hostname>
      <port>993</port>
      <socketType>SSL</socketType>
      <username>%EMAILADDRESS%</username>
      <authentication>password-cleartext</authentication>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>smtp.fastmail.com</hostname>
      <port>465</port>
      <socketType>SSL</socketType>
      <username>%EMAILADDRESS%</username>
      <authentication>password-cleartext</authentication>
    </outgoingServer>
  </emailProvider>
</clientConfig>`;

const MULTI_PORT_XML = `<?xml version="1.0"?>
<clientConfig>
  <emailProvider id="example.com">
    <displayName>Example</displayName>
    <incomingServer type="imap">
      <hostname>imap.example.com</hostname>
      <port>143</port>
      <socketType>STARTTLS</socketType>
    </incomingServer>
    <incomingServer type="imap">
      <hostname>imap.example.com</hostname>
      <port>993</port>
      <socketType>SSL</socketType>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>smtp.example.com</hostname>
      <port>587</port>
      <socketType>STARTTLS</socketType>
    </outgoingServer>
  </emailProvider>
</clientConfig>`;

describe("parseAutoconfigXml", () => {
  it("parses Fastmail-style autoconfig", () => {
    const r = parseAutoconfigXml(FASTMAIL_XML);
    expect(r).not.toBeNull();
    expect(r!.displayName).toBe("Fastmail");
    expect(r!.imap).toEqual({ host: "imap.fastmail.com", port: 993, secure: true });
    expect(r!.smtp).toEqual({ host: "smtp.fastmail.com", port: 465, secure: true });
  });

  it("prefers implicit-TLS when multiple IMAP entries exist", () => {
    const r = parseAutoconfigXml(MULTI_PORT_XML);
    expect(r).not.toBeNull();
    expect(r!.imap).toEqual({ host: "imap.example.com", port: 993, secure: true });
    expect(r!.smtp).toEqual({ host: "smtp.example.com", port: 587, secure: false });
  });

  it("returns null for unparseable input", () => {
    expect(parseAutoconfigXml("<html>not xml</html>")).toBeNull();
    expect(parseAutoconfigXml("")).toBeNull();
  });
});

describe("matchMxProvider", () => {
  it.each([
    ["mx1.privateemail.com", "Namecheap PrivateEmail", "mail.privateemail.com"],
    ["in1-smtp.messagingengine.com", "Fastmail", "imap.fastmail.com"],
    ["acme-com.mail.protection.outlook.com", "Microsoft 365", "outlook.office365.com"],
    ["aspmx.l.google.com", "Google Workspace", "imap.gmail.com"],
    ["mx.zoho.com", "Zoho Mail", "imap.zoho.com"],
    ["mx.yandex.net", "Yandex Mail", "imap.yandex.com"],
    ["mx01.mail.icloud.com", "iCloud Mail", "imap.mail.me.com"],
    ["MX1.PRIVATEEMAIL.COM.", "Namecheap PrivateEmail", "mail.privateemail.com"],
  ])("matches %s → %s", (mx, displayName, imapHost) => {
    const r = matchMxProvider(mx);
    expect(r).not.toBeNull();
    expect(r!.displayName).toBe(displayName);
    expect(r!.preset.imap.host).toBe(imapHost);
  });

  it("returns null for unknown MX hosts", () => {
    expect(matchMxProvider("mail.some-random-host.example")).toBeNull();
    expect(matchMxProvider("")).toBeNull();
  });
});
