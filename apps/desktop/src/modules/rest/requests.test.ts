import { describe, expect, it } from "vitest";
import {
  RECENT_LIMIT,
  addRecent,
  addSaved,
  bumpRecent,
  findRecentTarget,
  findRequest,
  isBlank,
  moveToRecent,
  newRequest,
  pinToSaved,
  removeRequest,
  sweepBlank,
  updateRequest,
} from "./requests";
import type { RequestLists, RestRequest } from "./types";

function lists(over: Partial<RequestLists> = {}): RequestLists {
  return { saved: [], recent: [], ...over };
}

describe("newRequest", () => {
  it("starts as a GET nobody has named, made by hand", () => {
    const req = newRequest("id-1", 1000);
    expect(req.id).toBe("id-1");
    expect(req.method).toBe("GET");
    expect(req.url).toBe("");
    expect(req.name).toBe("");
    expect(req.origin).toBe("manual");
    expect(req.body).toEqual({ kind: "none" });
    expect(req.auth).toEqual({ kind: "none" });
    expect(req.createdAt).toBe(1000);
    expect(req.lastUsedAt).toBe(1000);
  });

  it("starts with no rows in either table", () => {
    const req = newRequest("id-1", 1000);
    expect(req.params).toEqual([]);
    expect(req.headers).toEqual([]);
  });
});

