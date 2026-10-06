import { test } from "node:test";
import assert from "node:assert/strict";
import { CONNECTOR_SPECS } from "../connectors/providers";
import type { BookingRequest, SupplierCredentials } from "../connectors/types";

const hotelbeds = CONNECTOR_SPECS.find((s) => s.id === "hotelbeds")!;
const creds: SupplierCredentials = {
  scheme: "api_key",
  environment: "sandbox",
  fields: { apiKey: "k", secret: "s" },
};

const req: BookingRequest = {
  revalidationToken: "20261101|20261105|W|1|123|DBL.ST|BAR|BB||2~1~1|8|N@1",
  offer: {} as BookingRequest["offer"],
  passengers: [
    { type: "adult", title: "mr", givenName: "Nikos", familyName: "Papas", bornOn: "1980-01-01", gender: "m" },
    { type: "adult", title: "ms", givenName: "Maria", familyName: "Papa", bornOn: "1982-01-01", gender: "f" },
    { type: "child", title: "miss", givenName: "Eleni", familyName: "Papa", bornOn: "2018-11-02", gender: "f" },
  ],
  contact: { email: "a@b.co", phone: "+306912345678" },
  clientReference: "REVIS/2026-0042 extra long",
  rooms: 1,
  travelDate: "2026-11-01",
};

test("Hotelbeds booking sends the freshest rateKey, every guest, and a 20-char reference", () => {
  const call = hotelbeds.book!.request(creds, req, "https://api.test.hotelbeds.com");
  assert.equal(call.method, "POST");
  assert.equal(call.url, "https://api.test.hotelbeds.com/hotel-api/1.0/bookings");
  const body = call.body as {
    holder: { name: string; surname: string };
    rooms: Array<{ rateKey: string; paxes: Array<{ type: string; age?: number; roomId: number }> }>;
    clientReference: string;
  };
  assert.equal(body.rooms[0].rateKey, req.revalidationToken);
  assert.deepEqual(body.holder, { name: "Nikos", surname: "Papas" });
  assert.equal(body.rooms[0].paxes.length, 3);
  // Age on the day of arrival, not today: 7 on 2026-11-01 (birthday is the 2nd).
  assert.deepEqual(
    body.rooms[0].paxes.find((p) => p.type === "CH"),
    { roomId: 1, type: "CH", age: 7, name: "Eleni", surname: "Papa" },
  );
  assert.ok(body.clientReference.length <= 20);
  assert.match(body.clientReference, /^[A-Za-z0-9-]+$/);
});

test("Hotelbeds booking answer maps to confirmed with its reference and net", () => {
  const out = hotelbeds.book!.map(
    { booking: { reference: "102-3456789", status: "CONFIRMED", totalNet: 412.5, currency: "EUR" } },
    req,
  );
  assert.equal(out.status, "confirmed");
  assert.equal(out.supplierReference, "102-3456789");
  assert.deepEqual(out.amountCharged, { amountMinor: 41250, currency: "EUR" });

  assert.equal(hotelbeds.book!.map({}, req).status, "failed");
});
