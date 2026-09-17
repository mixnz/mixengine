import constants from "../constants.json";
import type { KeyValue, RequestLists, RestRequest, RestResponse } from "../../src/modules/rest/types";
import { returns, type Handlers } from "../ipc/dispatch";
import { DAY, MINUTE, NOW } from "./time";

/** The acme-shop API as a developer keeps it: a handful of saved requests, one of them just sent. */

function row(id: string, key: string, value: string): KeyValue {
  return { id, enabled: true, key, value };
}

function request(partial: Pick<RestRequest, "id" | "name" | "method" | "url"> & Partial<RestRequest>): RestRequest {
  return {
    params: [],
    headers: [row(`${partial.id}-accept`, "Accept", "application/json")],
    body: { kind: "none" },
    auth: { kind: "bearer", token: "sk_test_acme_4f9b2c71" },
    origin: "manual",
    createdAt: NOW - 6 * DAY,
    lastUsedAt: NOW - 2 * DAY,
    ...partial,
  };
}

const PAID_ORDERS = request({
  id: constants.requestId,
  name: "Paid orders",
  method: "GET",
  url: "https://api.acme.test/v1/orders?status=paid&limit=3",
  params: [row("p-status", "status", "paid"), row("p-limit", "limit", "3")],
  lastUsedAt: NOW - 5 * MINUTE,
});

const LISTS: RequestLists = {
  saved: [
    PAID_ORDERS,
    request({ id: "demo-order-by-id", name: "Order by id", method: "GET", url: "https://api.acme.test/v1/orders/10421" }),
    request({
      id: "demo-create-order",
      name: "Create order",
      method: "POST",
      url: "https://api.acme.test/v1/orders",
      body: {
        kind: "raw",
        language: "json",
        text: '{\n  "customer_id": 812,\n  "items": [{ "sku": "TEE-BLK-M", "qty": 2 }]\n}',
      },
    }),
    request({ id: "demo-refund", name: "Refund order", method: "POST", url: "https://api.acme.test/v1/orders/10417/refund" }),
    request({ id: "demo-products", name: "Products", method: "GET", url: "https://api.acme.test/v1/products?page=1" }),
  ],
  recent: [],
};

export const restFiles = {
  "rest-requests.json": { lists: LISTS },
};

const BODY = JSON.stringify(
  {
    data: [
      { id: 10421, customer: "Ada Nguyen", status: "paid", total: "74.49", currency: "USD", items: 3 },
      { id: 10419, customer: "Mai Tran", status: "paid", total: "38.99", currency: "USD", items: 1 },
      { id: 10416, customer: "Kenji Sato", status: "paid", total: "112.99", currency: "USD", items: 5 },
    ],
    meta: { page: 1, limit: 3, total: 642 },
  },
  null,
  2,
);

const RESPONSE: RestResponse = {
  status: 200,
  status_text: "OK",
  http_version: "HTTP/2",
  headers: [
    ["content-type", "application/json; charset=utf-8"],
    ["cache-control", "no-store"],
    ["x-request-id", "req_8f3a2c19d4"],
    ["server", "Caddy"],
  ],
  body_base64: btoa(BODY),
  body_size: BODY.length,
  truncated: false,
  final_url: PAID_ORDERS.url,
  total_ms: 42,
  ttfb_ms: 31,
};

export const restHandlers: Handlers = {
  rest_send: returns<RestResponse>(RESPONSE),
  rest_cancel: returns(null),
};
