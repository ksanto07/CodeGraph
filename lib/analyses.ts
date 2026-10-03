import "server-only";
import type { AnalysisState } from "./analysis-state";
import { analysisStatus } from "./analysis-state";
import { createSupabaseClient } from "./supabase";

export type AnalysisSummary = {
  id: string;
  repository: string;
  state: AnalysisState;
  createdAt: string;
  stage: string;
  message: string;
  updatedAt: string;
};

export async function listAnalyses(): Promise<AnalysisSummary[]> {
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("analyses")
    .select("id,state,stage,message,updated_at,created_at,project:projects!analyses_project_fk(repository)")
    .eq("is_seed", false)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(50);

  if (error) throw new Error("Could not load analyses.", { cause: error });
  return data.map((analysis) => {
    if (!analysis.project) throw new Error("Analysis project is missing.");
    analysisStatus(analysis.state);
    return {
      id: analysis.id,
      repository: analysis.project.repository,
      state: analysis.state,
      createdAt: analysis.created_at,
      stage: analysis.stage,
      message: analysis.message,
      updatedAt: analysis.updated_at,
    };
  });
}