describe("addSaved", () => {
  it("puts a new request at the top of Saved", () => {
    const a = newRequest("a", 1);
    const b = newRequest("b", 2);
    const after = addSaved(addSaved(lists(), a), b);
    expect(after.saved.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("leaves Recent alone", () => {
    const recent = [newRequest("r", 1)];
    expect(addSaved(lists({ recent }), newRequest("a", 2)).recent).toBe(recent);
  });
});

describe("updateRequest", () => {
  it("replaces the request in whichever group holds it", () => {
    const edited = { ...newRequest("r", 1), url: "https://example.com" };
    const after = updateRequest(lists({ recent: [newRequest("r", 1)] }), edited);
    expect(after.recent[0].url).toBe("https://example.com");
  });

  it("keeps the request where it was rather than promoting it", () => {
    const edited = { ...newRequest("r", 1), url: "https://example.com" };
    const after = updateRequest(lists({ recent: [newRequest("r", 1)] }), edited);
    expect(after.saved).toEqual([]);
  });

  // Drafts follow the request, and the request may have been dropped from Recent while a tab on
  // it was still open. Nothing to update is not an error — it is a tab outliving its row.
  it("changes nothing when the request is in neither group", () => {
    const before = lists({ saved: [newRequest("a", 1)] });
    expect(updateRequest(before, newRequest("ghost", 2))).toEqual(before);
  });
});

describe("removeRequest", () => {
  it("takes it out of Saved", () => {
    const after = removeRequest(lists({ saved: [newRequest("a", 1), newRequest("b", 2)] }), "a");
    expect(after.saved.map((r) => r.id)).toEqual(["b"]);
  });

  it("takes it out of Recent", () => {
    const after = removeRequest(lists({ recent: [newRequest("r", 1)] }), "r");
    expect(after.recent).toEqual([]);
  });
});

describe("findRequest", () => {
  it("looks in both groups", () => {
    const both = lists({ saved: [newRequest("a", 1)], recent: [newRequest("r", 2)] });
    expect(findRequest(both, "a")?.id).toBe("a");
    expect(findRequest(both, "r")?.id).toBe("r");
    expect(findRequest(both, "nope")).toBeUndefined();
  });
});

describe("isBlank", () => {
  it("calls a request nobody has touched blank", () => {
    expect(isBlank(newRequest("a", 1))).toBe(true);
  });

  it("is not fooled by a URL of nothing but spaces", () => {
    expect(isBlank({ ...newRequest("a", 1), url: "   " })).toBe(true);
  });

  it("keeps a request that has a name, and nothing else", () => {
    expect(isBlank({ ...newRequest("a", 1), name: "Placeholder" })).toBe(false);
  });

  it("keeps a request that has a URL", () => {
    expect(isBlank({ ...newRequest("a", 1), url: "https://example.com" })).toBe(false);
  });

  it("keeps a request whose method was changed", () => {
    expect(isBlank({ ...newRequest("a", 1), method: "POST" })).toBe(false);
  });

  it("keeps a request with anything typed into either table", () => {
    const row = { id: "r", enabled: true, key: "x", value: "" };
    expect(isBlank({ ...newRequest("a", 1), headers: [row] })).toBe(false);
    expect(isBlank({ ...newRequest("a", 1), params: [row] })).toBe(false);
  });

  it("does not count an emptied row as something typed", () => {
    const row = { id: "r", enabled: true, key: "", value: "" };
    expect(isBlank({ ...newRequest("a", 1), headers: [row] })).toBe(true);
  });

  it("keeps a request with a body, even an empty one", () => {
    const body = { kind: "raw", language: "json", text: "" } as const;
    expect(isBlank({ ...newRequest("a", 1), body })).toBe(false);
  });

  it("keeps a request with authentication set up", () => {
    const auth = { kind: "bearer", token: "" } as const;
    expect(isBlank({ ...newRequest("a", 1), auth })).toBe(false);
  });

  it("keeps a request that has been sent, whatever is left in it", () => {
    expect(isBlank({ ...newRequest("a", 1), lastUsedAt: 2 })).toBe(false);
  });
});

describe("sweepBlank", () => {
  it("drops the blank ones from both groups", () => {
    const blank = newRequest("blank", 1);
    const real = { ...newRequest("real", 1), url: "https://example.com" };
    const after = sweepBlank(lists({ saved: [blank, real], recent: [blank] }));
    expect(after.saved.map((r) => r.id)).toEqual(["real"]);
    expect(after.recent).toEqual([]);
  });

  it("hands back the very same lists when there is nothing to drop", () => {
    const before = lists({ saved: [{ ...newRequest("real", 1), url: "https://x" }] });
    expect(sweepBlank(before)).toBe(before);
  });
});

/** A pasted request aimed somewhere, used `at`. */
function pasted(id: string, url: string, at: number): RestRequest {
  return { ...newRequest(id, at), url, origin: "paste", lastUsedAt: at };
}

describe("addRecent", () => {
  it("puts the paste at the head of Recent", () => {
    const after = addRecent(
      lists({ recent: [pasted("a", "https://a", 1)] }),
      pasted("b", "https://b", 2),
    );
    expect(after.recent.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("leaves Saved alone", () => {
    const saved = [newRequest("s", 1)];
    expect(addRecent(lists({ saved }), pasted("b", "https://b", 2)).saved).toBe(saved);
  });

  it("holds ten", () => {
    let current = lists();
    for (let n = 0; n < RECENT_LIMIT + 3; n++) {
      current = addRecent(current, pasted(`r${n}`, `https://${n}`, n + 1));
    }
    expect(current.recent).toHaveLength(RECENT_LIMIT);
  });

  /* What falls off is the one least recently *sent*, not the one added first: a request still used
     every day has no business being pushed out by ten pastes. */
  it("drops the one least recently used, not the oldest", () => {
    const old = [...Array(RECENT_LIMIT).keys()].map((n) => pasted(`r${n}`, `https://${n}`, 100 + n));
    // The very first one has been sent since; the second has not.
    const recent = old.map((r) => (r.id === "r0" ? { ...r, lastUsedAt: 9000 } : r));
    const after = addRecent(lists({ recent }), pasted("new", "https://new", 9001));
    expect(after.recent.map((r) => r.id)).toContain("r0");
    expect(after.recent.map((r) => r.id)).not.toContain("r1");
  });

  it("drops the older paste when two were used at the same moment", () => {
    const recent = [...Array(RECENT_LIMIT).keys()].map((n) => pasted(`r${n}`, `https://${n}`, 100));
    const after = addRecent(lists({ recent }), pasted("new", "https://new", 200));
    // Same `lastUsedAt` all round, so the one furthest down the list — the oldest paste — goes.
    expect(after.recent.map((r) => r.id)).not.toContain(`r${RECENT_LIMIT - 1}`);
    expect(after.recent.map((r) => r.id)).toContain("r0");
  });
});

describe("findRecentTarget", () => {
  it("matches on method and URL together", () => {
    const recent = [pasted("a", "https://a/items", 1)];
    expect(findRecentTarget(lists({ recent }), "GET", "https://a/items")?.id).toBe("a");
    expect(findRecentTarget(lists({ recent }), "POST", "https://a/items")).toBeUndefined();
    expect(findRecentTarget(lists({ recent }), "GET", "https://a/other")).toBeUndefined();
  });

  /* Saved is not searched. A request someone chose to keep is theirs, and a paste has no business
     stamping or reordering it. */
  it("does not look in Saved", () => {
    const saved = [{ ...newRequest("s", 1), url: "https://a/items" }];
    expect(findRecentTarget(lists({ saved }), "GET", "https://a/items")).toBeUndefined();
  });
});

describe("bumpRecent", () => {
  it("moves it to the head and stamps it as used", () => {
    const recent = [pasted("a", "https://a", 1), pasted("b", "https://b", 2)];
    const after = bumpRecent(lists({ recent }), "b", 500);
    expect(after.recent.map((r) => r.id)).toEqual(["b", "a"]);
    expect(after.recent[0].lastUsedAt).toBe(500);
  });

  it("changes nothing for an id that is not in Recent", () => {
    const before = lists({ saved: [newRequest("s", 1)] });
    expect(bumpRecent(before, "s", 500)).toBe(before);
  });
});

describe("moveToRecent", () => {
  it("takes the row out of Saved and puts it at the head of Recent, id and all", () => {
    const husk = newRequest("h", 1);
    const filled = { ...husk, url: "https://a/items", method: "POST" as const };
    const after = moveToRecent(
      lists({ saved: [husk, newRequest("other", 2)], recent: [pasted("r", "https://r", 3)] }),
      filled,
      500,
    );
    expect(after.saved.map((r) => r.id)).toEqual(["other"]);
    expect(after.recent.map((r) => r.id)).toEqual(["h", "r"]);
    expect(after.recent[0].url).toBe("https://a/items");
  });

  it("calls it what it is", () => {
    const husk = newRequest("h", 1);
    const after = moveToRecent(lists({ saved: [husk] }), { ...husk, url: "https://a" }, 500);
    expect(after.recent[0].origin).toBe("paste");
  });

  it("dates it from the paste, not from the New it was typed over", () => {
    const husk = newRequest("h", 1);
    const after = moveToRecent(lists({ saved: [husk] }), { ...husk, url: "https://a" }, 500);
    expect(after.recent[0].createdAt).toBe(500);
    expect(after.recent[0].lastUsedAt).toBe(500);
  });

  /* The stamp is what keeps this honest: a tab left open since this morning still holds a request
     created this morning, and the ceiling evicts by use. Without restamping, the row just pasted
     would be the first one thrown out. */
  it("survives a Recent that is already full", () => {
    const husk = newRequest("h", 1);
    const recent = [...Array(RECENT_LIMIT).keys()].map((n) => pasted(`r${n}`, `https://${n}`, 100));
    const after = moveToRecent(lists({ saved: [husk], recent }), { ...husk, url: "https://a" }, 500);
    expect(after.recent).toHaveLength(RECENT_LIMIT);
    expect(after.recent[0].id).toBe("h");
  });
});

describe("pinToSaved", () => {
  it("moves it out of Recent and on to the top of Saved", () => {
    const recent = [pasted("a", "https://a", 1)];
    const after = pinToSaved(lists({ saved: [newRequest("s", 1)], recent }), "a");
    expect(after.recent).toEqual([]);
    expect(after.saved.map((r) => r.id)).toEqual(["a", "s"]);
  });

  it("makes it a request someone meant to have", () => {
    const after = pinToSaved(lists({ recent: [pasted("a", "https://a", 1)] }), "a");
    expect(after.saved[0].origin).toBe("manual");
  });

  it("keeps everything else about it, half-finished edits included", () => {
    const edited = { ...pasted("a", "https://a", 1), name: "Half typed" };
    expect(pinToSaved(lists({ recent: [edited] }), "a").saved[0].name).toBe("Half typed");
  });

  it("changes nothing for an id that is not in Recent", () => {
    const before = lists({ saved: [newRequest("s", 1)] });
    expect(pinToSaved(before, "s")).toBe(before);
  });
});
