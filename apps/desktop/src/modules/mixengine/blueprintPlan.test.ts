import { describe, expect, it } from "vitest";

import {
  answerSubjectFor,
  blueprintAppliedFrom,
  buildAnswers,
  buildScaffoldConsent,
  canApply,
  describePlanAction,
  jobFailureMessage,
  scaffoldStepIndex,
} from "./blueprintPlan";
import type { PlanStep } from "./api/types/PlanStep";
import type { BlueprintPlan } from "./api/types/BlueprintPlan";
import type { JobSummary } from "./api/types/JobSummary";

function step(partial: Partial<PlanStep> & Pick<PlanStep, "action" | "disposition">): PlanStep {
  return { elevates: false, ...partial };
}

describe("answerSubjectFor", () => {
  it("names the runtime for an install_runtime choice", () => {
    const s = step({
      action: { action: "install_runtime", kind: "php", wanted: "8.3" },
      disposition: { disposition: "choice", installed: "8.2.1", wanted: "8.3" },
    });
    expect(answerSubjectFor(s)).toEqual({ subject: "runtime", kind: "php" });
  });

  it("names the service instance for an ensure_service choice", () => {
    const s = step({
      action: {
        action: "ensure_service",
        package: "mariadb",
        instance: "main",
        version: "^11",
        dedicated: false,
      },
      disposition: { disposition: "choice", installed: "10.6.0", wanted: "^11" },
    });
    expect(answerSubjectFor(s)).toEqual({ subject: "service", id: "mariadb@main" });
  });

  it("is null for a step that is not a choice", () => {
    const s = step({
      action: { action: "add_domain", domain: "blog.test", primary: true },
      disposition: { disposition: "satisfied" },
    });
    expect(answerSubjectFor(s)).toBeNull();
  });
});

describe("scaffoldStepIndex", () => {
  it("finds the run_scaffold step's index, or -1 when there is none", () => {
    const steps: PlanStep[] = [
      step({
        action: { action: "add_domain", domain: "blog.test", primary: true },
        disposition: { disposition: "satisfied" },
      }),
      step({
        action: { action: "run_scaffold", command: "composer install" },
        disposition: { disposition: "confirm", what: "composer install" },
      }),
    ];
    expect(scaffoldStepIndex(steps)).toBe(1);
    expect(scaffoldStepIndex(steps.slice(0, 1))).toBe(-1);
  });
});

describe("canApply", () => {
  const choiceStep = step({
    action: { action: "install_runtime", kind: "php", wanted: "8.3" },
    disposition: { disposition: "choice", installed: "8.2.1", wanted: "8.3" },
  });

  it("is false while a choice step has no answer", () => {
    expect(canApply([choiceStep], {})).toBe(false);
  });

  it("is true once every choice step is answered", () => {
    expect(canApply([choiceStep], { 0: "install" })).toBe(true);
  });

  it("is false when any step is blocked or unsupported, answered or not", () => {
    const blocked = step({
      action: { action: "create_site", kind: { kind: "static" }, doc_root: "", https: true },
      disposition: { disposition: "blocked", reason: "no web server" },
    });
    expect(canApply([blocked], {})).toBe(false);
  });

  it("is true when every step is satisfied/create/confirm and nothing needs an answer", () => {
    const scaffold = step({
      action: { action: "run_scaffold", command: "composer install" },
      disposition: { disposition: "confirm", what: "composer install" },
    });
    expect(canApply([scaffold], {})).toBe(true);
  });
});

describe("buildAnswers", () => {
  it("pairs each answered choice step with its subject, in step order", () => {
    const steps: PlanStep[] = [
      step({
        action: { action: "install_runtime", kind: "php", wanted: "8.3" },
        disposition: { disposition: "choice", installed: "8.2.1", wanted: "8.3" },
      }),
      step({
        action: { action: "add_domain", domain: "blog.test", primary: true },
        disposition: { disposition: "satisfied" },
      }),
    ];
    expect(buildAnswers(steps, { 0: "use_installed" })).toEqual([
      { subject: { subject: "runtime", kind: "php" }, answer: "use_installed" },
    ]);
  });

  it("omits a choice step with no recorded answer", () => {
    const steps: PlanStep[] = [
      step({
        action: { action: "install_runtime", kind: "php", wanted: "8.3" },
        disposition: { disposition: "choice", installed: "8.2.1", wanted: "8.3" },
      }),
    ];
    expect(buildAnswers(steps, {})).toEqual([]);
  });
});

describe("buildScaffoldConsent", () => {
  const plan: BlueprintPlan = {
    blueprint: "laravel-starter",
    project: "blog",
    root: "/srv/blog",
    steps: [],
    source: "imported",
    trusted: false,
    signature: "missing",
  };

  it("names the exact command shown, and marks it untrusted when the plan is", () => {
    const s = step({
      action: { action: "run_scaffold", command: "composer install" },
      disposition: { disposition: "confirm", what: "composer install" },
    });
    expect(buildScaffoldConsent(plan, s)).toEqual({ command: "composer install", untrusted: true });
  });

  it("is null for a step that is not run_scaffold", () => {
    const s = step({
      action: { action: "add_domain", domain: "blog.test", primary: true },
      disposition: { disposition: "satisfied" },
    });
    expect(buildScaffoldConsent(plan, s)).toBeNull();
  });
});

function fakeT(key: string, vars?: Record<string, string | number>): string {
  return vars ? `${key}:${JSON.stringify(vars)}` : key;
}

describe("describePlanAction", () => {
  it("interpolates the action's own fields into its key", () => {
    const text = describePlanAction(fakeT, { action: "add_domain", domain: "blog.test", primary: true });
    expect(text).toBe('mixengine.blueprints.apply.action.add_domain:{"domain":"blog.test"}');
  });

  it("falls back to a literal 'latest' when install_package names no version", () => {
    const text = describePlanAction(fakeT, { action: "install_package", package: "redis" });
    expect(text).toContain('"wanted":"latest"');
  });
});

describe("blueprintAppliedFrom / jobFailureMessage", () => {
  function job(outcome: JobSummary["outcome"]): JobSummary {
    return {
      id: 1,
      kind: "blueprint.apply",
      state: "succeeded",
      percent: 100,
      message: "",
      started_at: 0,
      finished_at: 1,
      outcome,
    };
  }

  it("reads the applied result out of a succeeded job", () => {
    const applied = { blueprint: "b", project: "blog", root: "/srv/blog", steps: [] };
    expect(blueprintAppliedFrom(job({ ending: "succeeded", result: applied }))).toEqual(applied);
    expect(jobFailureMessage(job({ ending: "succeeded", result: applied }))).toBeNull();
  });

  it("returns null for a failed or cancelled job, and a message for the failure", () => {
    const failed = job({ ending: "failed", error: { code: "internal", message: "disk full" } });
    expect(blueprintAppliedFrom(failed)).toBeNull();
    expect(jobFailureMessage(failed)).toBe("disk full");

    const cancelled = job({ ending: "cancelled" });
    expect(blueprintAppliedFrom(cancelled)).toBeNull();
    expect(jobFailureMessage(cancelled)).toBeNull();
  });

  it("returns null for a job with no outcome yet", () => {
    expect(blueprintAppliedFrom(job(null))).toBeNull();
  });
});
