import type { Database } from "./database.types";

export type AnalysisState = Database["public"]["Enums"]["analysis_state"];

export const analysisStates = {
  queued: { label: "Queued", tone: "muted" },
  running: { label: "Running", tone: "active" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
} satisfies Record<AnalysisState, { label: string; tone: "muted" | "active" | "success" | "danger" }>;

export function analysisStatus(state: AnalysisState) {
  if (!Object.hasOwn(analysisStates, state)) {
    throw new Error("Unrecognized analysis state.");
  }
  return analysisStates[state];
}
