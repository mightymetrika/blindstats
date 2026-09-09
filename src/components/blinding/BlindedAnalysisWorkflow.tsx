"use client";

import { useState } from "react";

import { AnalysisLockWorkspace } from "./AnalysisLockWorkspace";
import { BlindingWorkspace } from "./BlindingWorkspace";
import { UnblindingWorkspace } from "./UnblindingWorkspace";

type WorkflowStage = "blind" | "lock" | "unblind";

export function BlindedAnalysisWorkflow() {
  const [stage, setStage] = useState<WorkflowStage>("blind");

  return (
    <>
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto w-full max-w-5xl px-6 py-5 sm:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-950">
                Blinded analysis workflow
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Create, lock, and unblind an analysis using linked audit
                artifacts.
              </p>
            </div>

            <div
              className="grid w-full grid-cols-1 gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 sm:w-auto sm:grid-cols-3"
              aria-label="Blinded analysis workflow stage"
            >
              <button
                type="button"
                aria-pressed={stage === "blind"}
                onClick={() => setStage("blind")}
                className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
                  stage === "blind"
                    ? "bg-slate-950 text-white shadow-sm"
                    : "text-slate-700 hover:bg-white"
                }`}
              >
                Create blinded package
              </button>
              <button
                type="button"
                aria-pressed={stage === "lock"}
                onClick={() => setStage("lock")}
                className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
                  stage === "lock"
                    ? "bg-slate-950 text-white shadow-sm"
                    : "text-slate-700 hover:bg-white"
                }`}
              >
                Lock blinded analysis
              </button>
              <button
                type="button"
                aria-pressed={stage === "unblind"}
                onClick={() => setStage("unblind")}
                className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
                  stage === "unblind"
                    ? "bg-slate-950 text-white shadow-sm"
                    : "text-slate-700 hover:bg-white"
                }`}
              >
                Unblind
              </button>
            </div>
          </div>
        </div>
      </div>

      {stage === "blind" ? (
        <BlindingWorkspace />
      ) : stage === "lock" ? (
        <AnalysisLockWorkspace />
      ) : (
        <UnblindingWorkspace />
      )}
    </>
  );
}
