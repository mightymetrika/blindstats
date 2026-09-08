"use client";

import { useState } from "react";

import { AnalysisLockWorkspace } from "./AnalysisLockWorkspace";
import { BlindingWorkspace } from "./BlindingWorkspace";

type WorkflowStage = "blind" | "lock";

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
                Choose the stage you are working on. Saved artifacts can move
                between researchers, computers, and browser sessions.
              </p>
            </div>

            <div
              className="inline-flex w-full rounded-xl border border-slate-200 bg-slate-50 p-1 sm:w-auto"
              aria-label="Blinded analysis workflow stage"
            >
              <button
                type="button"
                aria-pressed={stage === "blind"}
                onClick={() => setStage("blind")}
                className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition sm:flex-none ${
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
                className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition sm:flex-none ${
                  stage === "lock"
                    ? "bg-slate-950 text-white shadow-sm"
                    : "text-slate-700 hover:bg-white"
                }`}
              >
                Lock blinded analysis
              </button>
            </div>
          </div>
        </div>
      </div>

      {stage === "blind" ? <BlindingWorkspace /> : <AnalysisLockWorkspace />}
    </>
  );
}
