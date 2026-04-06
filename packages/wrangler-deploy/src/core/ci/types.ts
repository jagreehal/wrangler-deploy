export interface CiContext {
  provider: "github";
  repo: string;
  token: string;
  prNumber?: number;
  sha?: string;
  branch?: string;
}

export interface CiProvider {
  postComment(prNumber: number, body: string): Promise<void>;
  updateComment(prNumber: number, body: string, marker: string): Promise<void>;
  createCheckRun(name: string, status: "success" | "failure", details: string): Promise<void>;
}
